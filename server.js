'use strict';
/*
 * Castomo server. Node 22.5+, no npm dependencies.
 *  - JSON API under /api, static client from /public
 *  - SQLite storage (node:sqlite), photos on disk under DATA_DIR/uploads
 *  - Cookie sessions, scrypt password hashing, Server-Sent Events for live updates
 */
const http = require('node:http');
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const { promisify } = require('node:util');
const scrypt = promisify(crypto.scrypt);
const D = require('./public/spots.js');
const { openDb, tx } = require('./db.js');

const PREF_IDS = new Set(D.PREFS.map((p) => p.id));
const REGION_IDS = new Set(D.REGIONS.map((r) => r.id));
const FISH_IDS = new Set(Object.keys(D.FISH));
const STYLE_IDS = new Set(Object.keys(D.STYLES));
const COOKIE = 'castomo_session';
const SESSION_MS = 30 * 24 * 3600 * 1000;
const MIME = {
  '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8',
  '.png': 'image/png', '.jpg': 'image/jpeg', '.svg': 'image/svg+xml', '.ico': 'image/x-icon', '.json': 'application/json',
  '.webmanifest': 'application/manifest+json'
};

class HttpError extends Error {
  constructor(status, code, message) { super(message || code); this.status = status; this.code = code; }
}
const bad = (code, msg) => new HttpError(400, code, msg);
const rid = () => crypto.randomBytes(8).toString('hex');
const nowISO = () => new Date().toISOString();
const sha = (s) => crypto.createHash('sha256').update(s).digest('hex');

function str(v, { min = 0, max = 200, name = 'field' } = {}) {
  if (v == null) v = '';
  if (typeof v !== 'string') throw bad('invalid_' + name);
  v = v.trim();
  if (v.length < min || v.length > max) throw bad('invalid_' + name);
  return v;
}
function intIn(v, min, max, name) {
  const n = Number(v);
  if (!Number.isInteger(n) || n < min || n > max) throw bad('invalid_' + name);
  return n;
}
function validDate(s) {
  if (typeof s !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(s)) return false;
  const d = new Date(s + 'T00:00:00Z');
  return !isNaN(d) && d.toISOString().slice(0, 10) === s;
}
function validTime(s) { return typeof s === 'string' && /^([01]\d|2[0-3]):[0-5]\d$/.test(s); }
function dayStr(offset) { return new Date(Date.now() + offset * 86400000).toISOString().slice(0, 10); }

/* password rules: 8+ chars with an uppercase letter, a lowercase letter, a number and a special character */
function checkPassword(pw) {
  if (typeof pw !== 'string' || pw.length > 64) throw bad('weak_password');
  const ok = pw.length >= 8 && /[A-Z]/.test(pw) && /[a-z]/.test(pw) && /[0-9]/.test(pw) && /[^A-Za-z0-9\s]/.test(pw);
  if (!ok) throw bad('weak_password');
  return pw;
}
async function hashPassword(pw) {
  const salt = crypto.randomBytes(16);
  const key = await scrypt(pw, salt, 64);
  return 'scrypt$' + salt.toString('base64') + '$' + key.toString('base64');
}
async function verifyPassword(pw, stored) {
  const [alg, saltB, keyB] = String(stored).split('$');
  if (alg !== 'scrypt') return false;
  const key = await scrypt(String(pw), Buffer.from(saltB, 'base64'), 64);
  const want = Buffer.from(keyB, 'base64');
  return key.length === want.length && crypto.timingSafeEqual(key, want);
}
const NICK_RE = /^[\p{L}\p{N}_.\-]{2,24}$/u;
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;

