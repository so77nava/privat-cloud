import fs from 'node:fs';
import crypto from 'node:crypto';
import path from 'node:path';
import { Router } from 'express';
import multer from 'multer';
import { create as contentDisposition } from 'content-disposition';
import { config } from './config.js';
import { db } from './db.js';
import { requireAuth } from './auth.js';
import { mimeTypeFor, previewTypeFor } from './mime.js';
import { HttpError, isAllowedExtension, makeUnique, sanitizeName } from './util.js';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

/**
 * Absoluter Pfad einer gespeicherten Datei. Auf der Platte heißen Dateien nur nach
 * ihrer UUID – Benutzereingaben landen nie im Pfad. Die Prüfungen hier sind eine
 * zusätzliche Absicherung gegen Path Traversal.
 */
export function storagePath(id) {
  if (!UUID.test(id)) throw new HttpError(400, 'Ungültige Datei-ID');
  const resolved = path.resolve(config.filesDir, id);
  if (path.dirname(resolved) !== config.filesDir) throw new HttpError(400, 'Ungültiger Pfad');
  return resolved;
}

function removeStoredFile(id) {
  fs.rm(storagePath(id), { force: true }, () => {});
}

// ---------- Hilfsfunktionen ----------

function serializeFile(row) {
  return {
    id: row.id,
    name: row.name,
    size: row.size,
    mimeType: row.mime_type,
    folderId: row.folder_id,
    createdAt: new Date(row.created_at).toISOString(),
    previewable: previewTypeFor(row.name) !== null,
  };
}

function serializeFolder(row) {
  return {
    id: row.id,
    name: row.name,
    parentId: row.parent_id,
    createdAt: new Date(row.created_at).toISOString(),
    ...(row.item_count !== undefined && { itemCount: row.item_count }),
  };
}

function getFolder(id) {
  const folder = db.prepare('SELECT * FROM folders WHERE id = ?').get(id);
  if (!folder) throw new HttpError(404, 'Ordner nicht gefunden');
  return folder;
}

function getFile(id) {
  if (!UUID.test(id)) throw new HttpError(404, 'Datei nicht gefunden');
  const file = db.prepare('SELECT * FROM files WHERE id = ?').get(id);
  if (!file) throw new HttpError(404, 'Datei nicht gefunden');
  return file;
}

/** null/""/"root" = Wurzelverzeichnis, sonst existierende Ordner-ID. */
function parseFolderId(value) {
  if (value === undefined || value === null || value === '' || value === 'root') return null;
  const id = Number(value);
  if (!Number.isInteger(id) || id <= 0) throw new HttpError(400, 'Ungültige Ordner-ID');
  return getFolder(id).id;
}

function parseIntParam(value) {
  const id = Number(value);
  if (!Number.isInteger(id) || id <= 0) throw new HttpError(404, 'Nicht gefunden');
  return id;
}

const fileNameTaken = (folderId, name, excludeId = '') =>
  Boolean(db.prepare('SELECT 1 FROM files WHERE folder_id IS ? AND name = ? COLLATE NOCASE AND id != ?')
    .get(folderId, name, excludeId));

const folderNameTaken = (parentId, name, excludeId = 0) =>
  Boolean(db.prepare('SELECT 1 FROM folders WHERE parent_id IS ? AND name = ? COLLATE NOCASE AND id != ?')
    .get(parentId, name, excludeId));

function requireName(raw, label) {
  const name = sanitizeName(raw);
  if (!name) throw new HttpError(400, `Ungültiger ${label}`);
  return name;
}

function breadcrumbs(folderId) {
  const trail = [];
  let current = folderId;
  while (current !== null) {
    const folder = getFolder(current);
    trail.unshift({ id: folder.id, name: folder.name });
    current = folder.parent_id;
  }
  return trail;
}

// Multer kodiert Dateinamen als latin1 – die Browser senden sie aber als UTF-8.
const decodeOriginalName = (name) => Buffer.from(name, 'latin1').toString('utf8');

// ---------- Upload-Konfiguration ----------

