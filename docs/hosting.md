# Öffentlich erreichbar machen

Mit dieser Anleitung erreichst du deine Instanz über eine feste **HTTPS-URL** von jedem Gerät aus (PC, Smartphone, Tablet), auch unterwegs.

## Warum nicht GitHub Pages?

GitHub Pages liefert nur statische Dateien aus. Privat Cloud braucht aber einen laufenden Server: das Node.js-Backend für Login und Uploads, die SQLite-Datenbank und Speicherplatz für die Dateien. Deshalb läuft die komplette App auf einem eigenen Gerät, z. B. einem PC, Raspberry Pi oder VPS. Ein **Tunnel** macht sie dann sicher öffentlich erreichbar.

Ein Tunnel hat diese Vorteile:

- keine Portfreigabe am Router und keine feste IP nötig
- HTTPS-Zertifikat inklusive
- deine IP-Adresse bleibt verborgen

Das Gerät muss dafür dauerhaft laufen. Sparsam sind z. B. ein Raspberry Pi 4/5 oder ein Mini-PC.

## Variante 1: Cloudflare Tunnel (eigene Domain)

**Voraussetzungen:** ein kostenloses Cloudflare-Konto und eine eigene Domain, deren DNS bei Cloudflare liegt. Eine Domain kostet ab ca. 10 €/Jahr und lässt sich auch direkt bei Cloudflare kaufen.

1. **Tunnel anlegen:** Im [Cloudflare-Zero-Trust-Dashboard](https://one.dash.cloudflare.com/) gehst du zu *Networks → Tunnels → Create a tunnel* und wählst *Cloudflared*. Vergib einen Namen, z. B. `privat-cloud`.
2. **Token kopieren:** Im Installationsschritt zeigt Cloudflare einen Befehl mit einem langen Token (`eyJ…`). Kopiere nur das Token. Installieren musst du nichts, das übernimmt Docker Compose.
3. **Hostname eintragen:** Unter *Public Hostname* legst du an:
   - Subdomain/Domain: z. B. `cloud.deine-domain.de`
   - Service: Typ `HTTP`, URL `privat-cloud:3000`
4. **`.env` anlegen** (im Projektordner):

   ```bash
   cp .env.example .env
   ```

   Danach setzt du in der `.env`:

   ```ini
   COOKIE_SECURE=true
   TRUST_PROXY=1
   CLOUDFLARE_TUNNEL_TOKEN=eyJ...dein-token...
   # Optional: App nur über den Tunnel erreichbar, nicht mehr im Heimnetz
   PUBLISH_ADDRESS=127.0.0.1
   ```

5. **Starten:**

   ```bash
   docker compose --profile tunnel up -d --build
   ```

6. **Einrichten:** Hol dir den Einrichtungscode mit dem folgenden Befehl und öffne dann `https://cloud.deine-domain.de`:

   ```bash
   docker compose logs privat-cloud
   ```

**Hinweise:**

- Im kostenlosen Plan begrenzt Cloudflare Uploads auf **100 MB pro Request**. Lass `MAX_FILE_SIZE_MB` deshalb höchstens auf `100`.
- Für eine zusätzliche Schutzschicht kannst du unter *Access → Applications* eine Anmeldung per E-Mail-Code vor die App schalten. Dann sehen Fremde nicht einmal die Login-Seite.

## Variante 2: Tailscale Funnel (ohne eigene Domain)

**Voraussetzungen:** ein kostenloses [Tailscale](https://tailscale.com/)-Konto. Die URL hat dann die Form `https://<gerätename>.<tailnet-name>.ts.net`.

1. **App starten**, wie im README beschrieben. Lege in der `.env` fest:

   ```ini
   COOKIE_SECURE=true
   TRUST_PROXY=0
   ```

   Danach startest du die App:

   ```bash
   docker compose up -d --build
   ```

2. **Tailscale auf dem Host installieren** und anmelden: siehe [tailscale.com/download](https://tailscale.com/download). Unter Linux:

   ```bash
   curl -fsSL https://tailscale.com/install.sh | sh
   ```

   ```bash
   sudo tailscale up
   ```

3. **Funnel aktivieren.** Der Befehl unten führt dich beim ersten Mal durch die Freigabe von HTTPS und Funnel in der Tailscale-Admin-Konsole:

   ```bash
   sudo tailscale funnel --bg 3000
   ```

4. **Prüfen:** Der folgende Befehl zeigt die öffentliche URL. Den Einrichtungscode findest du wie oben über `docker compose logs privat-cloud`.

   ```bash
   tailscale funnel status
   ```

`TRUST_PROXY=0` ist hier Absicht: Alle Anfragen kommen lokal vom Tailscale-Dienst. Damit teilen sich alle Clients ein gemeinsames Limit für Login-Versuche. Das ist die sichere Wahl, weil sich das Limit so nicht durch gefälschte Header umgehen lässt.

## Checkliste für den öffentlichen Betrieb

- [ ] Einrichtung abgeschlossen. Ohne Einrichtungscode aus dem Server-Log kann niemand die Instanz übernehmen.
- [ ] Starkes Passwort, idealerweise aus einem Passwort-Manager
- [ ] `COOKIE_SECURE=true` gesetzt
- [ ] Regelmäßige Backups des Volumes `privat-cloud-data` (siehe README)
- [ ] Updates einspielen:

  ```bash
  git pull
  ```

  ```bash
  docker compose --profile tunnel up -d --build
  ```
