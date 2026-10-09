import Database from 'better-sqlite3';
import { config } from './config.js';

export const db = new Database(config.dbPath);
db.pragma('journal_mode = WAL');
db.pragma('foreign_keys = ON');

db.exec(`
  CREATE TABLE IF NOT EXISTS users (
    id            INTEGER PRIMARY KEY,
    password_hash TEXT    NOT NULL,
    token_version INTEGER NOT NULL DEFAULT 0,
    created_at    INTEGER NOT NULL
  );

  CREATE TABLE IF NOT EXISTS refresh_tokens (
    id         INTEGER PRIMARY KEY,
    user_id    INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    token_hash TEXT    NOT NULL UNIQUE,
    expires_at INTEGER NOT NULL,
    created_at INTEGER NOT NULL
  );

  CREATE TABLE IF NOT EXISTS folders (
    id         INTEGER PRIMARY KEY,
    name       TEXT    NOT NULL,
    parent_id  INTEGER REFERENCES folders(id) ON DELETE CASCADE,
    created_at INTEGER NOT NULL
  );
  CREATE UNIQUE INDEX IF NOT EXISTS folders_unique_name
    ON folders (IFNULL(parent_id, 0), name COLLATE NOCASE);

  -- id ist eine serverseitig erzeugte UUID und gleichzeitig der Dateiname auf der Platte.
  CREATE TABLE IF NOT EXISTS files (
    id         TEXT    PRIMARY KEY,
    folder_id  INTEGER REFERENCES folders(id) ON DELETE CASCADE,
    name       TEXT    NOT NULL,
    mime_type  TEXT    NOT NULL,
    size       INTEGER NOT NULL,
    created_at INTEGER NOT NULL
  );
  CREATE UNIQUE INDEX IF NOT EXISTS files_unique_name
    ON files (IFNULL(folder_id, 0), name COLLATE NOCASE);
`);
