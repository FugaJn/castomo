'use strict';
const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

process.env.ADMIN_SETUP_CODE = 'correct-horse-battery-staple';
const { createApp } = require('./server.js');
const { parseJma, nearestStation } = require('./marine.js');

/* Fake JMA and Open-Meteo servers, in the documented formats, so tests never touch the internet. */
const mock = { calls: [], fail: false };
function jmaFile(year) {
  const lines = [];
  for (let d = new Date(Date.UTC(year, 0, 1)); d.getUTCFullYear() === year; d = new Date(d.getTime() + 86400000)) {
    const hourly = Array.from({ length: 24 }, (_, h) => String(Math.round(120 + 50 * Math.sin((h + d.getUTCDate()) / 12 * Math.PI))).padStart(3));
    const date = String(year % 100).padStart(2) + String(d.getUTCMonth() + 1).padStart(2) + String(d.getUTCDate()).padStart(2);
    lines.push(hourly.join('') + date + 'NG' + '1034163' + '9999999'.repeat(3) + '0421095' + '9999999'.repeat(3));
  }
  return lines.join('\n') + '\n';
}
function weatherJson(url) {
  const base = Date.now() + 9 * 3600000, time = [], temp = [], code = [], wind = [], dir = [], dtime = [], sunrise = [], sunset = [];
  for (let i = 0; i < 7; i++) {
    const day = new Date(base + i * 86400000).toISOString().slice(0, 10);
    dtime.push(day); sunrise.push(day + 'T06:24'); sunset.push(day + 'T16:58');
    for (let h = 0; h < 24; h++) { time.push(day + 'T' + String(h).padStart(2, '0') + ':00'); temp.push(10 + h / 4); code.push(h < 12 ? 0 : 61); wind.push(2 + h / 10); dir.push(h * 10); }
  }
  return JSON.stringify({ hourly: { time, temperature_2m: temp, weather_code: code, wind_speed_10m: wind, wind_direction_10m: dir }, daily: { time: dtime, sunrise, sunset } });
}
async function fetchText(url) {
  mock.calls.push(url);
  if (mock.fail) throw new Error('network down');
  if (url.startsWith('https://www.data.jma.go.jp/')) { const m = /txt\/(\d{4})\//.exec(url); return jmaFile(+m[1]); }
  if (url.startsWith('https://api.open-meteo.com/')) return weatherJson(url);
  if (url.startsWith('https://overpass-api.de/')) return JSON.stringify({ elements: [
    { type: 'node', id: 1, lat: 35.0, lng: 0, lon: 136.95, tags: { name: '知多 テスト釣り公園', 'name:en': 'Chita Test Fishing Park', leisure: 'fishing', man_made: 'pier' } },
    { type: 'way', id: 2, center: { lat: 36.2, lon: 139.1 }, tags: { name: '渡良瀬の釣り場', leisure: 'fishing', water: 'river' } },
    { type: 'node', id: 3, lat: 35.0, lon: 136.95, tags: { name: 'Same Place Dup', leisure: 'fishing' } },
    { type: 'node', id: 4, lat: 35.5, lon: 137.0, tags: { leisure: 'fishing' } },
    { type: 'node', id: 5, lat: 52.0, lon: 0.1, tags: { name: 'Not in Japan', leisure: 'fishing' } },
    { type: 'node', id: 6, lat: 35.09, lon: 136.89, tags: { name: 'Right on Nagoya Port', leisure: 'fishing' } }
  ] });
  throw new Error('unexpected url ' + url);
}

const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'castomo-'));
const app = createApp({ dataDir: dir, fetchText });
let base;
test.before(async () => { await new Promise((ok) => app.server.listen(0, '127.0.0.1', ok)); base = 'http://127.0.0.1:' + app.server.address().port; });
test.after(async () => { await app.close(); fs.rmSync(dir, { recursive: true, force: true }); });

