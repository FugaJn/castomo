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

## Feedback and replies

Any signed-in user can send a Bug / Idea / Other message (Feedback button). Admins see them in Admin > Feedback, set a status and write a reply. Saving a reply also sends it to that user's Inbox (header button, with an unread badge) labelled "Message from a Castomo admin". Editing the reply text sends a new message; changing only the status does not.

## Map

- **Map tab:** every active spot is pinned (clustered when zoomed out), coloured by saltwater / brackish / freshwater. Search by name or prefecture, filter by water type, tap a pin or list item to see the spot and the catches posted there. Tap a photo for full details with likes and comments.
- **Private pins:** "Add my pin", then tap the map. Pins are stored per user and returned only to their owner; they never appear in other users' data or in the admin dashboard. (Whoever has access to the server's database file could still read them, so keep `DATA_DIR` private and back it up securely.)
- **Base map:** Geospatial Information Authority of Japan (国土地理院) tiles, attribution shown on the map. Leaflet is bundled in `public/vendor` (no CDN).
- **More spots:** the 201 built-in spots are hand-picked. Owners can click Admin > Spots > "Import from OpenStreetMap" to add named fishing spots from OpenStreetMap (© OpenStreetMap contributors, ODbL). Coverage is partial; prefecture is taken from the nearest existing spot and saltwater/freshwater is guessed from tags and distance to the coast, so review imported spots and fix or hide wrong ones. Re-running only adds new ones.

## Tests

    npm test

## Tide and weather data

- **Tide:** official Japan Meteorological Agency (JMA) tide-table predictions for the nearest of 239 JMA stations (hourly levels plus exact high/low times), downloaded once per year per station and cached in `DATA_DIR/cache`.
- **Weather, wind, sunrise/sunset:** Open-Meteo (free, no API key), cached 30 minutes.
- Each spot has coordinates (editable in Admin > Spots; required for new spots). Freshwater spots show weather only.
- Tide is a prediction for the nearest station, not your exact spot, and does not include weather effects (storm surge, pressure). The home page names the station and distance.
- If the data cannot be loaded, the page says so and shows clearly labelled SAMPLE numbers instead.
- Check it works from your server: open `https://YOUR-SITE/api/forecast/nagoya` and look for `"station":{"code":"NG"...}` and 7 days of data. Server logs print `[forecast] ...` lines if JMA or Open-Meteo cannot be reached.

## Reports and moderation

Signed-in users see a **⚑ Report** link on other people's trip posts, catch photos and comments. They pick a reason (spam or advertising, not fishing related, other) and may add a note. Each user can report an item once, and not their own.

Admins see the reports in **Admin → Reports** (the tab shows the number of open reports):

- **Delete content** removes the post, the photo (including the file on disk) or the comment, closes every open report about it, and sends the author a message in their inbox saying an admin removed it and why.
- **Dismiss report** keeps the content and closes the report.

Every decision is written to the Activity log. Admins can still delete any post directly. Chat messages and banning users are not part of this. The database upgrades itself on start (schema v6).

## Keeping accounts and data on Render

Castomo stores everything (accounts, posts, photos, cached tide files) in `DATA_DIR`. Render's free web service has an ephemeral filesystem, so that folder is wiped on every deploy and restart and accounts disappear. To keep data:

1. Use a paid web service (Starter or higher).
2. Add a **Disk** to the service (Render dashboard → your service → Disks), mount path `/var/data`, 1 GB is plenty.
3. Set the environment variable `DATA_DIR=/var/data` and redeploy.

Disks are only available on paid services, and a service with a disk cannot run more than one instance.
