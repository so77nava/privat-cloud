import path from 'node:path';
import { config } from './config.js';

export class HttpError extends Error {
  constructor(status, message) {
    super(message);
    this.status = status;
  }
}

const MAX_NAME_BYTES = 255;

/**
 * Bereinigt einen vom Client gelieferten Datei-/Ordnernamen. Namen werden nur als
 * Metadaten in der DB gespeichert (auf der Platte liegen UUIDs), trotzdem werden
 * Pfadtrenner und Steuerzeichen entfernt, damit Downloads überall sauber ankommen.
 * Gibt null zurück, wenn kein gültiger Name übrig bleibt.
 */
export function sanitizeName(raw) {
  if (typeof raw !== 'string') return null;
  let name = raw
    .normalize('NFC')
    .replace(/[\u0000-\u001f\u007f]/g, '')
    .replace(/[\\/<>:"|?*]/g, '_')
    .trim();
  if (!name || /^\.+$/.test(name)) return null;

  if (Buffer.byteLength(name) > MAX_NAME_BYTES) {
    const ext = path.extname(name);
    let base = name.slice(0, name.length - ext.length);
    while (base && Buffer.byteLength(base + ext) > MAX_NAME_BYTES) base = base.slice(0, -1);
    name = base ? base + ext : name.slice(0, 100);
  }
  return name;
}

export function extensionOf(name) {
  return path.extname(name).slice(1).toLowerCase();
}

export function isAllowedExtension(name) {
  return config.allowedExtensions.has(extensionOf(name));
}

/** Hängt " (1)", " (2)" … vor die Endung an, bis exists(name) false liefert. */
export function makeUnique(name, exists) {
  if (!exists(name)) return name;
  const ext = path.extname(name);
  const base = name.slice(0, name.length - ext.length);
  for (let i = 1; ; i++) {
    const candidate = `${base} (${i})${ext}`;
    if (!exists(candidate)) return candidate;
  }
}
