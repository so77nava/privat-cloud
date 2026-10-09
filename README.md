# Privat Cloud

Eine schlanke, selbst hostbare Dateiverwaltung für den privaten Gebrauch: Dateien hochladen, in Ordnern organisieren, ansehen, herunterladen, umbenennen und löschen. Das Ganze ist durch ein Passwort geschützt.

**Stack:** Node.js + Express 5 · SQLite (better-sqlite3) · React 19 + Vite · Dateien im lokalen Dateisystem

## Funktionen

- Upload per Drag & Drop oder Dateiauswahl (Mehrfachauswahl, Fortschrittsanzeige, 3 parallel)
- Ordnerstruktur mit Breadcrumbs, Verschieben von Dateien und Ordnern
- Liste mit Name, Größe und Upload-Datum, sortierbar und durchsuchbar
- Vorschau für Bilder, PDFs und Textdateien (mit ←/→ blättern)
- Umbenennen, Löschen (Ordner rekursiv), Passwort ändern
- Dark Mode (folgt dem System, umschaltbar)
- Funktioniert auch auf dem Smartphone

## Schnellstart

### Variante A: Docker (empfohlen für den Dauerbetrieb)

```bash
docker compose up -d --build
```

Danach öffnest du <http://localhost:3000>. Beim ersten Aufruf legst du dein Passwort fest. Dafür brauchst du den **Einrichtungscode**, den der Server beim Start ins Log schreibt:

```bash
docker compose logs privat-cloud
```

Die Daten (Datenbank und Dateien) liegen im Docker-Volume `privat-cloud-data`.

**Von unterwegs und auf allen Geräten erreichbar machen:** siehe [docs/hosting.md](docs/hosting.md). Dort sind Cloudflare Tunnel und Tailscale Funnel beschrieben, beide mit HTTPS und ohne Portfreigabe.

### Variante B: Lokal mit Node.js (≥ 20.19)

```bash
npm install        # installiert auch backend/ und frontend/
npm run dev
```

- Frontend (Vite mit Hot Reload): <http://localhost:5173>
- Backend-API: <http://localhost:3000>; Vite leitet `/api` dorthin weiter
- Daten liegen in `backend/data/`
- Den Einrichtungscode für den ersten Aufruf zeigt das Terminal an

Für den Produktivbetrieb ohne Docker:

```bash
npm run build      # baut das Frontend nach frontend/dist
npm start          # Backend liefert API und Frontend auf Port 3000 aus
```

## Konfiguration

Alle Einstellungen laufen über Umgebungsvariablen. Lokal kopierst du dafür `backend/.env.example` nach `backend/.env`. Bei Docker kopierst du `.env.example` nach `.env` neben der `docker-compose.yml`. Alle Werte sind optional.

| Variable | Standard | Beschreibung |
|---|---|---|
| `PORT` | `3000` | Port des Servers |
| `DATA_DIR` | `./data` (Docker: `/data`) | Datenbank und Dateien |
| `JWT_SECRET` | automatisch | Mind. 32 Zeichen. Ist der Wert leer, wird ein Secret erzeugt und in `DATA_DIR/.jwt-secret` gespeichert |
| `SETUP_CODE` | zufällig | Einrichtungscode für den ersten Aufruf. Ist der Wert leer, wird beim Start ein Code erzeugt und ins Log geschrieben |
| `ACCESS_TOKEN_TTL_MINUTES` | `15` | Lebensdauer des Access Tokens |
| `REFRESH_TOKEN_TTL_DAYS` | `30` | Wie lange du angemeldet bleibst |
| `MAX_FILE_SIZE_MB` | `100` | Maximale Dateigröße |
| `MAX_FILES_PER_UPLOAD` | `20` | Maximale Anzahl Dateien pro Upload-Request |
| `ALLOWED_EXTENSIONS` | Dokumente, Bilder, Audio/Video, Archive | Kommagetrennt, z. B. `pdf,jpg,png,docx` |
| `MIN_PASSWORD_LENGTH` | `8` | Mindestlänge des Passworts |
| `COOKIE_SECURE` | `false` | Auf `true` setzen, sobald die App per HTTPS läuft |
| `TRUST_PROXY` | `0` | Hinter einem Reverse Proxy (nginx, Caddy, Traefik) auf `1` setzen |

## Sicherheit