function client() {
  let cookie = '';
  return async (method, url, body) => {
    const r = await fetch(base + url, { method, headers: { 'content-type': 'application/json', ...(cookie ? { cookie } : {}) }, body: body ? JSON.stringify(body) : undefined });
    const sc = r.headers.getSetCookie?.() || [];
    if (sc.length) cookie = sc.map((s) => s.split(';')[0]).join('; ');
    let j = null; try { j = await r.json(); } catch (_) { /* no body */ }
    return { status: r.status, body: j };
  };
}
const PW = 'Str0ng!Pass';
const alice = client(), bob = client(), carol = client();

test('static client and health', async () => {
  const r = await fetch(base + '/'); assert.equal(r.status, 200);
  assert.match(await r.text(), /Castomo/);
  assert.equal((await fetch(base + '/app.js')).status, 200);
  assert.equal((await fetch(base + '/api/health')).status, 200);
  assert.notEqual((await fetch(base + '/server.js')).status, 200);
  assert.notEqual((await fetch(base + '/../server.js')).status, 200);
});

test('password rules enforced', async () => {
  const c = client();
  for (const pw of ['Sh0rt!a', 'alllowercase1!', 'ALLUPPERCASE1!', 'NoNumbers!!', 'NoSpecial123A']) {
    const r = await c('POST', '/api/register', { nick: 'weak', password: pw });
    assert.equal(r.status, 400, pw);
  }
});

test('register, login, state', async () => {
  assert.equal((await alice('POST', '/api/register', { nick: 'alice', password: PW, spot: 'nagoya' })).status, 200);
  assert.equal((await bob('POST', '/api/register', { nick: 'bob', password: PW })).status, 200);
  assert.equal((await carol('POST', '/api/register', { nick: 'carol', password: PW })).status, 200);
  assert.equal((await client()('POST', '/api/register', { nick: 'ALICE', password: PW })).status, 409);
  assert.equal((await client()('POST', '/api/login', { nick: 'alice', password: 'wrong' })).status, 401);
  const s = await alice('GET', '/api/state');
  assert.equal(s.status, 200);
  assert.equal(s.body.me.nick, 'alice');
  assert.equal(s.body.me.admin, false);
});

test('non-admins cannot use admin API', async () => {
  assert.equal((await alice('GET', '/api/admin/overview')).status, 403);
  assert.equal((await alice('POST', '/api/admin/spots', { en: 'X Port', ja: 'X', type: 's', pref: 'aichi' })).status, 403);
  assert.equal((await alice('POST', '/api/admin/admins', { nick: 'alice' })).status, 403);
  assert.equal((await client()('GET', '/api/admin/overview')).status, 401);
});

test('owner claim needs the setup code and works once', async () => {
  assert.equal((await alice('POST', '/api/admin/claim', { code: 'nope' })).status, 403);
  assert.equal((await alice('POST', '/api/admin/claim', { code: process.env.ADMIN_SETUP_CODE })).status, 200);
  assert.equal((await bob('POST', '/api/admin/claim', { code: process.env.ADMIN_SETUP_CODE })).status, 409);
  const s = await alice('GET', '/api/state');
  assert.equal(s.body.me.owner, true);
});

test('owner manages the admin whitelist', async () => {
  assert.equal((await alice('POST', '/api/admin/admins', { nick: 'nobody-here' })).status, 404);
  assert.equal((await alice('POST', '/api/admin/admins', { nick: 'bob' })).status, 200);
  assert.equal((await bob('GET', '/api/admin/overview')).status, 200);
  assert.equal((await bob('POST', '/api/admin/admins', { nick: 'carol' })).status, 403, 'admins cannot add admins');
  const ov = (await alice('GET', '/api/admin/overview')).body;
  const bobRow = ov.admins.find((a) => a.nick === 'bob');
  const aliceRow = ov.admins.find((a) => a.nick === 'alice');
  assert.equal((await alice('DELETE', '/api/admin/admins/' + aliceRow.id)).status, 409, 'owner cannot be removed');
  assert.equal((await alice('DELETE', '/api/admin/admins/' + bobRow.id)).status, 200);
  assert.equal((await bob('GET', '/api/admin/overview')).status, 403, 'revocation is immediate');
  assert.equal((await alice('POST', '/api/admin/admins', { nick: 'bob' })).status, 200);
});

