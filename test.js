'use strict';
const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

process.env.ADMIN_SETUP_CODE = 'correct-horse-battery-staple';
const { createApp } = require('./server.js');

const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'castomo-'));
const app = createApp({ dataDir: dir });
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
  const add = await bob('POST', '/api/admin/spots', { en: 'Test Pier', ja: 'テスト埠頭', type: 's', pref: 'aichi' });
  assert.equal(add.status, 200);
  const id = add.body.id;
  assert.equal(id, 'test-pier');
  assert.equal((await bob('POST', '/api/admin/spots', { en: 'Test Pier', ja: 'テスト埠頭', type: 's', pref: 'aichi' })).status, 409);
  assert.equal((await bob('POST', '/api/admin/spots', { en: 'Bad', ja: 'x', type: 'zzz', pref: 'aichi' })).status, 400);
  assert.equal((await bob('POST', '/api/admin/spots', { en: 'Bad', ja: 'x', type: 's', pref: 'nowhere' })).status, 400);
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
