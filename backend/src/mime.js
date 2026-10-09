import { extensionOf } from './util.js';

// Der MIME-Typ wird ausschließlich serverseitig aus der Endung abgeleitet –
// der vom Browser gesendete Content-Type wird ignoriert.
const MIME_TYPES = {
  pdf: 'application/pdf',
  txt: 'text/plain',
  md: 'text/markdown',
  csv: 'text/csv',
  json: 'application/json',
  xml: 'application/xml',
  rtf: 'application/rtf',
  odt: 'application/vnd.oasis.opendocument.text',
  ods: 'application/vnd.oasis.opendocument.spreadsheet',
  odp: 'application/vnd.oasis.opendocument.presentation',
  doc: 'application/msword',
  docx: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  xls: 'application/vnd.ms-excel',
  xlsx: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  ppt: 'application/vnd.ms-powerpoint',
  pptx: 'application/vnd.openxmlformats-officedocument.presentationml.presentation',
  jpg: 'image/jpeg',
  jpeg: 'image/jpeg',
  png: 'image/png',
  gif: 'image/gif',
  webp: 'image/webp',
  bmp: 'image/bmp',
  heic: 'image/heic',
  mp3: 'audio/mpeg',
  wav: 'audio/wav',
  ogg: 'audio/ogg',
  flac: 'audio/flac',
  m4a: 'audio/mp4',
  mp4: 'video/mp4',
  mov: 'video/quicktime',
  mkv: 'video/x-matroska',
  webm: 'video/webm',
  zip: 'application/zip',
  '7z': 'application/x-7z-compressed',
  tar: 'application/x-tar',
  gz: 'application/gzip',
};

// Nur diese Formate werden inline (Vorschau) ausgeliefert. Bewusst ohne SVG/HTML,
// da diese Skripte enthalten können. Textformate gehen immer als text/plain raus.
const PREVIEW_TYPES = {
  jpg: 'image/jpeg',
  jpeg: 'image/jpeg',
  png: 'image/png',
  gif: 'image/gif',
  webp: 'image/webp',
  bmp: 'image/bmp',
  pdf: 'application/pdf',
  txt: 'text/plain; charset=utf-8',
  md: 'text/plain; charset=utf-8',
  csv: 'text/plain; charset=utf-8',
  json: 'text/plain; charset=utf-8',
  xml: 'text/plain; charset=utf-8',
};

export function mimeTypeFor(name) {
  return MIME_TYPES[extensionOf(name)] ?? 'application/octet-stream';
}

/** Content-Type für die Vorschau oder null, wenn keine Vorschau möglich ist. */
export function previewTypeFor(name) {
  return PREVIEW_TYPES[extensionOf(name)] ?? null;
}