test('admin adds, edits and hides a spot', async () => {
  const add = await bob('POST', '/api/admin/spots', { en: 'Test Pier', ja: 'テスト埠頭', type: 's', pref: 'aichi', lat: 34.9, lng: 136.9 });
  assert.equal(add.status, 200);
  const id = add.body.id;
  assert.equal(id, 'test-pier');
  assert.equal((await bob('POST', '/api/admin/spots', { en: 'Test Pier', ja: 'テスト埠頭', type: 's', pref: 'aichi', lat: 34.9, lng: 136.9 })).status, 409);
  assert.equal((await bob('POST', '/api/admin/spots', { en: 'No Coords', ja: 'x', type: 's', pref: 'aichi' })).status, 400, 'coordinates are required');
  assert.equal((await bob('POST', '/api/admin/spots', { en: 'Abroad', ja: 'x', type: 's', pref: 'aichi', lat: 51.5, lng: -0.1 })).status, 400, 'must be in Japan');
  assert.equal((await bob('POST', '/api/admin/spots', { en: 'Bad', ja: 'x', type: 'zzz', pref: 'aichi', lat: 34.9, lng: 136.9 })).status, 400);
  assert.equal((await bob('POST', '/api/admin/spots', { en: 'Bad', ja: 'x', type: 's', pref: 'nowhere', lat: 34.9, lng: 136.9 })).status, 400);
  let spots = (await carol('GET', '/api/spots')).body.spots;
  assert.ok(spots.find((s) => s.id === id && s.active));
  assert.equal((await carol('PATCH', '/api/me', { spot: id })).status, 200);
  assert.equal((await bob('PATCH', '/api/admin/spots/' + id, { ja: 'テスト桟橋', active: false })).status, 200);
  spots = (await carol('GET', '/api/spots')).body.spots;
  assert.equal(spots.find((s) => s.id === id).active, false);
  assert.equal((await alice('PATCH', '/api/me', { spot: id })).status, 400, 'hidden spots cannot be chosen');
  const ov = (await bob('GET', '/api/admin/overview')).body;
  assert.ok(ov.audit.some((a) => a.action === 'spot.add'));
});

