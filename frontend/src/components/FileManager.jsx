import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { downloadFile, ensureSession, files as filesApi, uploadFile } from '../api.js';
import { useFolderRoute, useToast } from '../hooks.js';
import { extensionOf, fileKind, formatDate, formatSize } from '../utils.js';
import {
  CloudIcon, DownloadIcon, EditIcon, EyeIcon, FolderIcon, FolderPlusIcon, HomeIcon, KeyIcon,
  KindIcon, LogoutIcon, MoonIcon, MoveIcon, SearchIcon, SunIcon, TrashIcon, UploadIcon,
} from './Icons.jsx';
import { ConfirmDialog, MoveDialog, PasswordDialog, PromptDialog } from './Dialogs.jsx';
import PreviewModal from './PreviewModal.jsx';
import UploadPanel from './UploadPanel.jsx';

const PARALLEL_UPLOADS = 3;

const COMPARATORS = {
  name: (a, b) => a.name.localeCompare(b.name, 'de', { numeric: true, sensitivity: 'base' }),
  size: (a, b) => (a.size ?? -1) - (b.size ?? -1),
  date: (a, b) => a.createdAt.localeCompare(b.createdAt),
};

const hasFiles = (e) => Array.from(e.dataTransfer?.types ?? []).includes('Files');

