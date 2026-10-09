export function formatSize(bytes) {
  if (bytes < 1024) return `${bytes} B`;
  const units = ['KB', 'MB', 'GB', 'TB'];
  let value = bytes;
  let unit = -1;
  do {
    value /= 1024;
    unit++;
  } while (value >= 1024 && unit < units.length - 1);
  return `${value.toLocaleString('de-DE', { maximumFractionDigits: value < 10 ? 1 : 0 })} ${units[unit]}`;
}

const dateFormat = new Intl.DateTimeFormat('de-DE', { dateStyle: 'medium', timeStyle: 'short' });
export const formatDate = (iso) => dateFormat.format(new Date(iso));

export function extensionOf(name) {
  const dot = name.lastIndexOf('.');
  return dot > 0 ? name.slice(dot + 1).toLowerCase() : '';
}

const KINDS = {
  image: ['jpg', 'jpeg', 'png', 'gif', 'webp', 'bmp', 'heic'],
  pdf: ['pdf'],
  text: ['txt', 'md', 'csv', 'json', 'xml', 'rtf'],
  doc: ['doc', 'docx', 'odt', 'xls', 'xlsx', 'ods', 'ppt', 'pptx', 'odp'],
  audio: ['mp3', 'wav', 'ogg', 'flac', 'm4a'],
  video: ['mp4', 'mov', 'mkv', 'webm'],
  archive: ['zip', '7z', 'tar', 'gz'],
};

export function fileKind(name) {
  const ext = extensionOf(name);
  return Object.keys(KINDS).find((kind) => KINDS[kind].includes(ext)) ?? 'file';
}

/** Baut für die Ordnerliste vollständige Pfade ("A / B / C"), sortiert nach Pfad. */
export function folderPaths(folders) {
  const byId = new Map(folders.map((f) => [f.id, f]));
  const pathOf = (folder) => {
    const parts = [];
    for (let f = folder; f; f = byId.get(f.parentId)) parts.unshift(f.name);
    return parts.join(' / ');
  };
  return folders
    .map((f) => ({ ...f, path: pathOf(f) }))
    .sort((a, b) => a.path.localeCompare(b.path, 'de'));
}