test('feedback flow', async () => {
  assert.equal((await client()('POST', '/api/feedback', { kind: 'bug', text: 'anon feedback' })).status, 401);
  assert.equal((await carol('POST', '/api/feedback', { kind: 'bug', text: 'hi' })).status, 400);
  assert.equal((await carol('POST', '/api/feedback', { kind: 'weird', text: 'long enough text' })).status, 400);
  assert.equal((await carol('POST', '/api/feedback', { kind: 'bug', text: 'The tide chart does not scroll', page: 'tide', lang: 'en' })).status, 200);
  const ov = (await bob('GET', '/api/admin/overview')).body;
  const fb = ov.feedback.find((f) => f.nick === 'carol');
  assert.ok(fb);
  assert.equal(fb.status, 'new');
  assert.equal((await bob('PATCH', '/api/admin/feedback/' + fb.id, { status: 'done', note: 'Fixed, thanks!' })).status, 200);
  assert.equal((await bob('PATCH', '/api/admin/feedback/' + fb.id, { status: 'bogus' })).status, 400);
  const mine = (await carol('GET', '/api/state')).body.feedback;
  assert.equal(mine.length, 1);
  assert.equal(mine[0].status, 'done');
  assert.equal(mine[0].note, 'Fixed, thanks!');
  assert.equal((await alice('GET', '/api/state')).body.feedback.length, 0, 'users only see their own feedback');
  const inbox = (await carol('GET', '/api/state')).body.inbox;
  assert.equal(inbox.length, 1, 'the reply lands in the inbox');
  assert.equal(inbox[0].kind, 'admin_reply');
  assert.equal(inbox[0].body, 'Fixed, thanks!');
  assert.match(inbox[0].ref_text, /tide chart/);
  assert.equal(inbox[0].read_at, null);
  assert.equal((await alice('GET', '/api/state')).body.inbox.length, 0, 'other users see nothing');
  await bob('PATCH', '/api/admin/feedback/' + fb.id, { status: 'done' });
  assert.equal((await carol('GET', '/api/state')).body.inbox.length, 1, 'no new message unless the reply text changed');
  await bob('PATCH', '/api/admin/feedback/' + fb.id, { note: 'Fixed, thanks! Please refresh.' });
  assert.equal((await carol('GET', '/api/state')).body.inbox.length, 2, 'a changed reply sends a new message');
  assert.equal((await client()('POST', '/api/inbox/read')).status, 401);
  assert.equal((await carol('POST', '/api/inbox/read')).status, 200);
  const after = (await carol('GET', '/api/state')).body.inbox;
  assert.ok(after.every((m) => m.read_at));
  assert.equal((await alice('DELETE', '/api/inbox/' + after[0].id)).status, 200);
  assert.equal((await carol('GET', '/api/state')).body.inbox.length, 2, 'cannot delete someone else\'s message');
  assert.equal((await carol('DELETE', '/api/inbox/' + after[0].id)).status, 200);
  assert.equal((await carol('GET', '/api/state')).body.inbox.length, 1);
  assert.equal((await carol('PATCH', '/api/admin/feedback/' + fb.id, { status: 'new' })).status, 403);
  assert.equal((await bob('DELETE', '/api/admin/feedback/' + fb.id)).status, 200);
});

test('trip board, join requests and chat', async () => {
  const p = await alice('POST', '/api/posts', { spot: 'nagoya', date: new Date(Date.now() + 86400000).toISOString().slice(0, 10), time: '06:00', fish: 'aji', meet: 'North gate', transport: 'car', seats: 2, note: '' });
  assert.equal(p.status, 200, JSON.stringify(p.body));
  const id = p.body.id;
  assert.equal((await carol('POST', `/api/posts/${id}/join`, { needRide: true, msg: 'hello' })).status, 200);
  const st = (await alice('GET', '/api/state')).body;
  const post = st.posts.find((x) => x.id === id);
  const req = post.requests[0];
  assert.ok(req);
  assert.equal((await bob('POST', `/api/posts/${id}/accept`, { uid: req.uid })).status >= 400, true, 'only host accepts');
  assert.equal((await alice('POST', `/api/posts/${id}/accept`, { uid: req.uid })).status, 200);
  const room = 'post-' + id;
  assert.equal((await carol('POST', `/api/rooms/${room}/messages`, { text: 'See you there' })).status, 200);
  assert.equal((await bob('POST', `/api/rooms/${room}/messages`, { text: 'intruder' })).status >= 400, true, 'non-members cannot post');
  assert.equal((await alice('POST', `/api/rooms/${room}/read`, {})).status, 200);
});

test('moderation: admin can delete another user post, user cannot', async () => {
  const st = (await alice('GET', '/api/state')).body;
  const id = st.posts[0].id;
  assert.ok((await carol('DELETE', '/api/posts/' + id)).status >= 400);
  assert.equal((await bob('DELETE', '/api/posts/' + id)).status, 200);
});

test('security headers and cookie flags', async () => {
  const r = await fetch(base + '/');
  assert.match(r.headers.get('content-security-policy') || '', /script-src 'self'/);
  const l = await fetch(base + '/api/login', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ nick: 'alice', password: PW }) });
  const sc = l.headers.get('set-cookie') || '';
  assert.match(sc, /HttpOnly/i);
  assert.match(sc, /SameSite=/i);
});