- **Ein Konto, nur Passwort:** Die Instanz ist für eine Person gedacht. Das Konto wird beim ersten Aufruf angelegt, und zwar nur mit dem Einrichtungscode aus dem Server-Log. Danach ist keine Registrierung mehr möglich. So kann auch bei einer öffentlich erreichbaren Instanz niemand anderes die Einrichtung übernehmen. Das Passwort wird mit bcrypt (Kostenfaktor 12) gehasht.
- **JWT:** Das Access Token (HS256, 15 min) und das Refresh Token (zufällig, nur als SHA-256-Hash in der DB gespeichert, wird bei jeder Nutzung rotiert) liegen in `HttpOnly`- und `SameSite=Strict`-Cookies. JavaScript kann sie also nicht auslesen. Beim Logout und bei einer Passwortänderung werden die Tokens widerrufen.
- **CSRF:** Neben `SameSite=Strict` müssen alle schreibenden Requests den Header `X-Requested-With: privat-cloud` mitschicken.
- **Brute Force:** Login und Setup sind auf 10 Fehlversuche pro 15 Minuten und IP begrenzt.
- **Path Traversal:** Gespeichert wird jede Datei unter einer serverseitig erzeugten UUID. Der Originalname steht nur in der Datenbank. Benutzereingaben fließen nie in einen Dateipfad ein, und Pfade werden zusätzlich gegen das Speicherverzeichnis geprüft.
- **Uploads:** Größenlimit und Whitelist der Dateiendungen prüft der Server, nicht nur der Browser. Den MIME-Typ leitet der Server selbst aus der Endung ab. HTML und SVG sind nicht erlaubt.
- **Auslieferung:** Downloads gehen als `attachment` mit `nosniff` raus. Inline-Vorschauen gibt es nur für Bilder, PDFs und Text (als `text/plain`), Bilder und Text zusätzlich unter einer CSP-Sandbox. Dazu kommen Security-Header über helmet.

**Zugriff aus dem Internet:** Betreibe die App nur mit HTTPS, siehe [docs/hosting.md](docs/hosting.md). Ohne HTTPS gehen Passwort und Cookies im Klartext über die Leitung.

## Backup

Sichere das Datenverzeichnis: `backend/data/` bzw. das Docker-Volume `privat-cloud-data`. Es enthält die SQLite-Datenbank und den Ordner `files/`. Für ein konsistentes Backup stoppst du den Container vorher kurz:

```bash
docker compose stop
docker run --rm -v privat-cloud-data:/data -v "$PWD":/backup alpine tar czf /backup/privat-cloud-backup.tgz -C /data .
docker compose start
```

**Passwort vergessen?** Stoppe die App und lösche in der Datenbank den Inhalt der Tabelle `users` (z. B. mit `sqlite3 privat-cloud.sqlite "DELETE FROM users;"`). Nach dem Neustart gibt der Server einen neuen Einrichtungscode aus, mit dem du ein neues Passwort festlegst. Die Dateien bleiben dabei erhalten.

## Projektstruktur

```
privat-Cloud/
├── backend/
│   ├── src/
│   │   ├── server.js   # Express-App, Security-Header, Fehlerbehandlung, Auslieferung des Frontends
│   │   ├── config.js   # Umgebungsvariablen und Defaults
│   │   ├── db.js       # SQLite-Schema
│   │   ├── auth.js     # Setup, Login, Refresh, Logout, Passwort ändern, requireAuth
│   │   ├── files.js    # Ordner- und Datei-Endpunkte, Upload (multer)
│   │   ├── mime.js     # MIME-Typen und Vorschau-Whitelist
│   │   └── util.js     # Namensbereinigung, Hilfsfunktionen
│   └── .env.example
├── frontend/
│   ├── src/
│   │   ├── api.js      # fetch/XHR-Wrapper mit automatischem Token-Refresh
│   │   ├── App.jsx     # Auth-Zustand, Toasts
│   │   ├── hooks.js    # Theme, Ordner-Routing über den URL-Hash
│   │   └── components/ # AuthScreen, FileManager, Dialoge, Vorschau, Upload-Panel, Icons
│   └── vite.config.js
├── docs/
│   └── hosting.md      # Öffentlich erreichbar machen (Cloudflare Tunnel, Tailscale Funnel)
├── Dockerfile
├── docker-compose.yml  # optionales Profil "tunnel" für Cloudflare
├── .env.example        # Konfiguration für Docker Compose
└── package.json        # Skripte: dev, build, start
```

## API-Überblick

Mit Ausnahme von `/api/health`, `/api/auth/status|setup|login|refresh|logout` brauchen alle Endpunkte eine Anmeldung.

| Methode | Pfad | Zweck |
|---|---|---|
| `GET` | `/api/auth/status` | `{ setupRequired, authenticated }` |
| `POST` | `/api/auth/setup` | `{ password, setupCode }` → legt das Konto an, setzt die Cookies |
| `POST` | `/api/auth/login` | `{ password }` → setzt die Cookies |
| `POST` | `/api/auth/refresh` · `/logout` | Tokens erneuern bzw. widerrufen |
| `POST` | `/api/auth/change-password` | `{ currentPassword, newPassword }` |
| `GET` | `/api/browse?folderId=` | Inhalt eines Ordners mit Breadcrumbs |
| `GET`/`POST` | `/api/folders` | Alle Ordner auflisten / Ordner anlegen `{ name, parentId }` |
| `PATCH`/`DELETE` | `/api/folders/:id` | Umbenennen oder verschieben `{ name?, parentId? }` / rekursiv löschen |
| `POST` | `/api/files?folderId=` | Upload (multipart, Feld `files`) |
| `GET` | `/api/files/:id/download` · `/preview` | Herunterladen / Vorschau |
| `PATCH`/`DELETE` | `/api/files/:id` | Umbenennen oder verschieben `{ name?, folderId? }` / löschen |