export default function FileManager({ theme, onToggleTheme, onLogout }) {
  const notify = useToast();
  const [folderId, navigate] = useFolderRoute();
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [config, setConfig] = useState(null);
  const [stats, setStats] = useState(null);
  const [search, setSearch] = useState('');
  const [sort, setSort] = useState({ key: 'name', dir: 1 });
  const [dialog, setDialog] = useState(null);
  const [preview, setPreview] = useState(null);
  const [uploads, setUploads] = useState([]);
  const [dragActive, setDragActive] = useState(false);
  const dragDepth = useRef(0);
  const fileInput = useRef(null);

  // ---------- Daten laden ----------

  const load = useCallback(async () => {
    try {
      const [browse, statistics] = await Promise.all([filesApi.browse(folderId), filesApi.stats()]);
      setData(browse);
      setStats(statistics);
    } catch (err) {
      if (err.status === 404 && folderId != null) {
        notify('Ordner nicht gefunden.', 'error');
        navigate(null);
      } else if (err.status !== 401) {
        notify(err.message, 'error');
      }
    } finally {
      setLoading(false);
    }
  }, [folderId, navigate, notify]);

  useEffect(() => {
    setLoading(true);
    setSearch('');
    load();
  }, [load]);

  useEffect(() => {
    filesApi.config().then(setConfig).catch(() => {});
  }, []);

  const loadRef = useRef(load);
  loadRef.current = load;

  // ---------- Uploads ----------

  const queue = useRef([]);
  const active = useRef(0);
  const aborters = useRef(new Map());
  const uploadKey = useRef(0);

  const patchUpload = (key, patch) =>
    setUploads((list) => list.map((u) => (u.key === key ? { ...u, ...patch } : u)));

  const pump = useCallback(() => {
    while (active.current < PARALLEL_UPLOADS && queue.current.length > 0) {
      const job = queue.current.shift();
      active.current++;
      patchUpload(job.key, { status: 'uploading' });
      const { promise, abort } = uploadFile(job.file, job.folderId, (p) => patchUpload(job.key, { progress: p }));
      aborters.current.set(job.key, abort);
      promise
        .then(() => {
          patchUpload(job.key, { status: 'done', progress: 1 });
          loadRef.current();
        })
        .catch((err) => patchUpload(job.key, { status: 'error', error: err.message }))
        .finally(() => {
          aborters.current.delete(job.key);
          active.current--;
          pump();
        });
    }
  }, []);

  const startUploads = useCallback((fileList, skippedFolders = 0) => {
    const list = Array.from(fileList);
    if (skippedFolders > 0) notify('Ordner können nicht hochgeladen werden – bitte Dateien auswählen.', 'error');
    if (list.length === 0) return;

    const entries = list.map((file) => {
      const key = ++uploadKey.current;
      let error = null;
      if (config && !config.allowedExtensions.includes(extensionOf(file.name))) {
        error = 'Dateityp nicht erlaubt';
      } else if (config && file.size > config.maxFileSizeBytes) {
        error = `Zu groß (max. ${formatSize(config.maxFileSizeBytes)})`;
      }
      if (!error) queue.current.push({ key, file, folderId });
      return {
        key, name: file.name, size: file.size, progress: 0,
        status: error ? 'error' : 'queued', error,
      };
    });
    setUploads((current) => [...current, ...entries]);
    pump();
  }, [config, folderId, notify, pump]);

  const cancelUpload = (key) => {
    queue.current = queue.current.filter((job) => job.key !== key);
    aborters.current.get(key)?.();
    patchUpload(key, { status: 'error', error: 'Abgebrochen' });
  };

  const clearFinished = () =>
    setUploads((list) => list.filter((u) => u.status === 'queued' || u.status === 'uploading'));

  // ---------- Drag & Drop ----------

  useEffect(() => {
    // Verhindert, dass der Browser daneben gefallene Dateien öffnet.
    const prevent = (e) => hasFiles(e) && e.preventDefault();
    window.addEventListener('dragover', prevent);
    window.addEventListener('drop', prevent);
    return () => {
      window.removeEventListener('dragover', prevent);
      window.removeEventListener('drop', prevent);
    };
  }, []);

  const dragHandlers = {
    onDragEnter: (e) => {
      if (!hasFiles(e)) return;
      e.preventDefault();
      dragDepth.current++;
      setDragActive(true);
    },
    onDragOver: (e) => {
      if (!hasFiles(e)) return;
      e.preventDefault();
      e.dataTransfer.dropEffect = 'copy';
    },
    onDragLeave: (e) => {
      if (!hasFiles(e)) return;
      dragDepth.current = Math.max(0, dragDepth.current - 1);
      if (dragDepth.current === 0) setDragActive(false);
    },
    onDrop: (e) => {
      if (!hasFiles(e)) return;
      e.preventDefault();
      dragDepth.current = 0;
      setDragActive(false);
      const dropped = [];
      let skipped = 0;
      for (const item of Array.from(e.dataTransfer.items ?? [])) {
        if (item.kind !== 'file') continue;
        if (item.webkitGetAsEntry?.()?.isDirectory) {
          skipped++;
          continue;
        }
        const file = item.getAsFile();
        if (file) dropped.push(file);
      }
      startUploads(dropped.length || skipped ? dropped : e.dataTransfer.files, skipped);
    },
  };

  // ---------- Aktionen ----------

  const openPreview = async (file) => {
    try {
      await ensureSession();
      setPreview(file);
    } catch { /* 401 wird zentral behandelt */ }
  };

  const download = (file) => downloadFile(file.id).catch((err) => err.status !== 401 && notify(err.message, 'error'));

  const afterChange = (message) => {
    notify(message);
    load();
  };

  const dialogs = {
    newFolder: () => (
      <PromptDialog
        title="Neuer Ordner"
        label="Ordnername"
        confirmLabel="Erstellen"
        onSubmit={async (name) => {
          await filesApi.createFolder(name, folderId);
          afterChange(`Ordner „${name}“ erstellt.`);
        }}
        onClose={() => setDialog(null)}
      />
    ),
    rename: ({ item, isFolder }) => (
      <PromptDialog
        title={isFolder ? 'Ordner umbenennen' : 'Datei umbenennen'}
        label="Neuer Name"
        initialValue={item.name}
        selectBaseName={!isFolder}
        confirmLabel="Umbenennen"
        onSubmit={async (name) => {
          if (name === item.name) return;
          await (isFolder ? filesApi.updateFolder(item.id, { name }) : filesApi.updateFile(item.id, { name }));
          afterChange(`Umbenannt in „${name}“.`);
        }}
        onClose={() => setDialog(null)}
      />
    ),
    move: ({ item, isFolder }) => (
      <MoveDialog
        item={item}
        isFolder={isFolder}
        currentFolderId={isFolder ? item.parentId : item.folderId}
        onSubmit={async (target) => {
          await (isFolder
            ? filesApi.updateFolder(item.id, { parentId: target })
            : filesApi.updateFile(item.id, { folderId: target }));
          afterChange(`„${item.name}“ verschoben.`);
        }}
        onClose={() => setDialog(null)}
      />
    ),
    delete: ({ item, isFolder }) => (
      <ConfirmDialog
        title={isFolder ? 'Ordner löschen' : 'Datei löschen'}
        message={isFolder
          ? `Ordner „${item.name}“ mit allen Unterordnern und Dateien endgültig löschen?`
          : `„${item.name}“ endgültig löschen?`}
        onConfirm={async () => {
          await (isFolder ? filesApi.deleteFolder(item.id) : filesApi.deleteFile(item.id));
          afterChange(`„${item.name}“ gelöscht.`);
        }}
        onClose={() => setDialog(null)}
      />
    ),
    password: () => (
      <PasswordDialog onDone={() => notify('Passwort geändert.')} onClose={() => setDialog(null)} />
    ),
  };

  // ---------- Ansicht ----------

  const { folders, fileList } = useMemo(() => {
    if (!data) return { folders: [], fileList: [] };
    const term = search.trim().toLowerCase();
    const match = (item) => !term || item.name.toLowerCase().includes(term);
    const compare = (a, b) => COMPARATORS[sort.key](a, b) * sort.dir || COMPARATORS.name(a, b);
    return {
      folders: data.folders.filter(match).sort(sort.key === 'size' ? COMPARATORS.name : compare),
      fileList: data.files.filter(match).sort(compare),
    };
  }, [data, search, sort]);

  const previewable = fileList.filter((f) => f.previewable);

  const sortBy = (key) => setSort((s) => ({ key, dir: s.key === key ? -s.dir : 1 }));
  const sortIndicator = (key) => (sort.key === key ? (sort.dir === 1 ? ' ▲' : ' ▼') : '');
  const ariaSort = (key) => (sort.key === key ? (sort.dir === 1 ? 'ascending' : 'descending') : 'none');

  const isEmpty = data && data.folders.length === 0 && data.files.length === 0;

  return (
    <div className="app" {...dragHandlers}>
      <header className="topbar">
        <div className="brand">
          <CloudIcon size={24} />
          <span>Privat Cloud</span>
        </div>
        {stats && (
          <span className="muted small stats">
            {stats.fileCount} Dateien · {formatSize(stats.totalSize)}
          </span>
        )}
        <div className="topbar-actions">
          <button className="icon-btn" onClick={onToggleTheme} title={theme === 'dark' ? 'Helles Design' : 'Dunkles Design'} aria-label="Design umschalten">
            {theme === 'dark' ? <SunIcon /> : <MoonIcon />}
          </button>
          <button className="icon-btn" onClick={() => setDialog({ type: 'password' })} title="Passwort ändern" aria-label="Passwort ändern">
            <KeyIcon />
          </button>
          <button className="icon-btn" onClick={onLogout} title="Abmelden" aria-label="Abmelden">
            <LogoutIcon />
          </button>
        </div>
      </header>

      <main className="content">
        <div className="toolbar">
          <nav className="breadcrumbs" aria-label="Pfad">
            <button className="crumb" onClick={() => navigate(null)}>
              <HomeIcon size={16} /> <span>Start</span>
            </button>
            {data?.breadcrumbs.map((crumb) => (
              <span key={crumb.id} className="crumb-wrap">
                <span className="crumb-sep">/</span>
                <button className="crumb" onClick={() => navigate(crumb.id)}>{crumb.name}</button>
              </span>
            ))}
          </nav>
          <div className="toolbar-actions">
            <label className="search">
              <SearchIcon size={16} />
              <input
                type="search"
                placeholder="In diesem Ordner suchen"
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                aria-label="Suchen"
              />
            </label>
            <button className="btn" onClick={() => setDialog({ type: 'newFolder' })}>
              <FolderPlusIcon size={16} /> <span>Neuer Ordner</span>
            </button>
            <button className="btn btn-primary" onClick={() => fileInput.current.click()}>
              <UploadIcon size={16} /> <span>Hochladen</span>
            </button>
            <input
              ref={fileInput}
              type="file"
              multiple
              hidden
              accept={config?.allowedExtensions.map((ext) => `.${ext}`).join(',')}
              onChange={(e) => {
                startUploads(e.target.files);
                e.target.value = '';
              }}
            />
          </div>
        </div>

        <div className="card table-card">
          {loading && !data ? (
            <div className="empty"><div className="spinner" /></div>
          ) : isEmpty ? (
            <button className="empty dropzone" onClick={() => fileInput.current.click()}>
              <UploadIcon size={40} />
              <strong>Dieser Ordner ist leer</strong>
              <span className="muted">Dateien hierher ziehen oder klicken, um Dateien auszuwählen.</span>
              {config && (
                <span className="muted small">Max. {formatSize(config.maxFileSizeBytes)} pro Datei</span>
              )}
            </button>
          ) : (
            <table className="file-table">
              <thead>
                <tr>
                  <th aria-sort={ariaSort('name')}><button onClick={() => sortBy('name')}>Name{sortIndicator('name')}</button></th>
                  <th className="col-size" aria-sort={ariaSort('size')}><button onClick={() => sortBy('size')}>Größe{sortIndicator('size')}</button></th>
                  <th className="col-date" aria-sort={ariaSort('date')}><button onClick={() => sortBy('date')}>Hochgeladen{sortIndicator('date')}</button></th>
                  <th className="col-actions"><span className="sr-only">Aktionen</span></th>
                </tr>
              </thead>
              <tbody>
                {folders.map((folder) => (
                  <tr key={`d${folder.id}`}>
                    <td>
                      <button className="name-cell" onClick={() => navigate(folder.id)}>
                        <FolderIcon className="kind-icon kind-folder" />
                        <span className="name-text">{folder.name}</span>
                      </button>
                    </td>
                    <td className="col-size muted">{folder.itemCount} {folder.itemCount === 1 ? 'Element' : 'Elemente'}</td>
                    <td className="col-date muted">{formatDate(folder.createdAt)}</td>
                    <td className="col-actions">
                      <div className="row-actions">
                        <button className="icon-btn" title="Umbenennen" aria-label={`${folder.name} umbenennen`} onClick={() => setDialog({ type: 'rename', item: folder, isFolder: true })}><EditIcon size={16} /></button>
                        <button className="icon-btn" title="Verschieben" aria-label={`${folder.name} verschieben`} onClick={() => setDialog({ type: 'move', item: folder, isFolder: true })}><MoveIcon size={16} /></button>
                        <button className="icon-btn danger" title="Löschen" aria-label={`${folder.name} löschen`} onClick={() => setDialog({ type: 'delete', item: folder, isFolder: true })}><TrashIcon size={16} /></button>
                      </div>
                    </td>
                  </tr>
                ))}
                {fileList.map((file) => {
                  const kind = fileKind(file.name);
                  return (
                    <tr key={file.id}>
                      <td>
                        <button
                          className="name-cell"
                          onClick={() => (file.previewable ? openPreview(file) : download(file))}
                          title={file.previewable ? 'Vorschau öffnen' : 'Herunterladen'}
                        >
                          <KindIcon kind={kind} className={`kind-icon kind-${kind}`} />
                          <span className="name-text">{file.name}</span>
                        </button>
                        <span className="mobile-meta muted small">{formatSize(file.size)} · {formatDate(file.createdAt)}</span>
                      </td>
                      <td className="col-size muted">{formatSize(file.size)}</td>
                      <td className="col-date muted">{formatDate(file.createdAt)}</td>
                      <td className="col-actions">
                        <div className="row-actions">
                          {file.previewable && (
                            <button className="icon-btn" title="Vorschau" aria-label={`Vorschau ${file.name}`} onClick={() => openPreview(file)}><EyeIcon size={16} /></button>
                          )}
                          <button className="icon-btn" title="Herunterladen" aria-label={`${file.name} herunterladen`} onClick={() => download(file)}><DownloadIcon size={16} /></button>
                          <button className="icon-btn" title="Umbenennen" aria-label={`${file.name} umbenennen`} onClick={() => setDialog({ type: 'rename', item: file, isFolder: false })}><EditIcon size={16} /></button>
                          <button className="icon-btn" title="Verschieben" aria-label={`${file.name} verschieben`} onClick={() => setDialog({ type: 'move', item: file, isFolder: false })}><MoveIcon size={16} /></button>
                          <button className="icon-btn danger" title="Löschen" aria-label={`${file.name} löschen`} onClick={() => setDialog({ type: 'delete', item: file, isFolder: false })}><TrashIcon size={16} /></button>
                        </div>
                      </td>
                    </tr>
                  );
                })}
                {folders.length === 0 && fileList.length === 0 && (
                  <tr><td colSpan={4} className="muted no-results">Keine Treffer für „{search}“.</td></tr>
                )}
              </tbody>
            </table>
          )}
        </div>
        {!isEmpty && data && (
          <p className="muted small hint">Tipp: Dateien einfach ins Fenster ziehen, um sie hochzuladen.</p>
        )}
      </main>

      <UploadPanel uploads={uploads} onCancel={cancelUpload} onClear={clearFinished} />

      {dragActive && (
        <div className="drop-overlay" aria-hidden="true">
          <div className="drop-overlay-inner">
            <UploadIcon size={48} />
            <strong>Dateien hier ablegen</strong>
            <span>Upload nach „{data?.folder?.name ?? 'Start'}“</span>
          </div>
        </div>
      )}

      {dialog && dialogs[dialog.type](dialog)}

      {preview && (
        <PreviewModal
          file={preview}
          siblings={previewable}
          onNavigate={setPreview}
          onClose={() => setPreview(null)}
        />
      )}
    </div>
  );
}