test('JMA parser reads the documented fixed-width format', () => {
  const hourly = ['125', '120', '115', '110', '105', '100', ' 98', '100', '105', '115', '140', '160', '163', '160', '150', '140', '130', '125', '120', '118', '117', '116', '115', '115'].join('');
  const line = hourly + '27 1 1' + 'TK' + '1034163' + '9999999'.repeat(3) + '0421095' + '9999999'.repeat(3);
  assert.equal(line.length, 136);
  const r = parseJma(line + '\n')['2027-01-01'];
  assert.equal(r.hourly.length, 24);
  assert.equal(r.hourly[0], 125);
  assert.deepEqual(r.highs, [{ m: 10 * 60 + 34, h: 163 }]);
  assert.deepEqual(r.lows, [{ m: 4 * 60 + 21, h: 95 }]);
});

test('nearest tide station', () => {
  assert.equal(nearestStation(35.08, 136.88).code, 'NG');
  assert.equal(nearestStation(34.69, 136.99, 'morozaki').km < 40, true);
  assert.equal(nearestStation(35.5, 140.43, 'kujukuri').code, 'ZF', 'override for the Pacific coast');
  assert.equal(nearestStation(40, 150), null, 'open ocean has no station');
});

test('forecast: live tide and weather for a saltwater spot', async () => {
  const r = await carol('GET', '/api/forecast/nagoya');
  assert.equal(r.status, 200);
  assert.equal(r.body.tide.station.code, 'NG');
  assert.equal(r.body.tide.days.length, 7);
  assert.equal(r.body.tide.days[0].hourly.length, 24);
  assert.deepEqual(r.body.tide.days[0].highs[0], { m: 634, h: 163 });
  assert.equal(r.body.weather.days.length, 7);
  assert.equal(r.body.weather.days[0].temp.length, 24);
  assert.equal(r.body.weather.days[0].sr, 6 * 60 + 24);
  const before = mock.calls.length;
  await carol('GET', '/api/forecast/nagoya');
  assert.equal(mock.calls.length, before, 'second request is served from cache');
});

test('forecast: freshwater has weather only, unknown spot 404', async () => {
  const r = await carol('GET', '/api/forecast/biwa-south');
  assert.equal(r.status, 200);
  assert.equal(r.body.tide.na, 'freshwater');
  assert.equal(r.body.weather.days.length, 7);
  assert.equal((await carol('GET', '/api/forecast/nope')).status, 404);
});

test('forecast: upstream failure degrades gracefully', async () => {
  mock.fail = true;
  const r = await carol('GET', '/api/forecast/hakodate');
  mock.fail = false;
  assert.equal(r.status, 200);
  assert.equal(r.body.tide.error, true);
  assert.equal(r.body.weather, null);
});

test('admin can fix a spot\'s coordinates', async () => {
  assert.equal((await bob('PATCH', '/api/admin/spots/nagoya', { lat: 99, lng: 136.9 })).status, 400);
  assert.equal((await bob('PATCH', '/api/admin/spots/nagoya', { lat: 35.09, lng: 136.89 })).status, 200);
  const s = (await carol('GET', '/api/spots')).body.spots.find((x) => x.id === 'nagoya');
  assert.equal(s.lat, 35.09);
});

