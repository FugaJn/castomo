# Castomo / キャストモ

Online community for anglers across Japan: homespot tide page, trip board with ride sharing, catches, private groups, chat, friends-first feed, EN/JP, light/dark. Includes an admin dashboard and a feedback inbox.

Node 22.5+ (uses the built-in `node:sqlite`). No npm install needed.

## Run

    node server.js                      # http://localhost:3000
    PORT=8080 DATA_DIR=/var/lib/castomo node server.js

Data lives in `DATA_DIR` (default `./data`): `castomo.db` (SQLite) and `uploads/` (photos). Back up that folder.

| Variable | Purpose |
|---|---|
| `PORT`, `HOST` | listen address (default 3000, 0.0.0.0) |
| `DATA_DIR` | where the database and photos are stored |
| `COOKIE_SECURE=1` | set when served over HTTPS (do this in production) |
| `TRUST_PROXY=1` | set when behind nginx/Caddy/Cloudflare so rate limits see real IPs |
| `ADMIN_SETUP_CODE` | optional secret (16+ chars) to claim the first owner from the browser |

Put it behind a reverse proxy that terminates HTTPS (Caddy is the simplest), keep the process alive with systemd or a host like Fly.io / Render / a VPS with a persistent disk.

## Admin accounts (the whitelist)

Admin rights are a `role` column on the user (`user` / `admin` / `owner`), checked in the database on every request. There is no nickname or email list in code, because anyone can register any free nickname.

1. Register your normal account in the app.
2. Make yourself the first owner, either way:
   - On the server: `node admin.js grant <your-nickname> owner`
   - Or set `ADMIN_SETUP_CODE`, restart, open your account menu and enter the code (works only while no owner exists).
3. Open the **Admin** tab, then **Admins**: owners add or remove admins by nickname. Admins can manage spots, feedback and moderate content; only owners change the admin list.

Other CLI: `node admin.js list`, `node admin.js revoke <nickname>`. Every admin action is written to the Activity log.

## Tests

    npm test

## Tide and weather data

- **Tide:** official Japan Meteorological Agency (JMA) tide-table predictions for the nearest of 239 JMA stations (hourly levels plus exact high/low times), downloaded once per year per station and cached in `DATA_DIR/cache`.
- **Weather, wind, sunrise/sunset:** Open-Meteo (free, no API key), cached 30 minutes.
- Each spot has coordinates (editable in Admin > Spots; required for new spots). Freshwater spots show weather only.
- Tide is a prediction for the nearest station, not your exact spot, and does not include weather effects (storm surge, pressure). The home page names the station and distance.
- If the data cannot be loaded, the page says so and shows clearly labelled SAMPLE numbers instead.
- Check it works from your server: open `https://YOUR-SITE/api/forecast/nagoya` and look for `"station":{"code":"NG"...}` and 7 days of data. Server logs print `[forecast] ...` lines if JMA or Open-Meteo cannot be reached.
