'use strict';
/*
 * Import fishing spots from OpenStreetMap (Overpass API) into the spots table.
 * OpenStreetMap data is © OpenStreetMap contributors, licensed ODbL (commercial use allowed with attribution).
 * Coverage in Japan is partial and tagging is inconsistent, so imported spots are a starting point: admins can edit or hide any of them.
 */
const { km } = require('./marine.js');
const STATIONS = require('./stations.js');

/* One query per region of Japan keeps each Overpass request small enough to finish (a single nationwide query is usually rejected or times out). Boxes overlap a little; duplicates are skipped by OSM id. */
const REGIONS = [
  ['Hokkaido', 41.3, 139.3, 45.6, 145.9], ['Tohoku', 37.7, 139.0, 41.6, 142.2], ['Kanto', 34.6, 138.2, 37.2, 141.0],
  ['Chubu', 34.5, 135.8, 38.6, 139.4], ['Kinki', 33.4, 134.0, 35.8, 136.9], ['Chugoku', 33.6, 130.7, 35.7, 134.5],
  ['Shikoku', 32.7, 132.0, 34.4, 134.8], ['Kyushu', 30.9, 128.6, 34.8, 132.2], ['Okinawa', 24.0, 122.9, 28.5, 131.4]
];
const ENDPOINTS = ['https://overpass-api.de/api/interpreter', 'https://overpass.kumi.systems/api/interpreter', 'https://overpass.private.coffee/api/interpreter'];
const queryFor = (r) => '[out:json][timeout:90][bbox:' + r.slice(1).join(',') + '];(' +
  'nwr["leisure"="fishing"];' +
  'nwr["sport"="fishing"];' +
  'nwr["man_made"="pier"]["fishing"="yes"];' +
  'nwr["name"~"海釣|釣り公園|釣公園|釣り場|釣場|釣り堀|釣堀|フィッシングパーク|フィッシングピア|Fishing (Park|Pier|Area|Spot)"][!"shop"][!"office"];' +
  'nwr["man_made"="pier"]["name"~"釣|Fishing"];' +
  ');out center tags;';
const urlFor = (endpoint, region) => endpoint + '?data=' + encodeURIComponent(queryFor(region));

const FRESH_WATER = new Set(['river', 'lake', 'pond', 'reservoir', 'canal', 'stream', 'stream_pool', 'oxbow', 'lagoon_fresh']);
const SALT_MAN_MADE = new Set(['pier', 'breakwater', 'groyne', 'jetty']);

function hasJapanese(s) { return /[぀-ヿ㐀-鿿]/.test(s); }

/* Decide saltwater / freshwater from OSM tags, else from distance to the nearest tide station (coastal = salt). */
function classify(tags, lat, lng) {
  if (SALT_MAN_MADE.has(tags.man_made)) return 's';
  if (tags.water && FRESH_WATER.has(tags.water)) return 'f';
  if (tags.waterway || tags.natural === 'water') return 'f';
  if (tags.natural === 'bay' || tags.natural === 'coastline' || tags.seamark) return 's';
  let best = Infinity;
  for (const s of STATIONS) { const d = km(lat, lng, s[2], s[3]); if (d < best) best = d; }
  return best <= 6 ? 's' : 'f';
}

/* Turn an Overpass response into candidate spots. */
function parseOverpass(json) {
  const out = [];
  let unnamed = 0;
  for (const el of (json && json.elements) || []) {
    const tags = el.tags || {};
    const lat = el.lat != null ? el.lat : el.center && el.center.lat;
    const lng = el.lon != null ? el.lon : el.center && el.center.lon;
    if (typeof lat !== 'number' || typeof lng !== 'number') continue;
    if (lat < 20 || lat > 46 || lng < 122 || lng > 154) continue;
    const name = tags.name || tags['name:ja'] || tags['name:en'];
    if (tags.shop || tags.office || tags.amenity === 'restaurant') continue;
    if (!name) { unnamed++; continue; }
    const ja = (tags['name:ja'] || (hasJapanese(name) ? name : tags.name || name)).slice(0, 60);
    const en = (tags['name:en'] || tags['name:ja_rm'] || tags.name || name).slice(0, 60);
    out.push({ osm_id: el.type + '/' + el.id, en, ja, lat: Math.round(lat * 1e5) / 1e5, lng: Math.round(lng * 1e5) / 1e5, type: classify(tags, lat, lng) });
  }
  return { spots: out, unnamed };
}

/* Insert new spots. Skips ones already imported, and ones within 300 m of an existing spot. Returns counts. */
function importSpots(db, tx, candidates) {
  const existing = db.prepare('SELECT id,lat,lng,pref,mean,a,p,p2,p3 FROM spots WHERE lat IS NOT NULL').all();
  const known = new Set(db.prepare('SELECT osm_id FROM spots WHERE osm_id IS NOT NULL').all().map((r) => r.osm_id));
  const ins = db.prepare('INSERT INTO spots(id,en,ja,type,pref,mean,a,p,p2,p3,lat,lng,builtin,active,src,osm_id,created_at) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,0,1,?,?,?)');
  const now = new Date().toISOString();
  let added = 0, dup = 0;
  tx(db, () => {
    for (const c of candidates) {
      if (known.has(c.osm_id)) { dup++; continue; }
      let near = null, best = Infinity;
      for (const e of existing) { const dx = (e.lng - c.lng) * 0.82, dy = e.lat - c.lat, d = dx * dx + dy * dy; if (d < best) { best = d; near = e; } }
      if (!near || km(c.lat, c.lng, near.lat, near.lng) < 0.3) { dup++; continue; }
      const id = 'osm-' + c.osm_id.replace('/', '-');
      ins.run(id, c.en, c.ja, c.type, near.pref, near.mean, near.a, near.p, near.p2, near.p3, c.lat, c.lng, 'osm', c.osm_id, now);
      existing.push({ id, lat: c.lat, lng: c.lng, pref: near.pref, mean: near.mean, a: near.a, p: near.p, p2: near.p2, p3: near.p3 });
      added++;
    }
  });
  return { added, duplicates: dup };
}

module.exports = { REGIONS, ENDPOINTS, queryFor, urlFor, parseOverpass, importSpots, classify };