test('private pins: create, edit, delete; never visible to anyone else', async () => {
  assert.equal((await client()('POST', '/api/pins', { name: 'x', lat: 35, lng: 137 })).status, 401);
  assert.equal((await carol('POST', '/api/pins', { name: 'Secret reef', note: 'only me', lat: 34.6123456, lng: 137.0123456 })).status, 200);
  assert.equal((await carol('POST', '/api/pins', { name: '', lat: 35, lng: 137 })).status, 400);
  assert.equal((await carol('POST', '/api/pins', { name: 'Abroad', lat: 51.5, lng: -0.1 })).status, 400);
  const mine = (await carol('GET', '/api/state')).body.pins;
  assert.equal(mine.length, 1);
  assert.equal(mine[0].lat, 34.61235, 'coordinates are rounded to about 1 m');
  for (const other of [alice, bob]) {
    const st = (await other('GET', '/api/state')).body;
    assert.equal(st.pins.length, 0, 'other users see no pins');
    assert.ok(!JSON.stringify(st).includes('Secret reef'), 'pin text is not anywhere in another user state');
  }
  assert.ok(!JSON.stringify((await bob('GET', '/api/admin/overview')).body).includes('Secret reef'), 'not in the admin dashboard either');
  const id = mine[0].id;
  assert.equal((await alice('PATCH', '/api/pins/' + id, { name: 'hacked' })).status, 404);
  assert.equal((await alice('DELETE', '/api/pins/' + id)).status, 200);
  assert.equal((await carol('GET', '/api/state')).body.pins.length, 1, 'someone else cannot delete it');
  assert.equal((await carol('PATCH', '/api/pins/' + id, { name: 'Renamed', note: '' })).status, 200);
  assert.equal((await carol('GET', '/api/state')).body.pins[0].name, 'Renamed');
  assert.equal((await carol('DELETE', '/api/pins/' + id)).status, 200);
  assert.equal((await carol('GET', '/api/state')).body.pins.length, 0);
});

test('pin limit per user', async () => {
  const d = client();
  await d('POST', '/api/register', { nick: 'dave', password: PW });
  for (let i = 0; i < 60; i++) assert.equal((await d('POST', '/api/pins', { name: 'p' + i, lat: 35, lng: 137 })).status, 200);
});

test('OpenStreetMap import: owner only, de-duplicates, classifies', async () => {
  assert.equal((await carol('POST', '/api/admin/import-osm')).status, 403);
  assert.equal((await bob('POST', '/api/admin/import-osm')).status, 403, 'admins are not enough, owner only');
  const r = await alice('POST', '/api/admin/import-osm');
  assert.equal(r.status, 200, JSON.stringify(r.body));
  assert.equal(r.body.found, 4, 'unnamed and non-Japan elements are dropped');
  assert.equal(r.body.unnamed, 1);
  assert.equal(r.body.added, 2, 'the two that are not within 300 m of an existing spot');
  const spots = (await carol('GET', '/api/spots')).body.spots;
  const a = spots.find((s) => s.id === 'osm-node-1'), b = spots.find((s) => s.id === 'osm-way-2');
  assert.equal(a.type, 's'); assert.equal(a.en, 'Chita Test Fishing Park'); assert.equal(a.ja, '知多 テスト釣り公園'); assert.equal(a.pref, 'aichi'); assert.equal(a.src, 'osm');
  assert.equal(b.type, 'f');
  const again = await alice('POST', '/api/admin/import-osm');
  assert.equal(again.body.added, 0, 'running it again adds nothing');
  assert.equal(spots.find((s) => s.id === 'osm-node-6'), undefined);
});