function createApp(opts = {}) {
  const dataDir = path.resolve(opts.dataDir || process.env.DATA_DIR || path.join(__dirname, 'data'));
  const publicDir = path.join(__dirname, 'public');
  const uploadDir = path.join(dataDir, 'uploads');
  fs.mkdirSync(uploadDir, { recursive: true });
  const db = openDb(path.join(dataDir, 'castomo.db'));
  const cookieSecure = opts.cookieSecure ?? process.env.COOKIE_SECURE === '1';
  const trustProxy = opts.trustProxy ?? process.env.TRUST_PROXY === '1';
  const q = (sql) => db.prepare(sql);
  const spotOk = (id) => typeof id === 'string' && !!q('SELECT 1 FROM spots WHERE id=? AND active=1').get(id);
  const isAdmin = (u) => !!u && (u.role === 'admin' || u.role === 'owner');
  const isOwner = (u) => !!u && u.role === 'owner';
  const setupCode = String(process.env.ADMIN_SETUP_CODE || '');
  let spotsRev = Date.now();
  function audit(user, action, target, detail) {
    q('INSERT INTO audit_log(actor,actor_nick,action,target,detail,created_at) VALUES(?,?,?,?,?,?)').run(user ? user.id : null, user ? user.nick : 'cli', action, String(target || '').slice(0, 80), String(detail || '').slice(0, 300), nowISO());
  }

  /* ---------- rate limiting (in memory) ---------- */
  const buckets = new Map();
  function limit(key, max, windowMs) {
    const now = Date.now();
    let b = buckets.get(key);
    if (!b || b.reset < now) { b = { n: 0, reset: now + windowMs }; buckets.set(key, b); }
    b.n++;
    if (b.n > max) throw new HttpError(429, 'rate_limited');
  }
  const sweep = setInterval(() => { const now = Date.now(); for (const [k, b] of buckets) if (b.reset < now) buckets.delete(k); q('DELETE FROM sessions WHERE expires_at < ?').run(nowISO()); }, 600000);
  sweep.unref();

  /* ---------- live updates (SSE) ---------- */
  const clients = new Set();
  function broadcast() { for (const res of clients) res.write('event: changed\ndata: {}\n\n'); }
  const beat = setInterval(() => { for (const res of clients) res.write(': ping\n\n'); }, 25000);
  beat.unref();

  /* ---------- sessions ---------- */
  function cookieOf(req, name) {
    const h = req.headers.cookie || '';
    for (const part of h.split(';')) { const i = part.indexOf('='); if (i > 0 && part.slice(0, i).trim() === name) return decodeURIComponent(part.slice(i + 1).trim()); }
    return '';
  }
  function setCookie(res, value, maxAge) {
    res.setHeader('Set-Cookie', `${COOKIE}=${value}; HttpOnly; SameSite=Lax; Path=/; Max-Age=${maxAge}${cookieSecure ? '; Secure' : ''}`);
  }
  function startSession(res, userId) {
    const token = crypto.randomBytes(32).toString('base64url');
    q('INSERT INTO sessions(token_hash,user_id,expires_at) VALUES(?,?,?)').run(sha(token), userId, new Date(Date.now() + SESSION_MS).toISOString());
    setCookie(res, token, Math.floor(SESSION_MS / 1000));
  }
  function userFromReq(req) {
    const t = cookieOf(req, COOKIE);
    if (!t) return null;
    return q('SELECT u.* FROM sessions s JOIN users u ON u.id=s.user_id WHERE s.token_hash=? AND s.expires_at>?').get(sha(t), nowISO()) || null;
  }
  function clientIp(req) {
    if (trustProxy) { const f = String(req.headers['x-forwarded-for'] || '').split(',')[0].trim(); if (f) return f; }
    return req.socket.remoteAddress || '';
  }

  /* ---------- helpers over the data ---------- */
  const needUser = (c) => { if (!c.user) throw new HttpError(401, 'login_required'); return c.user; };
  const json = (s, fb) => { try { return JSON.parse(s); } catch (_) { return fb; } };
  const isPostMember = (pid, uid) => !!q('SELECT 1 FROM post_members WHERE post_id=? AND user_id=?').get(pid, uid);
  const isGroupMember = (gid, uid) => !!q('SELECT 1 FROM group_members WHERE group_id=? AND user_id=?').get(gid, uid);
  const pair = (a, b) => (a < b ? [a, b] : [b, a]);
  const dmRoom = (a, b) => 'dm-' + pair(a, b).join('-');
  function addMessage(room, userId, text, sys) {
    const r = q('INSERT INTO messages(room,user_id,text,sys,created_at) VALUES(?,?,?,?,?)').run(room, userId, text || '', sys || '', nowISO());
    const id = Number(r.lastInsertRowid);
    if (!sys && userId) q('INSERT INTO reads(room,user_id,last_id) VALUES(?,?,?) ON CONFLICT(room,user_id) DO UPDATE SET last_id=MAX(last_id,excluded.last_id)').run(room, userId, id);
    return id;
  }
  function resolveRoom(user, key) {
    if (key === 'all') return { internal: 'all', kind: 'all' };
    let m;
    if ((m = /^region-([a-z]+)$/.exec(key)) && REGION_IDS.has(m[1])) return { internal: key, kind: 'region' };
    if ((m = /^post-([0-9a-f]{16})$/.exec(key))) { if (isPostMember(m[1], user.id)) return { internal: key, kind: 'post', id: m[1] }; throw new HttpError(403, 'forbidden'); }
    if ((m = /^group-([0-9a-f]{16})$/.exec(key))) { if (isGroupMember(m[1], user.id)) return { internal: key, kind: 'group', id: m[1] }; throw new HttpError(403, 'forbidden'); }
    if ((m = /^dm-([0-9a-f]{16})$/.exec(key))) {
      if (m[1] === user.id || !q('SELECT 1 FROM users WHERE id=?').get(m[1])) throw new HttpError(404, 'no_room');
      return { internal: dmRoom(user.id, m[1]), kind: 'dm', other: m[1] };
    }
    throw new HttpError(404, 'no_room');
  }
  function friendRow(a, b) { const [x, y] = pair(a, b); return q('SELECT * FROM friendships WHERE user_a=? AND user_b=?').get(x, y); }

  /* ---------- state for the client ---------- */
  function roomMessages(room, viewerId) {
    const rows = q('SELECT * FROM (SELECT * FROM messages WHERE room=? ORDER BY id DESC LIMIT 200) ORDER BY id').all(room);
    const status = /^(post|group|dm)-/.test(room);
    let reads = [];
    let allowed = null;
    if (status) {
      reads = q('SELECT user_id,last_id FROM reads WHERE room=?').all(room);
      const m = /^(post|group)-(.+)$/.exec(room);
      if (m) allowed = new Set((m[1] === 'post' ? q('SELECT user_id FROM post_members WHERE post_id=?') : q('SELECT user_id FROM group_members WHERE group_id=?')).all(m[2]).map((r) => r.user_id));
    }
    return rows.map((r) => ({
      id: r.id, u: r.user_id || '', t: r.created_at, x: r.text, sys: r.sys || '',
      seen: status && !r.sys ? reads.filter((x) => x.user_id !== r.user_id && x.last_id >= r.id && (!allowed || allowed.has(x.user_id))).map((x) => x.user_id) : []
    }));
  }
  function buildState(user) {
    const uid = user ? user.id : '';
    const users = q('SELECT u.id,u.nick,u.name,u.spot,u.style,u.target,u.bio,u.langs,u.fish,(SELECT COUNT(*) FROM post_members pm WHERE pm.user_id=u.id) AS trips FROM users u ORDER BY u.created_at').all()
      .map((u) => ({ id: u.id, nick: u.nick, name: u.name, spot: u.spot, style: u.style, target: u.target, bio: u.bio, langs: json(u.langs, []), fish: json(u.fish, []), trips: u.trips }));
    const me = user ? { id: user.id, nick: user.nick, name: user.name, email: user.email, spot: user.spot, style: user.style, target: user.target, bio: user.bio, role: user.role, admin: isAdmin(user), owner: isOwner(user) } : null;

    const friends = { accepted: [], incoming: [], outgoing: [] };
    if (user) {
      for (const f of q('SELECT * FROM friendships WHERE user_a=? OR user_b=?').all(uid, uid)) {
        const other = f.user_a === uid ? f.user_b : f.user_a;
        if (f.status === 'accepted') friends.accepted.push(other);
        else (f.requester === uid ? friends.outgoing : friends.incoming).push(other);
      }
    }

    const cutoff = dayStr(-1);
    const prow = q('SELECT * FROM posts WHERE date>=? ORDER BY date,time').all(cutoff);
    const members = {}, reqs = {};
    for (const m of q('SELECT post_id,user_id FROM post_members').all()) (members[m.post_id] = members[m.post_id] || []).push(m.user_id);
    for (const r of q('SELECT * FROM post_requests ORDER BY created_at').all()) (reqs[r.post_id] = reqs[r.post_id] || []).push(r);
    const posts = prow.map((p) => {
      const mem = members[p.id] || [];
      const inside = uid && mem.includes(uid);
      const mine = p.host === uid;
      const list = (reqs[p.id] || []).filter((r) => mine || r.user_id === uid).map((r) => ({ uid: r.user_id, needRide: !!r.need_ride, canDrive: !!r.can_drive, msg: r.msg }));
      return { id: p.id, host: p.host, date: p.date, time: p.time, spot: p.spot, custom: p.custom, meet: inside ? p.meet : '', fish: p.fish, transport: p.transport, seats: p.seats, seatsFree: p.seats_free, note: p.note, members: mem, requests: list };
    });

    const crow = q('SELECT * FROM catches ORDER BY when_date DESC, created_at DESC LIMIT 150').all();
    const likes = {}, comments = {};
    if (crow.length) {
      const ph = crow.map(() => '?').join(',');
      const ids = crow.map((c) => c.id);
      for (const l of q(`SELECT catch_id,user_id FROM catch_likes WHERE catch_id IN (${ph})`).all(...ids)) (likes[l.catch_id] = likes[l.catch_id] || []).push(l.user_id);
      for (const c of q(`SELECT * FROM catch_comments WHERE catch_id IN (${ph}) ORDER BY created_at`).all(...ids)) (comments[c.catch_id] = comments[c.catch_id] || []).push({ id: c.id, u: c.user_id, t: c.created_at, x: c.text });
    }
    const catches = crow.map((c) => {
      const showT = !!c.tackle_pub || c.by_user === uid;
      return {
        id: c.id, by: c.by_user, when: c.when_date, loc: { k: c.loc_k, v: c.loc_v }, fish: c.fish, size: c.size,
        photo: c.photo ? '/uploads/' + c.photo : '', cap: c.cap,
        tackle: showT ? { rod: c.rod, reel: c.reel, line: c.line, lure: c.lure, pub: !!c.tackle_pub } : { rod: '', reel: '', line: '', lure: '', pub: false },
        likes: likes[c.id] || [], comments: comments[c.id] || []
      };
    });

    const groups = [], rooms = {};
    if (user) {
      for (const g of q('SELECT g.* FROM groups g JOIN group_members gm ON gm.group_id=g.id WHERE gm.user_id=? ORDER BY g.created_at DESC').all(uid)) {
        groups.push({ id: g.id, name: g.name, desc: g.descr, owner: g.owner, members: q('SELECT user_id FROM group_members WHERE group_id=? ORDER BY joined_at').all(g.id).map((r) => r.user_id) });
      }
      const keys = ['all', ...D.REGIONS.map((r) => 'region-' + r.id)];
      for (const p of prow) if (members[p.id] && members[p.id].includes(uid)) keys.push('post-' + p.id);
      for (const g of groups) keys.push('group-' + g.id);
      for (const r of q("SELECT DISTINCT room FROM messages WHERE room LIKE 'dm-%' AND (room LIKE ? OR room LIKE ?)").all(`dm-${uid}-%`, `dm-%-${uid}`)) keys.push(r.room);
      for (const internal of keys) {
        let clientKey = internal;
        if (internal.startsWith('dm-')) { const [, a, b] = internal.split('-'); clientKey = 'dm-' + (a === uid ? b : a); }
        const rd = q('SELECT last_id FROM reads WHERE room=? AND user_id=?').get(internal, uid);
        rooms[clientKey] = { read: rd ? rd.last_id : 0, messages: roomMessages(internal, uid) };
      }
    }
    const feedback = user ? q('SELECT id,kind,text,status,note,created_at FROM feedback WHERE user_id=? ORDER BY created_at DESC LIMIT 20').all(uid) : [];
    const setup = { claimable: !!user && setupCode.length >= 16 && !q("SELECT 1 FROM users WHERE role='owner'").get() };
    return { me, users, friends, posts, catches, groups, rooms, feedback, setup, spotsRev };
  }

  /* ---------- routes ---------- */
  const routes = [];
  const route = (method, pattern, handler) => routes.push({ method, re: new RegExp('^' + pattern.replace(/:(\w+)/g, '(?<$1>[^/]+)') + '$'), handler });

  route('GET', '/api/state', (c) => buildState(c.user));

  route('POST', '/api/register', async (c) => {
    limit('reg:' + c.ip, 20, 3600000);
    const b = c.body;
    const nick = str(b.nick, { min: 2, max: 24, name: 'nick' });
    if (!NICK_RE.test(nick)) throw bad('invalid_nick');
    checkPassword(b.password);
    const email = str(b.email, { max: 80, name: 'email' });
    if (email && !EMAIL_RE.test(email)) throw bad('invalid_email');
    const name = str(b.name, { max: 40, name: 'name' });
    const spot = b.spot ? (spotOk(b.spot) ? b.spot : (() => { throw bad('invalid_spot'); })()) : 'nagoya';
    const style = b.style ? (STYLE_IDS.has(b.style) ? b.style : (() => { throw bad('invalid_style'); })()) : '';
    const target = b.target ? (FISH_IDS.has(b.target) ? b.target : (() => { throw bad('invalid_target'); })()) : 'any';
    const bio = str(b.bio, { max: 200, name: 'bio' });
    const lang = b.lang === 'ja' ? 'ja' : 'en';
    if (q('SELECT 1 FROM users WHERE nick=?').get(nick)) throw new HttpError(409, 'nick_taken');
    const id = rid();
    const pw = await hashPassword(b.password);
    q('INSERT INTO users(id,nick,name,email,pw,spot,style,target,bio,langs,created_at) VALUES(?,?,?,?,?,?,?,?,?,?,?)').run(id, nick, name, email, pw, spot, style, target, bio, JSON.stringify([lang]), nowISO());
    startSession(c.res, id);
    broadcast();
    return { id };
  });

  route('POST', '/api/login', async (c) => {
    const nick = str(c.body.nick, { max: 24, name: 'nick' });
    limit('login:' + c.ip, 30, 900000);
    limit('loginnick:' + nick.toLowerCase(), 10, 900000);
    const u = q('SELECT * FROM users WHERE nick=?').get(nick);
    const ok = u ? await verifyPassword(String(c.body.password || ''), u.pw) : (await verifyPassword('x', 'scrypt$AAAAAAAAAAAAAAAAAAAAAA==$' + Buffer.alloc(64).toString('base64')), false);
    if (!ok) throw new HttpError(401, 'bad_credentials');
    startSession(c.res, u.id);
    return { id: u.id };
  });

  route('POST', '/api/logout', (c) => {
    const t = cookieOf(c.req, COOKIE);
    if (t) q('DELETE FROM sessions WHERE token_hash=?').run(sha(t));
    setCookie(c.res, '', 0);
    return {};
  });

  route('PATCH', '/api/me', async (c) => {
    const user = needUser(c), b = c.body;
    const set = {};
    if ('name' in b) set.name = str(b.name, { max: 40, name: 'name' });
    if ('email' in b) { const e = str(b.email, { max: 80, name: 'email' }); if (e && !EMAIL_RE.test(e)) throw bad('invalid_email'); set.email = e; }
    if ('bio' in b) set.bio = str(b.bio, { max: 200, name: 'bio' });
    if ('spot' in b) { if (!spotOk(b.spot)) throw bad('invalid_spot'); set.spot = b.spot; }
    if ('style' in b) { if (b.style && !STYLE_IDS.has(b.style)) throw bad('invalid_style'); set.style = b.style || ''; }
    if ('target' in b) { if (!FISH_IDS.has(b.target)) throw bad('invalid_target'); set.target = b.target; }
    if ('nick' in b && b.nick !== user.nick) {
      const nick = str(b.nick, { min: 2, max: 24, name: 'nick' });
      if (!NICK_RE.test(nick)) throw bad('invalid_nick');
      const other = q('SELECT id FROM users WHERE nick=?').get(nick);
      if (other && other.id !== user.id) throw new HttpError(409, 'nick_taken');
      set.nick = nick;
    }
    if (b.password) {
      limit('pwchange:' + user.id, 10, 900000);
      if (!(await verifyPassword(String(b.currentPassword || ''), user.pw))) throw new HttpError(401, 'bad_credentials');
      checkPassword(b.password);
      set.pw = await hashPassword(b.password);
    }
    const keys = Object.keys(set);
    if (keys.length) q(`UPDATE users SET ${keys.map((k) => k + '=?').join(',')} WHERE id=?`).run(...keys.map((k) => set[k]), user.id);
    broadcast();
    return {};
  });

  route('DELETE', '/api/me', async (c) => {
    const user = needUser(c);
    limit('pwchange:' + user.id, 10, 900000);
    if (isOwner(user)) throw new HttpError(409, 'owner_cannot_delete');
    if (!(await verifyPassword(String(c.body.password || ''), user.pw))) throw new HttpError(401, 'bad_credentials');
    tx(db, () => {
      for (const g of q('SELECT * FROM groups WHERE owner=?').all(user.id)) {
        const next = q('SELECT user_id FROM group_members WHERE group_id=? AND user_id<>? ORDER BY joined_at LIMIT 1').get(g.id, user.id);
        if (next) q('UPDATE groups SET owner=? WHERE id=?').run(next.user_id, g.id);
        else { q('DELETE FROM groups WHERE id=?').run(g.id); q('DELETE FROM messages WHERE room=?').run('group-' + g.id); q('DELETE FROM reads WHERE room=?').run('group-' + g.id); }
      }
      for (const p of q('SELECT id FROM posts WHERE host=?').all(user.id)) { q('DELETE FROM messages WHERE room=?').run('post-' + p.id); q('DELETE FROM reads WHERE room=?').run('post-' + p.id); }
      for (const ct of q("SELECT photo FROM catches WHERE by_user=? AND photo<>''").all(user.id)) fs.rm(path.join(uploadDir, ct.photo), { force: true }, () => {});
      q("DELETE FROM messages WHERE room LIKE 'dm-%' AND (room LIKE ? OR room LIKE ?)").run(`dm-${user.id}-%`, `dm-%-${user.id}`);
      q('DELETE FROM users WHERE id=?').run(user.id);
    });
    setCookie(c.res, '', 0);
    broadcast();
    return {};
  });

  /* friends */
  route('POST', '/api/friends', (c) => {
    const user = needUser(c);
    limit('w:' + user.id, 120, 60000);
    const to = str(c.body.to, { min: 1, max: 40, name: 'user' });
    if (to === user.id || !q('SELECT 1 FROM users WHERE id=?').get(to)) throw new HttpError(404, 'no_user');
    const row = friendRow(user.id, to);
    const [a, b] = pair(user.id, to);
    if (!row) q('INSERT INTO friendships(user_a,user_b,requester,status,created_at) VALUES(?,?,?,?,?)').run(a, b, user.id, 'pending', nowISO());
    else if (row.status === 'pending' && row.requester !== user.id) q("UPDATE friendships SET status='accepted' WHERE user_a=? AND user_b=?").run(a, b);
    broadcast();
    return {};
  });
  route('POST', '/api/friends/:id/accept', (c) => {
    const user = needUser(c), row = friendRow(user.id, c.params.id);
    if (!row || row.status !== 'pending' || row.requester === user.id) throw new HttpError(404, 'no_request');
    q("UPDATE friendships SET status='accepted' WHERE user_a=? AND user_b=?").run(row.user_a, row.user_b);
    broadcast();
    return {};
  });
  route('DELETE', '/api/friends/:id', (c) => {
    const user = needUser(c), [a, b] = pair(user.id, c.params.id);
    q('DELETE FROM friendships WHERE user_a=? AND user_b=?').run(a, b);
    broadcast();
    return {};
  });

  /* posts */
  route('POST', '/api/posts', (c) => {
    const user = needUser(c), b = c.body;
    limit('w:' + user.id, 120, 60000);
    if (!validDate(b.date) || b.date < dayStr(-1)) throw bad('invalid_date');
    if (!validTime(b.time)) throw bad('invalid_time');
    let spot = b.spot, custom = '';
    if (spot === 'custom') { custom = str(b.custom, { min: 1, max: 40, name: 'spot' }); } else if (!spotOk(spot)) throw bad('invalid_spot');
    const meet = str(b.meet, { min: 1, max: 80, name: 'meet' });
    if (!FISH_IDS.has(b.fish)) throw bad('invalid_fish');
    if (!['car', 'ride', 'transit'].includes(b.transport)) throw bad('invalid_transport');
    const seats = b.transport === 'car' ? intIn(b.seats ?? 0, 0, 7, 'seats') : 0;
    const note = str(b.note, { max: 240, name: 'note' });
    const id = rid();
    tx(db, () => {
      q('INSERT INTO posts(id,host,date,time,spot,custom,meet,fish,transport,seats,seats_free,note,created_at) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?)').run(id, user.id, b.date, b.time, spot, custom, meet, b.fish, b.transport, seats, seats, note, nowISO());
      q('INSERT INTO post_members(post_id,user_id) VALUES(?,?)').run(id, user.id);
    });
    broadcast();
    return { id };
  });
  route('DELETE', '/api/posts/:id', (c) => {
    const user = needUser(c), p = q('SELECT * FROM posts WHERE id=?').get(c.params.id);
    if (!p) throw new HttpError(404, 'not_found');
    if (p.host !== user.id && !isAdmin(user)) throw new HttpError(403, 'forbidden');
    if (p.host !== user.id) audit(user, 'post.delete', p.id, p.spot + ' ' + p.date);
    tx(db, () => { q('DELETE FROM posts WHERE id=?').run(p.id); q('DELETE FROM messages WHERE room=?').run('post-' + p.id); q('DELETE FROM reads WHERE room=?').run('post-' + p.id); });
    broadcast();
    return {};
  });
  route('POST', '/api/posts/:id/join', (c) => {
    const user = needUser(c), b = c.body;
    limit('w:' + user.id, 120, 60000);
    const p = q('SELECT * FROM posts WHERE id=?').get(c.params.id);
    if (!p) throw new HttpError(404, 'not_found');
    if (isPostMember(p.id, user.id)) throw new HttpError(409, 'already_in');
    if (q('SELECT 1 FROM post_requests WHERE post_id=? AND user_id=?').get(p.id, user.id)) throw new HttpError(409, 'already_requested');
    const needRide = !!b.needRide;
    if (needRide && !(p.transport === 'car' && p.seats_free > 0)) throw new HttpError(409, 'no_seats');
    q('INSERT INTO post_requests(post_id,user_id,need_ride,can_drive,msg,created_at) VALUES(?,?,?,?,?,?)').run(p.id, user.id, needRide ? 1 : 0, b.canDrive && p.transport === 'ride' ? 1 : 0, str(b.msg, { max: 200, name: 'msg' }), nowISO());
    broadcast();
    return {};
  });
  route('DELETE', '/api/posts/:id/join', (c) => {
    const user = needUser(c);
    q('DELETE FROM post_requests WHERE post_id=? AND user_id=?').run(c.params.id, user.id);
    broadcast();
    return {};
  });
  route('POST', '/api/posts/:id/accept', (c) => {
    const user = needUser(c), p = q('SELECT * FROM posts WHERE id=?').get(c.params.id);
    if (!p) throw new HttpError(404, 'not_found');
    if (p.host !== user.id) throw new HttpError(403, 'forbidden');
    const uid = str(c.body.uid, { min: 1, max: 40, name: 'user' });
    tx(db, () => {
      const r = q('SELECT * FROM post_requests WHERE post_id=? AND user_id=?').get(p.id, uid);
      if (!r) throw new HttpError(404, 'no_request');
      if (r.need_ride) {
        const res = q('UPDATE posts SET seats_free=seats_free-1 WHERE id=? AND seats_free>0').run(p.id);
        if (!res.changes) throw new HttpError(409, 'no_seats');
      }
      q('INSERT OR IGNORE INTO post_members(post_id,user_id) VALUES(?,?)').run(p.id, uid);
      q('DELETE FROM post_requests WHERE post_id=? AND user_id=?').run(p.id, uid);
      addMessage('post-' + p.id, uid, '', 'joined');
    });
    broadcast();
    return {};
  });
  route('POST', '/api/posts/:id/decline', (c) => {
    const user = needUser(c), p = q('SELECT * FROM posts WHERE id=?').get(c.params.id);
    if (!p) throw new HttpError(404, 'not_found');
    if (p.host !== user.id) throw new HttpError(403, 'forbidden');
    q('DELETE FROM post_requests WHERE post_id=? AND user_id=?').run(p.id, str(c.body.uid, { min: 1, max: 40, name: 'user' }));
    broadcast();
    return {};
  });

  /* catches */
  function savePhoto(dataUrl) {
    const m = /^data:image\/jpeg;base64,([A-Za-z0-9+/=]+)$/.exec(dataUrl || '');
    if (!m) throw bad('invalid_photo');
    const buf = Buffer.from(m[1], 'base64');
    if (buf.length > 1_800_000 || buf.length < 200 || buf[0] !== 0xff || buf[1] !== 0xd8 || buf[2] !== 0xff) throw bad('invalid_photo');
    const name = crypto.randomBytes(12).toString('hex') + '.jpg';
    fs.writeFileSync(path.join(uploadDir, name), buf);
    return name;
  }
  route('POST', '/api/catches', (c) => {
    const user = needUser(c), b = c.body;
    limit('w:' + user.id, 120, 60000);
    if (!FISH_IDS.has(b.fish) || b.fish === 'any') throw bad('invalid_fish');
    if (!validDate(b.date) || b.date > dayStr(1)) throw bad('invalid_date');
    const loc = b.loc || {};
    let lv;
    if (loc.k === 'spot' && spotOk(loc.v)) lv = loc.v;
    else if (loc.k === 'area' && PREF_IDS.has(loc.v)) lv = loc.v;
    else if (loc.k === 'custom') lv = str(loc.v, { min: 1, max: 40, name: 'loc' });
    else throw bad('invalid_loc');
    const size = b.size ? intIn(b.size, 1, 300, 'size') : 0;
    const t = b.tackle || {};
    const photo = b.photo ? savePhoto(b.photo) : '';
    const id = rid();
    q('INSERT INTO catches(id,by_user,when_date,loc_k,loc_v,fish,size,photo,cap,rod,reel,line,lure,tackle_pub,created_at) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)')
      .run(id, user.id, b.date, loc.k, lv, b.fish, size, photo, str(b.cap, { max: 240, name: 'cap' }), str(t.rod, { max: 60, name: 'rod' }), str(t.reel, { max: 60, name: 'reel' }), str(t.line, { max: 60, name: 'line' }), str(t.lure, { max: 60, name: 'lure' }), t.pub ? 1 : 0, nowISO());
    broadcast();
    return { id };
  });
  route('DELETE', '/api/catches/:id', (c) => {
    const user = needUser(c), r = q('SELECT * FROM catches WHERE id=?').get(c.params.id);
    if (!r) throw new HttpError(404, 'not_found');
    if (r.by_user !== user.id && !isAdmin(user)) throw new HttpError(403, 'forbidden');
    if (r.by_user !== user.id) audit(user, 'catch.delete', r.id, r.fish);
    q('DELETE FROM catches WHERE id=?').run(r.id);
    if (r.photo) fs.rm(path.join(uploadDir, r.photo), { force: true }, () => {});
    broadcast();
    return {};
  });
  route('POST', '/api/catches/:id/like', (c) => {
    const user = needUser(c);
    limit('w:' + user.id, 120, 60000);
    if (!q('SELECT 1 FROM catches WHERE id=?').get(c.params.id)) throw new HttpError(404, 'not_found');
    const had = q('SELECT 1 FROM catch_likes WHERE catch_id=? AND user_id=?').get(c.params.id, user.id);
    if (had) q('DELETE FROM catch_likes WHERE catch_id=? AND user_id=?').run(c.params.id, user.id);
    else q('INSERT INTO catch_likes(catch_id,user_id) VALUES(?,?)').run(c.params.id, user.id);
    broadcast();
    return { liked: !had };
  });
  route('POST', '/api/catches/:id/comments', (c) => {
    const user = needUser(c);
    limit('w:' + user.id, 120, 60000);
    if (!q('SELECT 1 FROM catches WHERE id=?').get(c.params.id)) throw new HttpError(404, 'not_found');
    const text = str(c.body.text, { min: 1, max: 200, name: 'text' });
    q('INSERT INTO catch_comments(id,catch_id,user_id,text,created_at) VALUES(?,?,?,?,?)').run(rid(), c.params.id, user.id, text, nowISO());
    broadcast();
    return {};
  });
  route('DELETE', '/api/comments/:id', (c) => {
    const user = needUser(c), r = q('SELECT * FROM catch_comments WHERE id=?').get(c.params.id);
    if (!r) throw new HttpError(404, 'not_found');
    const owner = q('SELECT by_user FROM catches WHERE id=?').get(r.catch_id);
    if (r.user_id !== user.id && (!owner || owner.by_user !== user.id) && !isAdmin(user)) throw new HttpError(403, 'forbidden');
    if (r.user_id !== user.id && !(owner && owner.by_user === user.id)) audit(user, 'comment.delete', r.id, r.text.slice(0, 80));
    q('DELETE FROM catch_comments WHERE id=?').run(r.id);
    broadcast();
    return {};
  });

  /* groups (private) */
  route('POST', '/api/groups', (c) => {
    const user = needUser(c), b = c.body;
    limit('w:' + user.id, 120, 60000);
    const name = str(b.name, { min: 1, max: 40, name: 'name' }), descr = str(b.desc, { max: 160, name: 'desc' });
    const want = Array.isArray(b.members) ? [...new Set(b.members.filter((x) => typeof x === 'string'))].slice(0, 50) : [];
    const id = rid();
    tx(db, () => {
      q('INSERT INTO groups(id,name,descr,owner,created_at) VALUES(?,?,?,?,?)').run(id, name, descr, user.id, nowISO());
      q('INSERT INTO group_members(group_id,user_id,joined_at) VALUES(?,?,?)').run(id, user.id, nowISO());
      for (const m of want) if (m !== user.id && q('SELECT 1 FROM users WHERE id=?').get(m)) q('INSERT OR IGNORE INTO group_members(group_id,user_id,joined_at) VALUES(?,?,?)').run(id, m, nowISO());
    });
    broadcast();
    return { id };
  });
  function ownGroup(c) {
    const user = needUser(c), g = q('SELECT * FROM groups WHERE id=?').get(c.params.id);
    if (!g || !isGroupMember(g.id, user.id)) throw new HttpError(404, 'not_found');
    return { user, g };
  }
  route('POST', '/api/groups/:id/members', (c) => {
    const { user, g } = ownGroup(c);
    if (g.owner !== user.id) throw new HttpError(403, 'forbidden');
    const uid = str(c.body.uid, { min: 1, max: 40, name: 'user' });
    if (!q('SELECT 1 FROM users WHERE id=?').get(uid)) throw new HttpError(404, 'no_user');
    if (!isGroupMember(g.id, uid)) { q('INSERT INTO group_members(group_id,user_id,joined_at) VALUES(?,?,?)').run(g.id, uid, nowISO()); addMessage('group-' + g.id, uid, '', 'added'); }
    broadcast();
    return {};
  });
  route('DELETE', '/api/groups/:id/members/:uid', (c) => {
    const { user, g } = ownGroup(c);
    const uid = c.params.uid;
    if (uid === user.id) {
      tx(db, () => {
        q('DELETE FROM group_members WHERE group_id=? AND user_id=?').run(g.id, uid);
        const next = q('SELECT user_id FROM group_members WHERE group_id=? ORDER BY joined_at LIMIT 1').get(g.id);
        if (!next) { q('DELETE FROM groups WHERE id=?').run(g.id); q('DELETE FROM messages WHERE room=?').run('group-' + g.id); q('DELETE FROM reads WHERE room=?').run('group-' + g.id); }
        else { if (g.owner === uid) q('UPDATE groups SET owner=? WHERE id=?').run(next.user_id, g.id); addMessage('group-' + g.id, uid, '', 'left'); }
      });
    } else {
      if (g.owner !== user.id) throw new HttpError(403, 'forbidden');
      if (isGroupMember(g.id, uid)) { q('DELETE FROM group_members WHERE group_id=? AND user_id=?').run(g.id, uid); addMessage('group-' + g.id, uid, '', 'left'); }
    }
    broadcast();
    return {};
  });

  /* chat */
  route('POST', '/api/rooms/:room/messages', (c) => {
    const user = needUser(c);
    limit('msg:' + user.id, 30, 10000);
    const room = resolveRoom(user, decodeURIComponent(c.params.room));
    const text = str(c.body.text, { min: 1, max: 1000, name: 'text' });
    const id = addMessage(room.internal, user.id, text, '');
    broadcast();
    return { id };
  });
  route('POST', '/api/rooms/:room/read', (c) => {
    const user = needUser(c);
    const room = resolveRoom(user, decodeURIComponent(c.params.room));
    const last = q('SELECT MAX(id) AS m FROM messages WHERE room=?').get(room.internal).m || 0;
    const upTo = Math.min(intIn(c.body.lastId ?? 0, 0, 2 ** 31, 'id'), last);
    const cur = q('SELECT last_id FROM reads WHERE room=? AND user_id=?').get(room.internal, user.id);
    if (!cur || cur.last_id < upTo) { q('INSERT INTO reads(room,user_id,last_id) VALUES(?,?,?) ON CONFLICT(room,user_id) DO UPDATE SET last_id=excluded.last_id').run(room.internal, user.id, upTo); broadcast(); }
    return {};
  });

  /* ---------- feedback (any signed-in user) ---------- */
  route('POST', '/api/feedback', (c) => {
    const user = needUser(c), b = c.body;
    limit('fb:' + user.id, 5, 3600000);
    const kind = ['bug', 'idea', 'other'].includes(b.kind) ? b.kind : null;
    if (!kind) throw bad('invalid_kind');
    const text = str(b.text, { min: 5, max: 2000, name: 'text' });
    const page = str(b.page, { max: 40, name: 'page' });
    const id = rid(), now = nowISO();
    q('INSERT INTO feedback(id,user_id,kind,text,page,lang,status,note,created_at,updated_at) VALUES(?,?,?,?,?,?,?,?,?,?)').run(id, user.id, kind, text, page, b.lang === 'ja' ? 'ja' : 'en', 'new', '', now, now);
    broadcast();
    return { id };
  });

  /* ---------- admin ---------- */
  const needAdmin = (c) => { const u = needUser(c); if (!isAdmin(u)) throw new HttpError(403, 'forbidden'); return u; };
  const needOwner = (c) => { const u = needUser(c); if (!isOwner(u)) throw new HttpError(403, 'forbidden'); return u; };
  const slug = (t) => String(t).toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 40);

  /* One-time owner claim with the secret ADMIN_SETUP_CODE from the server's environment. Works only while there is no owner. */
  route('POST', '/api/admin/claim', (c) => {
    const user = needUser(c);
    limit('claim:' + c.ip, 5, 3600000);
    limit('claim:' + user.id, 5, 3600000);
    if (setupCode.length < 16) throw new HttpError(404, 'not_found');
    if (q("SELECT 1 FROM users WHERE role='owner'").get()) throw new HttpError(409, 'owner_exists');
    const a = crypto.createHash('sha256').update(String(c.body.code || '')).digest();
    const b = crypto.createHash('sha256').update(setupCode).digest();
    if (!crypto.timingSafeEqual(a, b)) throw new HttpError(403, 'bad_code');
    q("UPDATE users SET role='owner' WHERE id=?").run(user.id);
    audit(user, 'owner.claim', user.id, user.nick);
    broadcast();
    return {};
  });

  route('GET', '/api/admin/overview', (c) => {
    needAdmin(c);
    const count = (sql) => q(sql).get().n;
    const used = {};
    for (const r of q('SELECT spot AS s, COUNT(*) AS n FROM users GROUP BY spot').all()) used[r.s] = (used[r.s] || 0) + r.n;
    for (const r of q("SELECT spot AS s, COUNT(*) AS n FROM posts WHERE spot<>'custom' GROUP BY spot").all()) used[r.s] = (used[r.s] || 0) + r.n;
    const spots = q('SELECT * FROM spots ORDER BY pref, en').all().map((s) => ({ id: s.id, en: s.en, ja: s.ja, type: s.type, pref: s.pref, builtin: !!s.builtin, active: !!s.active, used: used[s.id] || 0 }));
    const feedback = q('SELECT f.*, u.nick FROM feedback f LEFT JOIN users u ON u.id=f.user_id ORDER BY f.created_at DESC LIMIT 300').all()
      .map((f) => ({ id: f.id, kind: f.kind, text: f.text, page: f.page, lang: f.lang, status: f.status, note: f.note, created_at: f.created_at, updated_at: f.updated_at, uid: f.user_id || '', nick: f.nick || '' }));
    return {
      counts: {
        users: count('SELECT COUNT(*) AS n FROM users'), posts: q('SELECT COUNT(*) AS n FROM posts WHERE date>=?').get(dayStr(0)).n,
        catches: count('SELECT COUNT(*) AS n FROM catches'), groups: count('SELECT COUNT(*) AS n FROM groups'), messages: count('SELECT COUNT(*) AS n FROM messages'),
        spots: count('SELECT COUNT(*) AS n FROM spots WHERE active=1'), feedbackNew: count("SELECT COUNT(*) AS n FROM feedback WHERE status='new'"),
        newUsers7d: q('SELECT COUNT(*) AS n FROM users WHERE created_at>=?').get(new Date(Date.now() - 7 * 86400000).toISOString()).n
      },
      spots, feedback,
      admins: q("SELECT id,nick,role,created_at FROM users WHERE role IN ('admin','owner') ORDER BY role DESC, created_at").all(),
      audit: q('SELECT id,actor_nick,action,target,detail,created_at FROM audit_log ORDER BY id DESC LIMIT 60').all()
    };
  });

  route('POST', '/api/admin/spots', (c) => {
    const user = needAdmin(c), b = c.body;
    limit('w:' + user.id, 120, 60000);
    const en = str(b.en, { min: 2, max: 60, name: 'en' }), ja = str(b.ja, { min: 1, max: 60, name: 'ja' });
    if (!['s', 'b', 'f'].includes(b.type)) throw bad('invalid_type');
    if (!PREF_IDS.has(b.pref)) throw bad('invalid_pref');
    const id = b.id ? str(b.id, { min: 2, max: 40, name: 'id' }) : slug(en);
    if (!/^[a-z0-9][a-z0-9-]{1,39}$/.test(id) || id === 'custom') throw bad('invalid_id');
    if (q('SELECT 1 FROM spots WHERE id=?').get(id)) throw new HttpError(409, 'id_taken');
    /* Tide numbers for a new spot start from a neighbour in the same prefecture. They are sample values, as for built-in spots. */
    const nb = q('SELECT mean,a,p,p2,p3 FROM spots WHERE pref=? AND type<>? ORDER BY builtin DESC, id LIMIT 1').get(b.pref, 'f') || q('SELECT mean,a,p,p2,p3 FROM spots LIMIT 1').get();
    const off = (D.hash(id) % 100) / 250;
    q('INSERT INTO spots(id,en,ja,type,pref,mean,a,p,p2,p3,builtin,active,created_at) VALUES(?,?,?,?,?,?,?,?,?,?,0,1,?)').run(id, en, ja, b.type, b.pref, nb.mean, nb.a, nb.p + off, nb.p2 + off, nb.p3 + off, nowISO());
    audit(user, 'spot.add', id, en + ' / ' + ja);
    spotsRev = Date.now();
    broadcast();
    return { id };
  });
  route('PATCH', '/api/admin/spots/:id', (c) => {
    const user = needAdmin(c), b = c.body;
    limit('w:' + user.id, 120, 60000);
    const s = q('SELECT * FROM spots WHERE id=?').get(c.params.id);
    if (!s) throw new HttpError(404, 'not_found');
    const set = {};
    if ('en' in b) set.en = str(b.en, { min: 2, max: 60, name: 'en' });
    if ('ja' in b) set.ja = str(b.ja, { min: 1, max: 60, name: 'ja' });
    if ('type' in b) { if (!['s', 'b', 'f'].includes(b.type)) throw bad('invalid_type'); set.type = b.type; }
    if ('pref' in b) { if (!PREF_IDS.has(b.pref)) throw bad('invalid_pref'); set.pref = b.pref; }
    if ('active' in b) set.active = b.active ? 1 : 0;
    const keys = Object.keys(set);
    if (keys.length) {
      q(`UPDATE spots SET ${keys.map((k) => k + '=?').join(',')} WHERE id=?`).run(...keys.map((k) => set[k]), s.id);
      audit(user, 'spot.edit', s.id, keys.map((k) => k + '=' + set[k]).join(', '));
      spotsRev = Date.now();
      broadcast();
    }
    return {};
  });

  route('PATCH', '/api/admin/feedback/:id', (c) => {
    const user = needAdmin(c), b = c.body;
    const f = q('SELECT * FROM feedback WHERE id=?').get(c.params.id);
    if (!f) throw new HttpError(404, 'not_found');
    const status = 'status' in b ? (['new', 'in_progress', 'done', 'wontfix'].includes(b.status) ? b.status : (() => { throw bad('invalid_status'); })()) : f.status;
    const note = 'note' in b ? str(b.note, { max: 1000, name: 'note' }) : f.note;
    q('UPDATE feedback SET status=?, note=?, updated_at=? WHERE id=?').run(status, note, nowISO(), f.id);
    audit(user, 'feedback.update', f.id, status + (note !== f.note ? ' (reply)' : ''));
    broadcast();
    return {};
  });
  route('DELETE', '/api/admin/feedback/:id', (c) => {
    const user = needAdmin(c);
    const f = q('SELECT id FROM feedback WHERE id=?').get(c.params.id);
    if (!f) throw new HttpError(404, 'not_found');
    q('DELETE FROM feedback WHERE id=?').run(f.id);
    audit(user, 'feedback.delete', f.id, '');
    broadcast();
    return {};
  });

  /* The whitelist: only accounts whose role is admin or owner can use /api/admin. Only an owner can change it. */
  route('POST', '/api/admin/admins', (c) => {
    const user = needOwner(c);
    limit('w:' + user.id, 120, 60000);
    const nick = str(c.body.nick, { min: 2, max: 24, name: 'nick' });
    const t = q('SELECT * FROM users WHERE nick=?').get(nick);
    if (!t) throw new HttpError(404, 'no_user');
    if (t.role === 'user') { q("UPDATE users SET role='admin' WHERE id=?").run(t.id); audit(user, 'admin.add', t.id, t.nick); }
    broadcast();
    return {};
  });
  route('DELETE', '/api/admin/admins/:id', (c) => {
    const user = needOwner(c);
    const t = q('SELECT * FROM users WHERE id=?').get(c.params.id);
    if (!t) throw new HttpError(404, 'no_user');
    if (t.role === 'owner') throw new HttpError(409, 'cannot_remove_owner');
    if (t.role === 'admin') { q("UPDATE users SET role='user' WHERE id=?").run(t.id); audit(user, 'admin.remove', t.id, t.nick); }
    broadcast();
    return {};
  });

  route('GET', '/api/spots', () => ({ rev: spotsRev, spots: q('SELECT id,en,ja,type,pref,mean,a,p,p2,p3,active FROM spots ORDER BY pref, en').all().map((s) => ({ ...s, active: !!s.active })) }));

  route('GET', '/api/events', (c) => {
    c.res.writeHead(200, { 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-cache', Connection: 'keep-alive', 'X-Accel-Buffering': 'no' });
    c.res.write('retry: 3000\n\n');
    clients.add(c.res);
    c.req.on('close', () => clients.delete(c.res));
    return Symbol.for('handled');
  });
  route('GET', '/api/health', () => ({ ok: true }));

  /* ---------- http plumbing ---------- */
  const SECURITY = {
    ...(cookieSecure ? { 'Strict-Transport-Security': 'max-age=15552000' } : {}),
    'X-Content-Type-Options': 'nosniff', 'Referrer-Policy': 'same-origin', 'X-Frame-Options': 'DENY',
    'Content-Security-Policy': "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline' https://fonts.googleapis.com; font-src https://fonts.gstatic.com; img-src 'self' data:; connect-src 'self'; frame-ancestors 'none'; base-uri 'none'; form-action 'self'"
  };
  function send(res, status, obj, extra) {
    const body = JSON.stringify(obj);
    res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store', ...SECURITY, ...extra });
    res.end(body);
  }
  function readBody(req, max = 3_000_000) {
    return new Promise((resolve, reject) => {
      let size = 0, over = false;
      const chunks = [];
      req.on('data', (ch) => { size += ch.length; if (size > max) over = true; else chunks.push(ch); });
      req.on('end', () => {
        if (over) return reject(new HttpError(413, 'too_large'));
        if (!chunks.length) return resolve({});
        try { const v = JSON.parse(Buffer.concat(chunks).toString('utf8')); resolve(v && typeof v === 'object' && !Array.isArray(v) ? v : {}); } catch (_) { reject(bad('bad_json')); }
      });
      req.on('error', reject);
    });
  }
  function serveFile(req, res, file, cache) {
    fs.stat(file, (err, st) => {
      if (err || !st.isFile()) { res.writeHead(404, { 'Content-Type': 'text/plain', ...SECURITY }); return res.end('Not found'); }
      res.writeHead(200, { 'Content-Type': MIME[path.extname(file)] || 'application/octet-stream', 'Content-Length': st.size, 'Cache-Control': cache, ...SECURITY });
      if (req.method === 'HEAD') return res.end();
      fs.createReadStream(file).pipe(res);
    });
  }

  const server = http.createServer(async (req, res) => {
    try {
      const url = new URL(req.url, 'http://x');
      const p = decodeURIComponent(url.pathname);
      if (p.startsWith('/api/')) {
        const user = userFromReq(req);
        if (req.method !== 'GET' && req.method !== 'HEAD') {
          const origin = req.headers.origin;
          if (origin) { let host = ''; try { host = new URL(origin).host; } catch (_) {} if (host !== req.headers.host) throw new HttpError(403, 'bad_origin'); }
          if (!String(req.headers['content-type'] || '').startsWith('application/json')) throw new HttpError(415, 'json_required');
        }
        let hit = null, params = null;
        for (const r of routes) { if (r.method !== req.method) continue; const m = r.re.exec(p); if (m) { hit = r; params = m.groups || {}; break; } }
        if (!hit) throw new HttpError(404, 'not_found');
        const body = req.method === 'GET' || req.method === 'HEAD' ? {} : await readBody(req);
        const out = await hit.handler({ req, res, user, params, body, ip: clientIp(req), url });
        if (out === Symbol.for('handled')) return;
        return send(res, 200, out === undefined ? {} : out);
      }
      if (req.method !== 'GET' && req.method !== 'HEAD') throw new HttpError(405, 'method_not_allowed');
      if (p.startsWith('/uploads/')) {
        const name = p.slice(9);
        if (!/^[0-9a-f]{24}\.jpg$/.test(name)) { res.writeHead(404, SECURITY); return res.end(); }
        return serveFile(req, res, path.join(uploadDir, name), 'public, max-age=31536000, immutable');
      }
      const rel = p === '/' ? 'index.html' : p.replace(/^\/+/, '');
      const file = path.join(publicDir, rel);
      if (!file.startsWith(publicDir + path.sep)) { res.writeHead(404, SECURITY); return res.end(); }
      return serveFile(req, res, file, /\.(png|jpg|ico)$/.test(rel) ? 'public, max-age=86400' : 'no-cache');
    } catch (e) {
      if (e instanceof HttpError) return send(res, e.status, { error: e.code, message: e.message });
      console.error(e);
      return send(res, 500, { error: 'server_error' });
    }
  });

  return {
    server, db, dataDir,
    close() { clearInterval(sweep); clearInterval(beat); for (const r of clients) r.end(); clients.clear(); return new Promise((ok) => { server.close(() => { db.close(); ok(); }); server.closeAllConnections?.(); }); }
  };
}

module.exports = { createApp };

if (require.main === module) {
  const port = Number(process.env.PORT) || 3000;
  const app = createApp();
  app.server.listen(port, process.env.HOST || '0.0.0.0', () => console.log(`Castomo is running on http://localhost:${port}  (data: ${app.dataDir})`));
  const stop = () => app.close().then(() => process.exit(0));
  process.on('SIGINT', stop);
  process.on('SIGTERM', stop);
}