const upload = multer({
  storage: multer.diskStorage({
    destination: config.filesDir,
    filename: (req, file, cb) => cb(null, crypto.randomUUID()),
  }),
  limits: {
    fileSize: config.maxFileSizeBytes,
    files: config.maxFilesPerUpload,
    fields: 5,
    parts: config.maxFilesPerUpload + 5,
  },
  fileFilter: (req, file, cb) => {
    const name = sanitizeName(decodeOriginalName(file.originalname));
    if (!name) return cb(new HttpError(400, 'Ungültiger Dateiname'));
    if (!isAllowedExtension(name)) return cb(new HttpError(415, `Dateityp nicht erlaubt: ${name}`));
    file.cleanName = name;
    cb(null, true);
  },
});

const insertFile = db.prepare(
  'INSERT INTO files (id, folder_id, name, mime_type, size, created_at) VALUES (?, ?, ?, ?, ?, ?)',
);

// ---------- Routen ----------

export const filesRouter = Router();
filesRouter.use(requireAuth);

filesRouter.get('/config', (req, res) => {
  res.json({
    maxFileSizeBytes: config.maxFileSizeBytes,
    maxFilesPerUpload: config.maxFilesPerUpload,
    allowedExtensions: [...config.allowedExtensions].sort(),
    minPasswordLength: config.minPasswordLength,
  });
});

filesRouter.get('/stats', (req, res) => {
  const { count, total } = db.prepare('SELECT COUNT(*) AS count, IFNULL(SUM(size), 0) AS total FROM files').get();
  const { folders } = db.prepare('SELECT COUNT(*) AS folders FROM folders').get();
  res.json({ fileCount: count, folderCount: folders, totalSize: total });
});

filesRouter.get('/browse', (req, res) => {
  const folderId = parseFolderId(req.query.folderId);
  const folders = db.prepare(`
    SELECT f.*,
      (SELECT COUNT(*) FROM folders c WHERE c.parent_id = f.id) +
      (SELECT COUNT(*) FROM files d WHERE d.folder_id = f.id) AS item_count
    FROM folders f WHERE f.parent_id IS ? ORDER BY f.name COLLATE NOCASE
  `).all(folderId);
  const files = db.prepare('SELECT * FROM files WHERE folder_id IS ? ORDER BY name COLLATE NOCASE').all(folderId);

  res.json({
    folder: folderId === null ? null : serializeFolder(getFolder(folderId)),
    breadcrumbs: breadcrumbs(folderId),
    folders: folders.map(serializeFolder),
    files: files.map(serializeFile),
  });
});

// ----- Ordner -----

filesRouter.get('/folders', (req, res) => {
  const rows = db.prepare('SELECT * FROM folders ORDER BY name COLLATE NOCASE').all();
  res.json(rows.map(serializeFolder));
});

filesRouter.post('/folders', (req, res) => {
  const name = requireName(req.body?.name, 'Ordnername');
  const parentId = parseFolderId(req.body?.parentId);
  if (folderNameTaken(parentId, name)) throw new HttpError(409, `Ein Ordner „${name}“ existiert hier bereits.`);
  const { lastInsertRowid } = db
    .prepare('INSERT INTO folders (name, parent_id, created_at) VALUES (?, ?, ?)')
    .run(name, parentId, Date.now());
  res.status(201).json(serializeFolder(getFolder(lastInsertRowid)));
});

filesRouter.patch('/folders/:id', (req, res) => {
  const folder = getFolder(parseIntParam(req.params.id));
  const body = req.body ?? {};
  const name = body.name !== undefined ? requireName(body.name, 'Ordnername') : folder.name;
  const parentId = 'parentId' in body ? parseFolderId(body.parentId) : folder.parent_id;

  // Zyklen verhindern: Ziel darf weder der Ordner selbst noch einer seiner Unterordner sein.
  for (let current = parentId; current !== null; current = getFolder(current).parent_id) {
    if (current === folder.id) throw new HttpError(400, 'Ein Ordner kann nicht in sich selbst verschoben werden.');
  }
  if (folderNameTaken(parentId, name, folder.id)) {
    throw new HttpError(409, `Ein Ordner „${name}“ existiert dort bereits.`);
  }
  db.prepare('UPDATE folders SET name = ?, parent_id = ? WHERE id = ?').run(name, parentId, folder.id);
  res.json(serializeFolder(getFolder(folder.id)));
});