test('reports: users flag spam, admins delete it, author is told', async () => {
  // a spam post and a spam comment from carol, an off-topic catch from alice
  const day = new Date(Date.now() + 2 * 86400000).toISOString().slice(0, 10);
  const post = await carol('POST', '/api/posts', { spot: 'nagoya', date: day, time: '07:00', fish: 'aji', meet: 'Buy cheap watches at spam.example', transport: 'transit', seats: 0, note: 'BUY NOW' });
  assert.equal(post.status, 200, JSON.stringify(post.body));
  const photo = 'data:image/jpeg;base64,/9j/4AAQSkZJRgABAQAAAQABAAD/2wBDAA0JCgsKCA0LCgsODg0PEyAVExISEyccHhcgLikxMC4pLSwzOko+MzZGNywtQFdBRkxOUlNSMj5aYVpQYEpRUk//2wBDAQ4ODhMREyYVFSZPNS01T09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT0//wAARCAAIAAgDASIAAhEBAxEB/8QAHwAAAQUBAQEBAQEAAAAAAAAAAAECAwQFBgcICQoL/8QAtRAAAgEDAwIEAwUFBAQAAAF9AQIDAAQRBRIhMUEGE1FhByJxFDKBkaEII0KxwRVS0fAkM2JyggkKFhcYGRolJicoKSo0NTY3ODk6Q0RFRkdISUpTVFVWV1hZWmNkZWZnaGlqc3R1dnd4eXqDhIWGh4iJipKTlJWWl5iZmqKjpKWmp6ipqrKztLW2t7i5usLDxMXGx8jJytLT1NXW19jZ2uHi4+Tl5ufo6erx8vP09fb3+Pn6/8QAHwEAAwEBAQEBAQEBAQAAAAAAAAECAwQFBgcICQoL/8QAtREAAgECBAQDBAcFBAQAAQJ3AAECAxEEBSExBhJBUQdhcRMiMoEIFEKRobHBCSMzUvAVYnLRChYkNOEl8RcYGRomJygpKjU2Nzg5OkNERUZHSElKU1RVVldYWVpjZGVmZ2hpanN0dXZ3eHl6goOEhYaHiImKkpOUlZaXmJmaoqOkpaanqKmqsrO0tba3uLm6wsPExcbHyMnK0tPU1dbX2Nna4uPk5ebn6Onq8vP09fb3+Pn6/9oADAMBAAIRAxEAPwDNooor1zwz/9k=';
  const cat = await alice('POST', '/api/catches', { fish: 'aji', date: new Date().toISOString().slice(0, 10), size: 10, loc: { k: 'spot', v: 'nagoya' }, cap: 'my new car for sale', photo, tackle: {} });
  assert.equal(cat.status, 200, JSON.stringify(cat.body));
  const cm = await carol('POST', '/api/catches/' + cat.body.id + '/comments', { text: 'visit spam.example' });
  assert.equal(cm.status, 200, JSON.stringify(cm.body));
  const st = (await bob('GET', '/api/state')).body;
  const commentId = st.catches.find((x) => x.id === cat.body.id).comments[0].id;

  const rep = { reason: 'spam', note: 'ad' };
  assert.equal((await client()('POST', '/api/reports', { ...rep, type: 'post', id: post.body.id })).status, 401);
  assert.equal((await carol('POST', '/api/reports', { ...rep, type: 'post', id: post.body.id })).status, 400, 'cannot report your own');
  assert.equal((await alice('POST', '/api/reports', { ...rep, type: 'bogus', id: post.body.id })).status, 400);
  assert.equal((await alice('POST', '/api/reports', { type: 'post', id: post.body.id, reason: 'meh' })).status, 400);
  assert.equal((await alice('POST', '/api/reports', { ...rep, type: 'post', id: 'nope' })).status, 404);
  assert.equal((await alice('POST', '/api/reports', { ...rep, type: 'post', id: post.body.id })).status, 200);
  assert.equal((await alice('POST', '/api/reports', { ...rep, type: 'post', id: post.body.id })).status, 409, 'one report per user per item');
  assert.equal((await carol('POST', '/api/reports', { reason: 'not_fishing', type: 'catch', id: cat.body.id })).status, 200);
  assert.equal((await alice('POST', '/api/reports', { ...rep, type: 'comment', id: commentId })).status, 200);

  assert.equal((await carol('GET', '/api/admin/overview')).status, 403, 'regular users cannot see reports');
  const ov = (await bob('GET', '/api/admin/overview')).body;
  assert.equal(ov.counts.reportsOpen, 3);
  const rp = ov.reports.find((r) => r.type === 'post');
  assert.equal(rp.status, 'open'); assert.equal(rp.reporter, 'alice'); assert.equal(rp.snap.nick, 'carol'); assert.match(rp.snap.text, /spam\.example/); assert.equal(rp.live, true);
  const rc = ov.reports.find((r) => r.type === 'catch');
  assert.match(rc.snap.photo, /^\/uploads\//);

  assert.equal((await carol('POST', '/api/admin/reports/' + rp.id, { action: 'remove' })).status, 403);
  assert.equal((await bob('POST', '/api/admin/reports/' + rp.id, { action: 'nuke' })).status, 400);
  assert.equal((await bob('POST', '/api/admin/reports/' + rp.id, { action: 'remove' })).status, 200);
  assert.equal((await bob('POST', '/api/admin/reports/' + rp.id, { action: 'remove' })).status, 409, 'already handled');
  assert.ok(!(await bob('GET', '/api/state')).body.posts.some((p) => p.id === post.body.id), 'post is gone');
  const note = (await carol('GET', '/api/state')).body.inbox.find((m) => m.kind === 'moderation');
  assert.ok(note, 'author is told');
  assert.equal(note.body, 'post|spam');
  assert.match(note.ref_text, /spam\.example/);

  // remove the catch: photo file deleted too; its comment report becomes moot but stays open until handled
  assert.equal((await bob('POST', '/api/admin/reports/' + rc.id, { action: 'remove' })).status, 200);
  assert.ok(!(await bob('GET', '/api/state')).body.catches.some((x) => x.id === cat.body.id));
  assert.equal((await fetch(base + rc.snap.photo)).status, 404, 'image file removed');
  assert.ok((await alice('GET', '/api/state')).body.inbox.some((m) => m.kind === 'moderation' && m.body === 'catch|not_fishing'));

  // dismiss the remaining report
  const left = (await bob('GET', '/api/admin/overview')).body.reports.find((r) => r.status === 'open');
  assert.ok(left);
  assert.equal((await bob('POST', '/api/admin/reports/' + left.id, { action: 'dismiss' })).status, 200);
  const fin = (await bob('GET', '/api/admin/overview')).body;
  assert.equal(fin.counts.reportsOpen, 0);
  assert.ok(fin.audit.some((a) => a.action === 'report.remove'));
});

test('weather falls back to MET Norway when Open-Meteo refuses', async () => {
  const { createForecaster } = require('./marine.js');
  const now = Date.parse('2026-11-22T03:00:00Z'), ts = [];
  for (let i = 0; i < 90; i++) ts.push({ time: new Date(Math.floor(now / 36e5) * 36e5 + i * 36e5).toISOString(), data: { instant: { details: { air_temperature: 10, wind_speed: 3, wind_from_direction: 200 } }, next_1_hours: { summary: { symbol_code: 'rain' } } } });
  const f = createForecaster({ dataDir: fs.mkdtempSync(path.join(os.tmpdir(), 'wx-')), now: () => now, fetchText: async (u) => { if (u.includes('open-meteo')) throw new Error('HTTP 429'); return JSON.stringify({ properties: { timeseries: ts } }); } });
  const r = await f.forecast({ id: 'x', type: 'f', lat: 35.09, lng: 136.89 });
  assert.equal(r.weather.src, 'met.no');
  assert.equal(r.weather.days.length, 7);
  assert.equal(r.weather.days[0].code[14], 61);
  assert.ok(r.weather.days[0].sr > 380 && r.weather.days[0].sr < 400, 'sunrise near 6:30');
});

test('keep me logged in controls cookie lifetime', async () => {
  const login = (keep) => fetch(base + '/api/login', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ nick: 'alice', password: PW, keep }) });
  const on = (await login(true)).headers.get('set-cookie'), off = (await login(false)).headers.get('set-cookie');
  assert.match(on, /Max-Age=2592000/);
  assert.doesNotMatch(off, /Max-Age/);
});
