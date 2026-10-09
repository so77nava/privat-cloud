import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';
import dotenv from 'dotenv';

const backendRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
dotenv.config({ path: path.join(backendRoot, '.env'), quiet: true });

function env(name) {
  const value = process.env[name];
  return value === undefined || value.trim() === '' ? undefined : value.trim();
}

function positiveInt(name, fallback) {
  const raw = env(name);
  if (raw === undefined) return fallback;
  const value = Number(raw);
  if (!Number.isInteger(value) || value <= 0) {
    throw new Error(`Ungültiger Wert für ${name}: "${raw}" (positive Ganzzahl erwartet)`);
  }
  return value;
}

function bool(name, fallback) {
  const raw = env(name);
  if (raw === undefined) return fallback;
  return ['1', 'true', 'yes', 'on'].includes(raw.toLowerCase());
}

const DEFAULT_EXTENSIONS = [
  // Dokumente
  'pdf', 'txt', 'md', 'csv', 'json', 'xml', 'rtf', 'odt', 'ods', 'odp',
  'doc', 'docx', 'xls', 'xlsx', 'ppt', 'pptx',
  // Bilder
  'jpg', 'jpeg', 'png', 'gif', 'webp', 'bmp', 'heic',
  // Audio / Video
  'mp3', 'wav', 'ogg', 'flac', 'm4a', 'mp4', 'mov', 'mkv', 'webm',
  // Archive
  'zip', '7z', 'tar', 'gz',
];

const allowedExtensions = new Set(
  (env('ALLOWED_EXTENSIONS')?.split(',') ?? DEFAULT_EXTENSIONS)
    .map((ext) => ext.trim().toLowerCase().replace(/^\./, ''))
    .filter(Boolean),
);

const dataDir = path.resolve(backendRoot, env('DATA_DIR') ?? './data');
const filesDir = path.join(dataDir, 'files');
fs.mkdirSync(filesDir, { recursive: true });

/**
 * JWT-Secret: aus der Umgebung oder – falls nicht gesetzt – einmalig zufällig
 * erzeugt und im Datenverzeichnis abgelegt, damit Sessions Neustarts überleben.
 */
function loadJwtSecret() {
  const fromEnv = env('JWT_SECRET');
  if (fromEnv) {
    if (fromEnv.length < 32) throw new Error('JWT_SECRET muss mindestens 32 Zeichen lang sein.');
    return fromEnv;
  }
  const secretFile = path.join(dataDir, '.jwt-secret');
  if (fs.existsSync(secretFile)) return fs.readFileSync(secretFile, 'utf8').trim();
  const secret = crypto.randomBytes(64).toString('base64url');
  fs.writeFileSync(secretFile, secret, { mode: 0o600 });
  return secret;
}

const staticDir = path.resolve(backendRoot, env('STATIC_DIR') ?? '../frontend/dist');

export const config = {
  port: positiveInt('PORT', 3000),
  host: env('HOST') ?? '0.0.0.0',
  dataDir,
  filesDir,
  dbPath: path.join(dataDir, 'privat-cloud.sqlite'),
  jwtSecret: loadJwtSecret(),
  accessTokenTtlSeconds: positiveInt('ACCESS_TOKEN_TTL_MINUTES', 15) * 60,
  refreshTokenTtlDays: positiveInt('REFRESH_TOKEN_TTL_DAYS', 30),
  maxFileSizeBytes: positiveInt('MAX_FILE_SIZE_MB', 100) * 1024 * 1024,
  maxFilesPerUpload: positiveInt('MAX_FILES_PER_UPLOAD', 20),
  allowedExtensions,
  // Optional fester Einrichtungscode (sonst wird beim Start ein zufälliger erzeugt und geloggt)
  setupCode: env('SETUP_CODE') ?? null,
  minPasswordLength: positiveInt('MIN_PASSWORD_LENGTH', 8),
  cookieSecure: bool('COOKIE_SECURE', false),
  // Anzahl vertrauenswürdiger Reverse-Proxy-Hops (z. B. 1 hinter nginx/Caddy), 0 = keiner
  trustProxy: env('TRUST_PROXY') && env('TRUST_PROXY') !== '0' ? positiveInt('TRUST_PROXY', 1) : false,
  staticDir: fs.existsSync(path.join(staticDir, 'index.html')) ? staticDir : null,
};