filesRouter.delete('/folders/:id', (req, res) => {
  const folder = getFolder(parseIntParam(req.params.id));
  const fileIds = db.transaction(() => {
    const ids = db.prepare(`
      WITH RECURSIVE sub(id) AS (
        SELECT ? UNION ALL SELECT f.id FROM folders f JOIN sub ON f.parent_id = sub.id
      )
      SELECT id FROM files WHERE folder_id IN (SELECT id FROM sub)
    `).pluck().all(folder.id);
    db.prepare('DELETE FROM folders WHERE id = ?').run(folder.id); // Unterordner + Dateien per CASCADE
    return ids;
  })();
  fileIds.forEach(removeStoredFile);
  res.status(204).end();
});

// ----- Dateien -----

filesRouter.post(
  '/files',
  (req, res, next) => {
    req.targetFolderId = parseFolderId(req.query.folderId);
    next();
  },
  upload.array('files', config.maxFilesPerUpload),
  (req, res) => {
    const uploaded = req.files ?? [];
    if (uploaded.length === 0) throw new HttpError(400, 'Keine Dateien empfangen.');
    try {
      const rows = db.transaction(() => uploaded.map((file) => {
        const name = makeUnique(file.cleanName, (n) => fileNameTaken(req.targetFolderId, n));
        const row = [file.filename, req.targetFolderId, name, mimeTypeFor(name), file.size, Date.now()];
        insertFile.run(...row);
        return db.prepare('SELECT * FROM files WHERE id = ?').get(file.filename);
      }))();
      res.status(201).json(rows.map(serializeFile));
    } catch (err) {
      uploaded.forEach((file) => removeStoredFile(file.filename));
      throw err;
    }
  },
);

filesRouter.get('/files/:id/download', (req, res) => {
  const file = getFile(req.params.id);
  res.set({
    'Content-Type': file.mime_type,
    'Content-Disposition': contentDisposition(file.name, { type: 'attachment' }),
    'Cache-Control': 'private, no-store',
  });
  res.sendFile(storagePath(file.id));
});

filesRouter.get('/files/:id/preview', (req, res) => {
  const file = getFile(req.params.id);
  const type = previewTypeFor(file.name);
  if (!type) throw new HttpError(415, 'Für diesen Dateityp gibt es keine Vorschau.');
  res.set({
    'Content-Type': type,
    'Content-Disposition': contentDisposition(file.name, { type: 'inline' }),
    'Cache-Control': 'private, max-age=300',
  });
  // PDFs brauchen den Viewer des Browsers; alles andere läuft in einer Sandbox ohne Skripte.
  if (type === 'application/pdf') res.removeHeader('Content-Security-Policy');
  else res.set('Content-Security-Policy', "default-src 'none'; img-src 'self'; style-src 'unsafe-inline'; sandbox");
  res.sendFile(storagePath(file.id));
});

filesRouter.patch('/files/:id', (req, res) => {
  const file = getFile(req.params.id);
  const body = req.body ?? {};
  const folderId = 'folderId' in body ? parseFolderId(body.folderId) : file.folder_id;
  const name = body.name !== undefined ? requireName(body.name, 'Dateiname') : file.name;
  if (!isAllowedExtension(name)) throw new HttpError(415, 'Diese Dateiendung ist nicht erlaubt.');
  if (fileNameTaken(folderId, name, file.id)) {
    throw new HttpError(409, `Eine Datei „${name}“ existiert dort bereits.`);
  }
  db.prepare('UPDATE files SET name = ?, folder_id = ?, mime_type = ? WHERE id = ?')
    .run(name, folderId, mimeTypeFor(name), file.id);
  res.json(serializeFile(getFile(file.id)));
});

filesRouter.delete('/files/:id', (req, res) => {
  const file = getFile(req.params.id);
  db.prepare('DELETE FROM files WHERE id = ?').run(file.id);
  removeStoredFile(file.id);
  res.status(204).end();
});

/** Entfernt Dateien auf der Platte ohne DB-Eintrag (z. B. nach abgebrochenen Uploads). */
export function cleanupOrphans() {
  const known = new Set(db.prepare('SELECT id FROM files').pluck().all());
  let removed = 0;
  for (const entry of fs.readdirSync(config.filesDir)) {
    if (!known.has(entry)) {
      fs.rmSync(path.join(config.filesDir, entry), { force: true, recursive: true });
      removed++;
    }
  }
  return removed;
}
