import crypto from 'node:crypto';
import { Router } from 'express';
import bcrypt from 'bcryptjs';
import jwt from 'jsonwebtoken';
import rateLimit from 'express-rate-limit';
import { config } from './config.js';
import { db } from './db.js';
import { HttpError } from './util.js';

const ACCESS_COOKIE = 'pc_access';
const REFRESH_COOKIE = 'pc_refresh';
const BCRYPT_ROUNDS = 12;
const MAX_PASSWORD_LENGTH = 72; // bcrypt verarbeitet maximal 72 Bytes

const baseCookie = () => ({ httpOnly: true, secure: config.cookieSecure, sameSite: 'strict' });
const accessCookie = () => ({ ...baseCookie(), path: '/api' });
const refreshCookie = () => ({ ...baseCookie(), path: '/api/auth' });

const hashToken = (token) => crypto.createHash('sha256').update(token).digest('hex');

const getUser = () => db.prepare('SELECT * FROM users ORDER BY id LIMIT 1').get();

// ---------- Einrichtungscode ----------
// Solange kein Konto existiert, ist für das Setup ein Code nötig, der nur im Server-Log
// steht (oder per SETUP_CODE vorgegeben wird). So kann bei einer öffentlich erreichbaren
// Instanz niemand anderes die Einrichtung übernehmen.

const SETUP_ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'; // ohne verwechselbare Zeichen
const normalizeCode = (code) => String(code ?? '').toUpperCase().replace(/[^A-Z0-9]/g, '');
let setupCode = null;

/** Liefert den aktuellen Einrichtungscode oder null, wenn die Instanz bereits eingerichtet ist. */
export function getSetupCode() {
  if (getUser()) return null;
  if (!setupCode) {
    if (config.setupCode) {
      setupCode = config.setupCode;
    } else {
      const chars = Array.from(crypto.randomBytes(8), (b) => SETUP_ALPHABET[b % SETUP_ALPHABET.length]);
      setupCode = `${chars.slice(0, 4).join('')}-${chars.slice(4).join('')}`;
    }
  }
  return setupCode;
}

function isValidSetupCode(input) {
  const expected = getSetupCode();
  if (!expected) return false;
  const a = crypto.createHash('sha256').update(normalizeCode(input)).digest();
  const b = crypto.createHash('sha256').update(normalizeCode(expected)).digest();
  return crypto.timingSafeEqual(a, b);
}

function issueSession(res, user) {
  const accessToken = jwt.sign({ type: 'access', ver: user.token_version }, config.jwtSecret, {
    subject: String(user.id),
    expiresIn: config.accessTokenTtlSeconds,
    algorithm: 'HS256',
  });

  const refreshToken = crypto.randomBytes(48).toString('base64url');
  const refreshMaxAge = config.refreshTokenTtlDays * 24 * 60 * 60 * 1000;
  const now = Date.now();
  db.prepare('DELETE FROM refresh_tokens WHERE expires_at < ?').run(now);
  db.prepare(
    'INSERT INTO refresh_tokens (user_id, token_hash, expires_at, created_at) VALUES (?, ?, ?, ?)',
  ).run(user.id, hashToken(refreshToken), now + refreshMaxAge, now);

  res.cookie(ACCESS_COOKIE, accessToken, { ...accessCookie(), maxAge: config.accessTokenTtlSeconds * 1000 });
  res.cookie(REFRESH_COOKIE, refreshToken, { ...refreshCookie(), maxAge: refreshMaxAge });
}

function clearSession(res) {
  res.clearCookie(ACCESS_COOKIE, accessCookie());
  res.clearCookie(REFRESH_COOKIE, refreshCookie());
}

/** Liefert den Benutzer zum Access-Token-Cookie oder null. */
function userFromRequest(req) {
  const token = req.cookies?.[ACCESS_COOKIE];
  if (!token) return null;
  try {
    const payload = jwt.verify(token, config.jwtSecret, { algorithms: ['HS256'] });
    if (payload.type !== 'access') return null;
    const user = db.prepare('SELECT * FROM users WHERE id = ?').get(Number(payload.sub));
    if (!user || user.token_version !== payload.ver) return null;
    return user;
  } catch {
    return null;
  }
}

export function requireAuth(req, res, next) {
  const user = userFromRequest(req);
  if (!user) return res.status(401).json({ error: 'Nicht angemeldet' });
  req.user = user;
  next();
}

function validateNewPassword(password) {
  if (typeof password !== 'string' || password.length < config.minPasswordLength) {
    throw new HttpError(400, `Das Passwort muss mindestens ${config.minPasswordLength} Zeichen lang sein.`);
  }
  if (Buffer.byteLength(password) > MAX_PASSWORD_LENGTH) {
    throw new HttpError(400, `Das Passwort darf höchstens ${MAX_PASSWORD_LENGTH} Bytes lang sein.`);
  }
}

const loginLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  limit: 10,
  standardHeaders: 'draft-8',
  legacyHeaders: false,
  skipSuccessfulRequests: true,
  message: { error: 'Zu viele Anmeldeversuche. Bitte in 15 Minuten erneut versuchen.' },
});

export const authRouter = Router();

authRouter.get('/status', (req, res) => {
  res.json({ setupRequired: !getUser(), authenticated: Boolean(userFromRequest(req)) });
});

authRouter.get('/me', requireAuth, (req, res) => {
  res.json({ id: req.user.id, createdAt: new Date(req.user.created_at).toISOString() });
});

// Ersteinrichtung: legt das (einzige) Konto an. Nur möglich, solange noch keins existiert.
authRouter.post('/setup', loginLimiter, async (req, res) => {
  const { password, setupCode: code } = req.body ?? {};
  if (getUser()) throw new HttpError(409, 'Die Instanz ist bereits eingerichtet.');
  if (!isValidSetupCode(code)) {
    throw new HttpError(403, 'Ungültiger Einrichtungscode. Du findest ihn im Server-Log.');
  }
  validateNewPassword(password);

  const hash = await bcrypt.hash(password, BCRYPT_ROUNDS);
  // Erneute Prüfung nach dem (asynchronen) Hashen – schützt vor parallelen Setup-Requests.
  const user = db.transaction(() => {
    if (getUser()) return null;
    const { lastInsertRowid } = db
      .prepare('INSERT INTO users (password_hash, created_at) VALUES (?, ?)')
      .run(hash, Date.now());
    return db.prepare('SELECT * FROM users WHERE id = ?').get(lastInsertRowid);
  })();
  if (!user) throw new HttpError(409, 'Die Instanz ist bereits eingerichtet.');

  issueSession(res, user);
  res.status(201).json({ ok: true });
});

authRouter.post('/login', loginLimiter, async (req, res) => {
  const { password } = req.body ?? {};
  const user = getUser();
  if (!user) throw new HttpError(409, 'Die Instanz ist noch nicht eingerichtet.');
  if (typeof password !== 'string' || !password || Buffer.byteLength(password) > MAX_PASSWORD_LENGTH) {
    throw new HttpError(401, 'Falsches Passwort.');
  }
  if (!(await bcrypt.compare(password, user.password_hash))) {
    throw new HttpError(401, 'Falsches Passwort.');
  }
  issueSession(res, user);
  res.json({ ok: true });
});

// Refresh-Token-Rotation: jedes Refresh-Token ist genau einmal verwendbar.
authRouter.post('/refresh', (req, res) => {
  const token = req.cookies?.[REFRESH_COOKIE];
  const row = token
    ? db.prepare('SELECT * FROM refresh_tokens WHERE token_hash = ?').get(hashToken(token))
    : null;
  if (row) db.prepare('DELETE FROM refresh_tokens WHERE id = ?').run(row.id);

  const user = row && row.expires_at > Date.now()
    ? db.prepare('SELECT * FROM users WHERE id = ?').get(row.user_id)
    : null;
  if (!user) {
    clearSession(res);
    return res.status(401).json({ error: 'Sitzung abgelaufen' });
  }
  issueSession(res, user);
  res.json({ ok: true });
});

authRouter.post('/logout', (req, res) => {
  const token = req.cookies?.[REFRESH_COOKIE];
  if (token) db.prepare('DELETE FROM refresh_tokens WHERE token_hash = ?').run(hashToken(token));
  clearSession(res);
  res.status(204).end();
});

// Passwort ändern – meldet alle anderen Sitzungen ab (token_version++ und Refresh-Tokens löschen).
authRouter.post('/change-password', requireAuth, async (req, res) => {
  const { currentPassword, newPassword } = req.body ?? {};
  if (typeof currentPassword !== 'string' || !(await bcrypt.compare(currentPassword, req.user.password_hash))) {
    throw new HttpError(400, 'Das aktuelle Passwort ist falsch.');
  }
  validateNewPassword(newPassword);
  const hash = await bcrypt.hash(newPassword, BCRYPT_ROUNDS);
  db.transaction(() => {
    db.prepare('UPDATE users SET password_hash = ?, token_version = token_version + 1 WHERE id = ?')
      .run(hash, req.user.id);
    db.prepare('DELETE FROM refresh_tokens WHERE user_id = ?').run(req.user.id);
  })();
  issueSession(res, db.prepare('SELECT * FROM users WHERE id = ?').get(req.user.id));
  res.json({ ok: true });
});
