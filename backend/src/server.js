import path from 'node:path';
import express from 'express';
import helmet from 'helmet';
import cookieParser from 'cookie-parser';
import multer from 'multer';
import { config } from './config.js';
import { authRouter, getSetupCode } from './auth.js';
import { cleanupOrphans, filesRouter } from './files.js';
import { HttpError } from './util.js';

const app = express();
app.disable('x-powered-by');
app.set('trust proxy', config.trustProxy);

app.use(helmet({
  contentSecurityPolicy: {
    directives: {
      'img-src': ["'self'", 'data:', 'blob:'],
      'frame-src': ["'self'"],
      'upgrade-insecure-requests': null, // sonst bricht der Zugriff per http:// im LAN
    },
  },
  strictTransportSecurity: config.cookieSecure,
}));
app.use(express.json({ limit: '100kb' }));
app.use(cookieParser());

// CSRF-Schutz zusätzlich zu SameSite=Strict: schreibende API-Aufrufe müssen einen
// eigenen Header tragen, den fremde Seiten ohne CORS-Freigabe nicht setzen können.
app.use('/api', (req, res, next) => {
  if (['GET', 'HEAD', 'OPTIONS'].includes(req.method)) return next();
  if (req.get('X-Requested-With') !== 'privat-cloud') {
    return res.status(403).json({ error: 'Ungültige Anfrage (CSRF-Header fehlt)' });
  }
  next();
});

app.get('/api/health', (req, res) => res.json({ ok: true }));
app.use('/api/auth', authRouter);
app.use('/api', filesRouter);
app.use('/api', (req, res) => res.status(404).json({ error: 'Nicht gefunden' }));

// Im Produktivbetrieb liefert das Backend auch das gebaute Frontend aus.
if (config.staticDir) {
  app.use(express.static(config.staticDir, { index: false, maxAge: '1h' }));
  app.get('/{*splat}', (req, res) => {
    res.set('Cache-Control', 'no-cache');
    res.sendFile(path.join(config.staticDir, 'index.html'));
  });
}

// eslint-disable-next-line no-unused-vars
app.use((err, req, res, next) => {
  if (err instanceof HttpError) return res.status(err.status).json({ error: err.message });
  if (err instanceof multer.MulterError) {
    const messages = {
      LIMIT_FILE_SIZE: [413, `Datei zu groß (max. ${Math.round(config.maxFileSizeBytes / 1024 / 1024)} MB).`],
      LIMIT_FILE_COUNT: [413, `Zu viele Dateien (max. ${config.maxFilesPerUpload} pro Upload).`],
      LIMIT_UNEXPECTED_FILE: [400, 'Unerwartetes Upload-Feld (erwartet: "files").'],
    };
    const [status, message] = messages[err.code] ?? [400, `Upload-Fehler: ${err.message}`];
    return res.status(status).json({ error: message });
  }
  if (err.type === 'entity.parse.failed') return res.status(400).json({ error: 'Ungültiges JSON' });
  if (err.type === 'entity.too.large') return res.status(413).json({ error: 'Anfrage zu groß' });
  if (err.status === 404 || err.code === 'ENOENT') return res.status(404).json({ error: 'Nicht gefunden' });

  console.error(err);
  res.status(500).json({ error: 'Interner Serverfehler' });
});

const orphans = cleanupOrphans();
if (orphans) console.log(`${orphans} verwaiste Datei(en) entfernt.`);

app.listen(config.port, config.host, () => {
  console.log(`privat-cloud läuft auf http://localhost:${config.port}`);
  console.log(`Daten: ${config.dataDir}`);
  const setupCode = getSetupCode();
  if (setupCode) {
    console.log('');
    console.log('  Noch nicht eingerichtet. Einrichtungscode für den ersten Aufruf:');
    console.log(`      ${setupCode}`);
    console.log('');
  }
  if (!config.staticDir) console.log('Kein Frontend-Build gefunden – nur API aktiv (Frontend via Vite-Dev-Server).');
});
