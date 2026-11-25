/* Castomo browser app. Part 1: state, helpers, data loading, feed ranking, header, tide, board and catches views. */
(function () {
'use strict';
const D = window.CAST, TD = window.TIDE, I = window.I18N, CW = 44;
const $ = (s, r) => (r || document).querySelector(s);
const $$ = (s, r) => Array.from((r || document).querySelectorAll(s));
const LS = {
  get(k, d) { try { const v = localStorage.getItem('castomo-' + k); return v == null ? d : JSON.parse(v); } catch (_) { return d; } },
  set(k, v) { try { localStorage.setItem('castomo-' + k, JSON.stringify(v)); } catch (_) { /* storage can be blocked */ } }
};
const esc = (s) => String(s == null ? '' : s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const pad = (n) => String(n).padStart(2, '0');
const fmt = (m) => { m = Math.round(m); return pad(Math.floor(m / 60) % 24) + ':' + pad(m % 60); };
const ymd = (d) => d.getFullYear() + '-' + pad(d.getMonth() + 1) + '-' + pad(d.getDate());
const parseD = (s) => { const p = String(s).split('-').map(Number); return new Date(p[0], p[1] - 1, p[2]); };
const todayStr = () => ymd(new Date());

const S = {
  lang: LS.get('lang', (navigator.language || '').slice(0, 2) === 'ja' ? 'ja' : 'en'),
  theme: LS.get('theme', 'auto'),
  tab: LS.get('tab', 'tide'),
  homeSpot: LS.get('spot', 'nagoya'),
  day: 0, water: 'all',
  filter: 'all', scope: 'all', sort: 'foryou', sf: 'all',
  cScope: 'all', cSort: 'foryou',
  room: 'all', q: '', fs: 'all', ft: 'all', aScope: 'all',
  group: null, openC: {},
  sheet: null, dirty: false,
  data: null, spots: [], spotsRev: 0, sig: '', fc: {}, mapSel: null, repFilter: 'open', mapQ: '', mapWater: 'all', pinMode: false,
  loaded: false, loadError: false, rendered: false,
  admin: null, adminTab: 'overview', fbFilter: 'all', spotQ: '', spotPref: 'all',
  photo: null, readSent: {}, focusId: null
};
const ORIG_THEME = document.documentElement.getAttribute('data-theme');

/* ---------- strings ---------- */
function T(k) {
  let v = I[S.lang][k];
  if (v === undefined) v = I.en[k];
  return v === undefined ? k : v;
}
function errText(e) { const v = e && I[S.lang]['err_' + e.code]; return v || T('err_generic'); }

/* ---------- indexes over the loaded data ---------- */
let U = {}, SM = {};
function index() {
  U = {}; (S.data.users || []).forEach((u) => { U[u.id] = u; });
  SM = {}; S.spots.forEach((s) => { SM[s.id] = s; });
}
const me = () => (S.data && S.data.me) || null;
const myId = () => (me() ? me().id : '');
const isAdmin = () => !!(me() && me().admin);
const userOf = (id) => U[id] || { id: '', nick: T('deletedUser'), name: '', spot: '', style: '', target: 'any', bio: '', langs: [], fish: [], trips: 0 };
const spotOf = (id) => SM[id] || SM.nagoya || S.spots[0] || { id, en: id, ja: id, type: 's', pref: 'aichi', mean: 100, a: 45, p: 2, p2: 3, p3: 1, active: true };
const sName = (id) => spotOf(id)[S.lang];
const prefObj = (id) => D.PREFS.find((p) => p.id === id);
const prefName = (id) => { const p = prefObj(id); return p ? p[S.lang] : ''; };
const regionName = (id) => { const r = D.REGIONS.find((x) => x.id === id); return r ? r[S.lang] : ''; };
const fName = (k) => (D.FISH[k] || D.FISH.any)[S.lang];
const stName = (k) => (D.STYLES[k] ? D.STYLES[k][S.lang] : T('notSet'));
const spotTag = (s) => (s.type === 'f' ? ' · ' + T('tagFresh') : s.type === 'b' ? ' · ' + T('tagBrackish') : '');
const homeSpotId = () => { const id = me() ? me().spot : S.homeSpot; return SM[id] ? id : 'nagoya'; };
const myPref = () => spotOf(homeSpotId()).pref;
const userPref = (u) => (u && u.spot ? spotOf(u.spot).pref : '');
const friends = () => (S.data && S.data.friends) || { accepted: [], incoming: [], outgoing: [] };
const isFriend = (id) => friends().accepted.indexOf(id) > -1;
const avHue = (u) => D.hash(u.nick || u.id || '?') % 360;
const av = (u, cls) => (u.avatar ? `<span class="av ${cls || ''}"><img src="${esc(u.avatar)}" alt="" loading="lazy"></span>` : `<span class="av ${cls || ''}" style="--h:${avHue(u)}">${esc(String(u.nick || '?').trim().charAt(0).toUpperCase())}</span>`);
const profLink = (u) => (u.id ? `<button class="linkbtn" data-act="profile" data-u="${esc(u.id)}">${esc(u.nick)}</button>` : `<span class="muted">${esc(u.nick)}</span>`);
function dateStr(d, long) {
  const o = long ? { weekday: 'short', month: 'short', day: 'numeric' } : { weekday: 'short', month: 'numeric', day: 'numeric' };
  try { return new Intl.DateTimeFormat(S.lang === 'ja' ? 'ja-JP' : 'en-GB', o).format(d); } catch (_) { return d.toDateString(); }
}
function timeStr(iso) {
  const d = new Date(iso); if (isNaN(d)) return '';
  const hm = pad(d.getHours()) + ':' + pad(d.getMinutes());
  return ymd(d) === todayStr() ? hm : (d.getMonth() + 1) + '/' + d.getDate() + ' ' + hm;
}
const postSpot = (p) => (p.spot === 'custom' ? p.custom : sName(p.spot));
const locName = (l) => (l.k === 'custom' ? l.v : l.k === 'area' ? prefName(l.v) + T('areaOnly') : sName(l.v));

/* ---------- API ---------- */
function api(method, path, body) {
  const o = { method, headers: {}, credentials: 'same-origin' };
  if (method !== 'GET') { o.headers['Content-Type'] = 'application/json'; o.body = JSON.stringify(body || {}); }
  return fetch(path, o).then((r) => r.json().catch(() => ({})).then((j) => {
    if (!r.ok) { const e = new Error(j.error || 'error'); e.code = j.error || 'error'; e.status = r.status; throw e; }
    return j;
  }));
}
let toastTimer = null;
function toast(msg, kind) {
  let el = $('#toast');
  if (!el) { el = document.createElement('div'); el.id = 'toast'; el.setAttribute('role', 'status'); document.body.appendChild(el); }
  el.textContent = msg; el.className = 'show ' + (kind || '');
  clearTimeout(toastTimer); toastTimer = setTimeout(() => { el.className = ''; }, 4200);
}
function fail(e) {
  if (e && e.code === 'login_required') return openAuth('login', T('needLogin'));
  toast(errText(e), 'bad');
}
/* run an API call, refresh the data, and re-render. Resolves true on success. */
function act(p, okMsg) {
  return p.then((r) => load().then(() => { if (okMsg) toast(okMsg); return r || true; })).catch((e) => { fail(e); return false; });
}
function needLogin() { if (me()) return true; openAuth('login', T('needLogin')); return false; }

/* ---------- loading and live updates ---------- */
let loading = false, again = false, againPush = false;
function load(push) {
  if (loading) { again = true; againPush = againPush || !!push; return Promise.resolve(); }
  loading = true;
  return api('GET', '/api/state').then((d) => {
    const needSpots = d.spotsRev !== S.spotsRev || !S.spots.length;
    return (needSpots ? api('GET', '/api/spots').then((r) => { S.spots = r.spots; S.spotsRev = d.spotsRev; }) : Promise.resolve()).then(() => {
      const sig = JSON.stringify(d) + '|' + S.spotsRev;
      const changed = sig !== S.sig;
      S.sig = sig; S.data = d; index(); S.loadError = false;
      if (!S.loaded) { S.loaded = true; if (S.tab === 'admin' && !isAdmin()) S.tab = 'tide'; }
      if (changed || !S.rendered) { if (push && S.sheet) S.dirty = true; else render(); }
      markRead();
    });
  }).catch(() => { if (!S.loaded) { S.loadError = true; render(); } })
    .then(() => { loading = false; if (again) { const p = againPush; again = false; againPush = false; load(p); } });
}
function loadAdmin(push) {
  if (!isAdmin()) return Promise.resolve();
  return api('GET', '/api/admin/overview').then((a) => {
    const sig = JSON.stringify(a), changed = !S.admin || S.admin.sig !== sig;
    a.sig = sig; S.admin = a;
    if (changed && S.tab === 'admin') { if (push && S.sheet) S.dirty = true; else render(); }
  }).catch((e) => { if (e.status === 403) { S.admin = null; } });
}
let pushTimer = null;
function schedule() { clearTimeout(pushTimer); pushTimer = setTimeout(() => { load(true); if (S.tab === 'admin') loadAdmin(true); }, 150); }
function connectEvents() {
  if (!window.EventSource) return;
  const es = new EventSource('/api/events');
  es.addEventListener('changed', schedule);
  es.onopen = () => { if (S.loaded) schedule(); };
}

/* mark the open conversation as read so the sender sees "Seen" */
function openRoomKey() {
  if (S.tab === 'chat') return S.room;
  if (S.tab === 'groups' && S.group) return 'group-' + S.group;
  return '';
}
function markRead() {
  const key = openRoomKey();
  if (!key || document.hidden || !me() || !S.data.rooms[key]) return;
  const r = S.data.rooms[key];
  let last = 0;
  r.messages.forEach((m) => { if (m.u !== myId() && m.id > last) last = m.id; });
  if (last > r.read && (S.readSent[key] || 0) < last) {
    S.readSent[key] = last;
    api('POST', '/api/rooms/' + encodeURIComponent(key) + '/read', { lastId: last }).catch(() => { S.readSent[key] = 0; });
  }
}
function unreadIn(key) {
  const r = S.data && S.data.rooms[key]; if (!r) return 0;
  return r.messages.filter((m) => !m.sys && m.u !== myId() && m.id > r.read).length;
}
function unreadTotal() { return S.data ? Object.keys(S.data.rooms).reduce((n, k) => n + unreadIn(k), 0) : 0; }

/* ---------- feed ranking: friends and your own prefecture come first ---------- */
function postPref(p) { if (p.spot !== 'custom') return spotOf(p.spot).pref; const h = userOf(p.host); return h.id ? userPref(h) : ''; }
function catchPref(c) { if (c.loc.k === 'spot') return spotOf(c.loc.v).pref; if (c.loc.k === 'area') return c.loc.v; const a = userOf(c.by); return a.id ? userPref(a) : ''; }
function feedInfo(by, pref) {
  const mine = by === myId();
  const fr = mine || isFriend(by), same = !!pref && pref === myPref();
  return { friend: fr && !mine, mine, same, tier: (fr ? 2 : 0) + (same ? 1 : 0) };
}
function scopeOk(info, scope) { return scope === 'all' || (scope === 'friends' && (info.friend || info.mine)) || (scope === 'pref' && info.same); }
function feedBadges(info) {
  return (info.friend ? `<span class="pill good">${esc(T('badgeFriend'))}</span>` : '') + (info.same ? `<span class="pill car">${esc(T('badgePref'))}</span>` : '');
}
function scopeChips(scopeKey, cur) {
  const list = [['all', 'scopeAll'], ['friends', 'scopeFriends'], ['pref', 'scopePref']];
  return `<div class="chips" role="group" aria-label="${esc(T('scopeLbl'))}">${list.map((x) => `<button class="chip" data-act="${scopeKey}" data-v="${x[0]}" aria-pressed="${cur === x[0]}">${esc(x[0] === 'pref' ? T('scopePrefN')(prefName(myPref())) : T(x[1]))}</button>`).join('')}</div>`;
}

/* ---------- option builders ---------- */
const customSpots = () => LS.get('custom', []);
const waterOk = (s, w, sel) => !w || w === 'all' || s.id === sel || (w === 'fresh' ? s.type === 'f' : s.type !== 'f');
function spotOpts(sel, o) {
  o = o || {};
  let h = '';
  D.PREFS.forEach((pf) => {
    const items = S.spots.filter((s) => s.pref === pf.id && (s.active || s.id === sel) && waterOk(s, o.water, sel));
    if (!items.length) return;
    h += `<optgroup label="${esc(pf[S.lang])}">${o.area ? `<option value="a:${pf.id}">${esc(pf[S.lang] + T('areaOnly'))}</option>` : ''}` +
      items.map((s) => `<option value="${esc(s.id)}"${s.id === sel ? ' selected' : ''}>${esc(s[S.lang] + spotTag(s))}</option>`).join('') + '</optgroup>';
  });
  if (o.custom) {
    const cs = customSpots();
    if (cs.length) h += `<optgroup label="${esc(T('mySpots'))}">${cs.map((c) => `<option value="c:${esc(c)}">${esc(c)}</option>`).join('')}</optgroup>`;
    h += `<option value="__new">+ ${esc(T('addCustom'))}</option>`;
  }
  return h;
}
function fishOpts(sel, noAny, anyLabel) {
  let h = anyLabel ? `<option value="all"${sel === 'all' ? ' selected' : ''}>${esc(anyLabel)}</option>` : '';
  Object.keys(D.FISH).forEach((k) => { if (noAny && k === 'any') return; h += `<option value="${k}"${k === sel ? ' selected' : ''}>${esc(D.FISH[k][S.lang])}</option>`; });
  return h;
}
function styleOpts(sel, anyLabel) {
  let h = anyLabel ? `<option value="all"${sel === 'all' ? ' selected' : ''}>${esc(anyLabel)}</option>` : `<option value="">${esc(T('notSet'))}</option>`;
  Object.keys(D.STYLES).forEach((k) => { h += `<option value="${k}"${k === sel ? ' selected' : ''}>${esc(D.STYLES[k][S.lang])}</option>`; });
  return h;
}

/* ---------- header and tabs ---------- */
function header() {
  const m = me();
  const seg = (act, cur, items) => items.map(([v, label]) => `<button data-act="${act}" data-v="${v}" aria-pressed="${cur === v}">${esc(label)}</button>`).join('');
  return `<header class="bar"><div class="brand"><img src="/logo.png" alt="" width="40" height="40"><div><b>${esc(T('brand'))}</b><small>${esc(T('sub'))}</small></div></div>
  <div class="bar-r">
    ${m ? `<button class="btn sm" data-act="inbox">${esc(T('inboxBtn'))}${unreadCount() ? `<span class="dot" aria-label="${esc(T('unreadLbl'))}">${unreadCount()}</span>` : ''}</button>` : ''}
    <button class="btn sm" data-act="feedback">${esc(T('feedbackBtn'))}</button>
    ${m ? '' : `<div class="seg" role="group" aria-label="${esc(T('themeLbl'))}">${seg('theme', S.theme, [['auto', T('theme_auto')], ['light', T('theme_light')], ['dark', T('theme_dark')]])}</div>`}
    <div class="seg" role="group" aria-label="Language">${seg('lang', S.lang, [['en', 'EN'], ['ja', '日本語']])}</div>
    ${m ? `<button class="btn" data-act="myprofile" aria-label="${esc(T('myProfile'))}">${av(m)}<span>${esc(m.nick)}</span>${m.admin ? `<span class="pill">${esc(T('adminTag'))}</span>` : ''}</button>`
      : `<button class="btn primary" data-act="login">${esc(T('logIn'))}</button><button class="btn" data-act="register">${esc(T('signUp'))}</button>`}
  </div></header>`;
}
function tabs() {
  const list = ['tide', 'map', 'board', 'catches', 'groups', 'chat', 'anglers'].concat(isAdmin() ? ['admin'] : []);
  const badge = (k) => {
    let n = 0;
    if (k === 'chat') n = unreadTotal();
    if (k === 'anglers') n = friends().incoming.length;
    if (k === 'admin' && S.admin) n = S.admin.counts.feedbackNew + (S.admin.counts.reportsOpen || 0) + (S.admin.counts.candidatesReady || 0);
    return n ? `<span class="dot" aria-label="${n}">${n > 99 ? '99+' : n}</span>` : '';
  };
  return `<nav class="tabs" aria-label="Sections">${list.map((k) => `<button data-act="tab" data-v="${k}"${S.tab === k ? ' aria-current="page"' : ''}>${esc(T(k))}${badge(k)}</button>`).join('')}</nav>`;
}

/* ---------- tide view ---------- */
const windArrow = (d) => `<svg viewBox="0 0 24 24" style="transform:rotate(${Math.round(d)}deg)" aria-hidden="true"><path d="M12 3v16M12 20l-5-5M12 20l5-5"/></svg>`;
/* ---------- live tide and weather ---------- */
const JST = 9 * 3600000;
function ensureForecast(id) {
  const f = S.fc[id], age = f ? Date.now() - f.at : Infinity;
  if (f && (f.busy || age < (f.status === 'ok' ? 30 * 60000 : 60000))) return f;
  const rec = { status: f ? f.status : 'loading', data: f ? f.data : null, at: f ? f.at : Date.now(), busy: true };
  S.fc[id] = rec;
  api('GET', '/api/forecast/' + encodeURIComponent(id))
    .then((d) => { S.fc[id] = d && d.error ? { status: 'err', data: null, at: Date.now() } : { status: 'ok', data: d, at: Date.now() }; })
    .catch(() => { S.fc[id] = { status: rec.data ? 'ok' : 'err', data: rec.data, at: Date.now() }; })
    .then(() => { if (S.tab === 'tide') render(); });
  return rec;
}
function wxSym(c, night) {
  if (c == null) return '–';
  if (c <= 1) return night ? '☾' : '☀︎';
  if (c === 2) return '⛅︎';
  if (c === 3 || c === 45 || c === 48) return '☁︎';
  if ((c >= 51 && c <= 67) || (c >= 80 && c <= 82)) return '☂︎';
  if ((c >= 71 && c <= 77) || c === 85 || c === 86) return '❄︎';
  if (c >= 95) return '⚡︎';
  return '☁︎';
}
/* Smooth curve through JMA's hourly levels and exact high/low tides (cubic Hermite, flat at each extreme). */
function tideCurve(td) {
  const ex = td.highs.concat(td.lows);
  const pts = new Map();
  td.hourly.forEach((v, h) => { if (!ex.some((e) => Math.abs(e.m - h * 60) < 15)) pts.set(h * 60, { m: h * 60, v, x: false }); });
  if (td.next0 != null && !ex.some((e) => Math.abs(e.m - 1440) < 15)) pts.set(1440, { m: 1440, v: td.next0, x: false });
  ex.forEach((e) => pts.set(e.m, { m: e.m, v: e.h, x: true }));
  const k = Array.from(pts.values()).sort((x, y) => x.m - y.m), n = k.length;
  const sl = k.map((q, i) => (q.x ? 0 : i === 0 ? (k[1].v - q.v) / (k[1].m - q.m) : i === n - 1 ? (q.v - k[i - 1].v) / (q.m - k[i - 1].m) : (k[i + 1].v - k[i - 1].v) / (k[i + 1].m - k[i - 1].m)));
  return (m) => {
    if (m <= k[0].m) return k[0].v;
    if (m >= k[n - 1].m) return k[n - 1].v;
    let i = 0; while (k[i + 1].m < m) i++;
    const a = k[i], b = k[i + 1], d = b.m - a.m, t = (m - a.m) / d, t2 = t * t, t3 = t2 * t;
    return (2 * t3 - 3 * t2 + 1) * a.v + (t3 - 2 * t2 + t) * d * sl[i] + (-2 * t3 + 3 * t2) * b.v + (t3 - t2) * d * sl[i + 1];
  };
}
function liveDay(sp, live, off) {
  const date = new Date(Date.now() + JST + off * 864e5).toISOString().slice(0, 10);
  const start = new Date(date + 'T00:00:00+09:00'), ms0 = start.getTime();
  const sample = TD.dayData(sp, off);
  const td = live.tide && live.tide.days && live.tide.days.find((x) => x.date === date);
  const wd = live.weather && live.weather.days.find((x) => x.date === date);
  const sr = wd ? wd.sr : sample.sr, ss = wd ? wd.ss : sample.ss, wx = [];
  for (let h = 0; h < 24; h++) {
    if (!wd || wd.temp[h] == null) { wx.push({ t: null, w: null, d: null, g: '–' }); continue; }
    const night = h * 60 + 30 < sr || h * 60 + 30 > ss;
    wx.push({ t: wd.temp[h], w: wd.wind[h], d: wd.dir[h], g: wxSym(wd.code[h], night) });
  }
  const dd = { start, ms0, sr, ss, tn: TD.tideIdx(ms0 + 12 * 36e5), wx, tideOk: !!td, curve: [], ext: [], H: () => 0 };
  if (td) {
    dd.H = tideCurve(td);
    dd.ext = td.highs.map((e) => ({ m: e.m, h: e.h, hi: true })).concat(td.lows.map((e) => ({ m: e.m, h: e.h, hi: false }))).sort((x, y) => x.m - y.m);
    const ms = new Set(dd.ext.map((e) => e.m));
    for (let m = 0; m <= 1440; m += 10) ms.add(m);
    dd.curve = Array.from(ms).sort((x, y) => x - y).map((m) => [m, dd.H(m)]);
  }
  return dd;
}
const num0 = (v, f) => (v == null ? '–' : f(v));

function tideView() {
  const sp = spotOf(homeSpotId()), fresh = sp.type === 'f';
  const fc = ensureForecast(sp.id), live = fc.status === 'ok' ? fc.data : null;
  const mode = fc.status === 'loading' ? 'loading' : live ? 'live' : 'sample';
  const dayDD = (off) => (live ? liveDay(sp, live, off) : TD.dayData(sp, off));
  const dd = dayDD(S.day);
  const weatherOnly = fresh || (mode === 'live' && !dd.tideOk);
  const isToday = S.day === 0, nowMin = (Date.now() - dd.ms0) / 6e4, curH = Math.floor(nowMin / 60);
  const W = 24 * CW, Hh = 240, top = 30, bot = 14;
  const wsel = (v, k) => `<button data-act="water" data-v="${v}" aria-pressed="${S.water === v}">${esc(T(k))}</button>`;
  const active = S.spots.filter((s) => s.active).length;
  const head = `<div class="tide-head"><div class="stackv"><label>${esc(T('homespot'))}<select id="spot">${spotOpts(sp.id, { water: S.water })}</select></label>
   <div class="seg" role="group" aria-label="${esc(T('waterLbl'))}">${wsel('all', 'waterAll')}${wsel('salt', 'waterSalt')}${wsel('fresh', 'waterFresh')}</div>
   <span class="muted small">${esc(T('spotCount')(active, D.PREFS.length))}</span></div>
   <div class="daynav"><button class="btn" data-act="dayprev" aria-label="${esc(T('prev'))}"${S.day === 0 ? ' disabled' : ''}>‹</button>
   <div class="dlabel"><b>${esc(dateStr(dd.start, true))}</b><span>${isToday ? esc(T('today')) + ' · ' : ''}${fresh ? esc(T('tagFresh')) : esc(T('tn')[dd.tn])}</span></div>
   <button class="btn" data-act="daynext" aria-label="${esc(T('next'))}"${S.day === 6 ? ' disabled' : ''}>›</button></div></div>`;
  if (mode === 'loading') return `<section>${head}<div class="panel empty">${esc(T('fcLoading'))}</div></section>`;

  let svg = '';
  if (!weatherOnly) {
    const maxH = Math.max.apply(null, dd.curve.map((p) => p[1]));
    const ymax = Math.max(100, Math.ceil((maxH + 25) / 50) * 50), step = ymax > 300 ? 100 : 50;
    const X = (m) => m / 60 * CW, Y = (h) => Hh - bot - (Math.max(0, h) / ymax) * (Hh - top - bot);
    svg = `<svg width="${W}" height="${Hh}" viewBox="0 0 ${W} ${Hh}" role="img" aria-label="${esc(T('tideLbl'))}">`;
    svg += `<rect class="c-night" x="0" y="0" width="${X(dd.sr)}" height="${Hh}"/><rect class="c-night" x="${X(dd.ss)}" y="0" width="${W - X(dd.ss)}" height="${Hh}"/>`;
    for (let i = 1; i < 24; i++) svg += `<line class="c-hr" x1="${i * CW}" x2="${i * CW}" y1="0" y2="${Hh}"/>`;
    for (let v = 0; v <= ymax; v += step) svg += `<line class="c-grid" x1="0" x2="${W}" y1="${Y(v)}" y2="${Y(v)}"/><text class="c-lbl" x="4" y="${Y(v) - 3}">${v} cm</text>`;
    const line = dd.curve.map((p, k) => (k ? 'L' : 'M') + X(p[0]).toFixed(1) + ' ' + Y(p[1]).toFixed(1)).join(' ');
    svg += `<path class="c-area" d="${line} L${W} ${Hh - bot} L0 ${Hh - bot} Z"/><path class="c-line" d="${line}"/>`;
    svg += `<text class="c-lbl" x="${X(dd.sr) + 4}" y="12">${esc(T('sunrise'))} ${fmt(dd.sr)}</text><text class="c-lbl" text-anchor="end" x="${X(dd.ss) - 4}" y="12">${esc(T('sunset'))} ${fmt(dd.ss)}</text>`;
    dd.ext.forEach((e) => {
      const x = X(e.m), y = Y(e.h), ty = e.hi ? y - 12 : y + 22, anchor = x < 40 ? 'start' : x > W - 40 ? 'end' : 'middle';
      svg += `<circle class="c-dot" cx="${x}" cy="${y}" r="5"/><text class="c-ext" text-anchor="${anchor}" x="${x}" y="${ty}">${fmt(e.m)} · ${Math.round(e.h)}</text>`;
    });
    if (isToday && nowMin >= 0 && nowMin < 1440) { const nx = X(nowMin); svg += `<line class="c-now" x1="${nx}" x2="${nx}" y1="0" y2="${Hh - bot}"/><circle class="c-nowdot" cx="${nx}" cy="${Y(dd.H(nowMin))}" r="5"/>`; }
    svg += '</svg>';
  }
  const cells = [[], [], [], []];
  dd.wx.forEach((w, h) => {
    const cur = isToday && h === curH ? ' cur' : '', strong = w.w != null && w.w >= 8 ? ' strong' : '';
    cells[0].push(`<div class="hh${cur}">${pad(h)}</div>`);
    cells[1].push(`<div class="${cur.trim()}">${w.g}</div>`);
    cells[2].push(`<div class="num${cur}">${num0(w.t, (v) => Math.round(v) + '°')}</div>`);
    cells[3].push(`<div class="num${cur}${strong}"${w.d != null ? ` title="${Math.round(w.d)}°"` : ''}>${w.w == null ? '–' : windArrow(w.d) + Math.round(w.w)}</div>`);
  });
  const hrs = cells.map((c) => `<div class="hrs">${c.join('')}</div>`).join('');
  const ws = dd.wx.filter((w) => w.w != null).map((w) => w.w), maxW = ws.length ? Math.max.apply(null, ws) : null;
  const wn = dd.wx[Math.min(23, Math.max(0, curH))];
  let stats = '';
  const stat = (label, big, sub, warn) => `<div class="stat panel${warn ? ' warn' : ''}"><small>${esc(label)}</small><b class="num">${big}</b><span>${sub}</span></div>`;
  const tC = (w) => num0(w.t, (v) => Math.round(v) + '°C'), wm = (w) => num0(w.w, (v) => v.toFixed(1) + ' m/s');
  if (weatherOnly) {
    if (isToday) stats += stat(T('now'), tC(wn), wn.g) + stat(T('wind'), wm(wn), esc(T('now')));
    stats += stat(T('sunrise'), fmt(dd.sr), esc(T('sunset')) + ' ' + fmt(dd.ss));
  } else {
    const his = dd.ext.filter((e) => e.hi).map((e) => fmt(e.m)).join(' / '), los = dd.ext.filter((e) => !e.hi).map((e) => fmt(e.m)).join(' / ');
    if (isToday) {
      const rising = dd.H(nowMin + 10) > dd.H(nowMin - 10);
      stats += stat(T('now'), Math.round(dd.H(nowMin)) + ' cm', (rising ? '↑ ' + T('rising') : '↓ ' + T('falling')) + (wn.t == null ? '' : ' · ' + tC(wn))) + stat(T('wind'), wm(wn), esc(T('now')));
    }
    stats += stat(T('high'), his || '-', esc(T('tn')[dd.tn])) + stat(T('low'), los || '-', esc(T('sunrise')) + ' ' + fmt(dd.sr) + ' · ' + esc(T('sunset')) + ' ' + fmt(dd.ss));
  }
  stats += stat(T('maxWind'), maxW == null ? '–' : maxW.toFixed(1) + ' m/s', maxW != null && maxW >= 8 ? esc(T('windWarn')) : '&nbsp;', maxW != null && maxW >= 8);
  let week = '';
  for (let i = 0; i < 7; i++) {
    const d2 = dayDD(i);
    let l2, l3;
    if (weatherOnly) {
      const ts = d2.wx.filter((w) => w.t != null).map((w) => w.t);
      l2 = d2.wx[12].g; l3 = ts.length ? Math.round(Math.max.apply(null, ts)) + '° / ' + Math.round(Math.min.apply(null, ts)) + '°' : '–';
    } else { const hs = d2.ext.filter((e) => e.hi); l2 = T('tn')[d2.tn]; l3 = (hs.length ? Math.round(Math.max.apply(null, hs.map((e) => e.h))) : '-') + ' cm'; }
    week += `<button data-act="day" data-v="${i}" aria-pressed="${i === S.day}"><b>${esc(i === 0 ? T('today') : dateStr(d2.start))}</b><span>${esc(l2)}</span><span class="num">${esc(l3)}</span></button>`;
  }
  let note;
  if (mode === 'sample') note = `<span class="err">${esc(T('fcSample'))}</span>`;
  else {
    const st = live.tide && live.tide.station;
    note = esc(fresh ? T('fcSrcWx') : T('fcSrc')(st ? st.name : '', st ? st.km : 0)) + (fresh ? ' ' + esc(T('permitNote')) : '');
    if (live.weather && live.weather.src === 'met.no') note = note.replace('Open-Meteo', 'MET Norway');
  }
  if (mode === 'live' && !live.weather) note += ` <span class="err">${esc(T('fcNoWx'))}</span>`;
  const top1 = weatherOnly ? `<p class="muted small" style="margin-bottom:10px">${esc(fresh ? T('noTide') : mode === 'live' ? T('fcNoTide') : '')}</p>` : '';
  return `<section>${head}<div class="stats">${stats}</div>${top1}
   <div class="panel chartpanel"><div class="keys">${weatherOnly ? '' : '<div class="k0">cm</div>'}<div>${esc(T('hour'))}</div><div>${esc(T('wx'))}</div><div>${esc(T('temp'))}</div><div>${esc(T('wind'))} m/s</div></div>
   <div class="scroller" id="scroller" tabindex="0" aria-label="${esc(T(weatherOnly ? 'wx' : 'tideLbl'))}"><div class="chartcol">${svg}${hrs}</div></div></div>
   <div class="week">${week}</div><p class="sample">${note}</p></section>`;
}

/* ---------- board ---------- */
function boardList() {
  const t = todayStr();
  let list = (S.data.posts || []).filter((p) => p.date >= t).map((p) => ({ p, info: feedInfo(p.host, postPref(p)) }));
  list = list.filter((x) => scopeOk(x.info, S.scope) && (S.sf === 'all' || (x.p.spot === 'custom' ? 'c:' + x.p.custom : x.p.spot) === S.sf));
  list = list.filter((x) => {
    const p = x.p;
    switch (S.filter) { case 'car': return p.transport === 'car'; case 'offer': return p.transport === 'car' && p.seatsFree > 0; case 'need': return p.transport === 'ride'; case 'transit': return p.transport === 'transit'; }
    return true;
  });
  const when = (x) => x.p.date + ' ' + x.p.time;
  list.sort((a, b) => (S.sort === 'foryou' && b.info.tier !== a.info.tier ? b.info.tier - a.info.tier : when(a) < when(b) ? -1 : when(a) > when(b) ? 1 : 0));
  return list;
}
function postCard(x) {
  const p = x.p, host = userOf(p.host), mine = p.host === myId(), member = p.members.indexOf(myId()) > -1;
  const pend = p.requests.find((r) => r.uid === myId());
  const tp = p.transport === 'car' ? `<span class="pill car">${esc(T('car'))} · ${esc(T('seatsFree')(p.seatsFree, p.seats))}</span>` : p.transport === 'ride' ? `<span class="pill ride">${esc(T('ride'))}</span>` : `<span class="pill">${esc(T('transit'))}</span>`;
  const going = p.members.map((id) => { const u = userOf(id); return `<span class="m">${av(u)}${profLink(u)}${id === p.host ? ` <small class="muted">· ${esc(T('hostTag'))}</small>` : ''}</span>`; }).join('');
  const meet = p.meet ? esc(p.meet) : `<span class="locked">${esc(T('meetLocked'))}</span>`;
  const chatBtn = `<button class="btn sm" data-act="tripchat" data-p="${p.id}">${esc(T('openChat'))}</button>`;
  let action = '';
  if (mine) {
    action = `<div class="reqs"><div class="small muted"><b>${esc(T('requests'))}</b></div>` + (p.requests.length ? p.requests.map((r) => {
      const u = userOf(r.uid), full = r.needRide && p.seatsFree <= 0;
      return `<div class="req"><div class="row"><span class="row" style="gap:8px">${av(u)}<b>${profLink(u)}</b>${r.needRide ? `<span class="pill ride">${esc(T('needsRide'))}</span>` : ''}${r.canDrive ? `<span class="pill car">${esc(T('canDrive'))}</span>` : ''}</span>
        <span class="row" style="gap:6px"><button class="btn sm primary" data-act="accept" data-p="${p.id}" data-u="${esc(r.uid)}"${full ? ' disabled' : ''}>${esc(full ? T('full') : T('accept'))}</button><button class="btn sm" data-act="decline" data-p="${p.id}" data-u="${esc(r.uid)}">${esc(T('decline'))}</button></span></div>${r.msg ? `<div class="small">${esc(r.msg)}</div>` : ''}</div>`;
    }).join('') : `<div class="muted small">${esc(T('noReq'))}</div>`) + `<div class="row">${chatBtn}<button class="btn sm warn" data-act="delpost" data-p="${p.id}">${esc(T('cancelTrip'))}</button></div></div>`;
  } else if (member) action = `<div class="row"><span class="pill good">${esc(T('youIn'))}</span>${chatBtn}</div>`;
  else if (pend) action = `<div class="row"><span class="pill">${esc(T('requested'))}</span><button class="btn sm" data-act="cancelreq" data-p="${p.id}">${esc(T('cancelReq'))}</button></div>`;
  else action = `<div><button class="btn primary" data-act="join" data-p="${p.id}">${esc(T('requestJoin'))}</button></div>`;
  const mod = isAdmin() && !mine ? `<div><button class="btn sm warn" data-act="delpost" data-p="${p.id}" data-admin="1">${esc(T('adminRemove'))}</button></div>` : !mine ? `<div>${reportBtn('post', p.id)}</div>` : '';
  return `<article class="panel post"><div class="row" style="justify-content:space-between;align-items:flex-start"><div><div class="when num">${esc(dateStr(parseD(p.date), true))} · ${esc(p.time)}</div><h3>${esc(postSpot(p))} · ${esc(fName(p.fish))}</h3></div>${tp}</div>
   <div class="tags">${feedBadges(x.info)}</div>
   <div class="facts"><div><span class="k">${esc(T('host'))}</span><span class="row" style="gap:8px">${av(host)}${profLink(host)}</span></div>
   <div><span class="k">${esc(T('meet'))}</span><span>${meet}</span></div>${p.note ? `<div><span class="k">${esc(T('notes'))}</span><span>${esc(p.note)}</span></div>` : ''}
   <div><span class="k">${esc(T('going'))} (${p.members.length})</span><span class="going">${going}</span></div></div>${action}${mod}</article>`;
}
function boardView() {
  const all = (S.data.posts || []).filter((p) => p.date >= todayStr());
  const cnt = { all: all.length, car: 0, offer: 0, need: 0, transit: 0 };
  all.forEach((p) => { if (p.transport === 'car') { cnt.car++; if (p.seatsFree > 0) cnt.offer++; } else if (p.transport === 'ride') cnt.need++; else cnt.transit++; });
  const F = [['all', 'fAll'], ['car', 'fCar'], ['offer', 'fOffer'], ['need', 'fNeed'], ['transit', 'fTransit']];
  const seen = {}; let sfo = `<option value="all">${esc(T('allSpots'))}</option>`;
  all.forEach((p) => { const k = p.spot === 'custom' ? 'c:' + p.custom : p.spot; if (seen[k]) return; seen[k] = 1; sfo += `<option value="${esc(k)}"${S.sf === k ? ' selected' : ''}>${esc(postSpot(p))}</option>`; });
  const list = boardList();
  return `<section><p class="muted small feednote">${esc(S.sort === 'foryou' ? T('feedNote')(prefName(myPref())) : T('sortedSoon'))}</p>
   <div class="boardbar"><div class="chips" role="group">${F.map((f) => `<button class="chip" data-act="filter" data-v="${f[0]}" aria-pressed="${S.filter === f[0]}">${esc(T(f[1]))}<i class="num">${cnt[f[0]]}</i></button>`).join('')}</div>
   <button class="btn primary" data-act="newpost">+ ${esc(T('newPost'))}</button></div>
   <div class="boardbar">${scopeChips('scope', S.scope)}<div class="row"><select id="sort" aria-label="${esc(T('sortLbl'))}" style="width:auto"><option value="foryou"${S.sort === 'foryou' ? ' selected' : ''}>${esc(T('sortForYou'))}</option><option value="soon"${S.sort === 'soon' ? ' selected' : ''}>${esc(T('sortSoon'))}</option></select>
   <select id="sf" aria-label="${esc(T('spotLbl'))}" style="width:auto;max-width:100%">${sfo}</select></div></div>
   ${list.length ? `<div class="posts">${list.map(postCard).join('')}</div>` : `<div class="panel empty">${esc(T('noPosts'))}</div>`}</section>`;
}

/* ---------- catches ---------- */
function ph(c) {
  const h = D.hash(c.id) % 360;
  return `<svg class="photo" viewBox="0 0 400 300" role="img" aria-label="${esc(fName(c.fish))}" preserveAspectRatio="xMidYMid slice"><defs><linearGradient id="g-${c.id}" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="hsl(${h} 45% 62%)"/><stop offset="1" stop-color="hsl(${h} 55% 26%)"/></linearGradient></defs>
  <rect width="400" height="300" fill="url(#g-${c.id})"/><path d="M0 214q50-22 100 0t100 0t100 0t100 0V300H0Z" fill="#fff" fill-opacity=".12"/><path d="M0 244q50-22 100 0t100 0t100 0t100 0V300H0Z" fill="#fff" fill-opacity=".1"/>
  <g transform="translate(196 130)"><ellipse rx="84" ry="36" fill="#fff" fill-opacity=".9"/><path d="M76 0L132 -34L132 34Z" fill="#fff" fill-opacity=".9"/><circle cx="-52" cy="-7" r="6" fill="hsl(${h} 55% 26%)"/></g>
  <text x="200" y="280" text-anchor="middle" fill="#fff" fill-opacity=".85" font-size="14">${esc(T('noPhoto'))}</text></svg>`;
}
function catchCard(x, detail) {
  const c = x.c, u = userOf(c.by), mine = c.by === myId(), liked = c.likes.indexOf(myId()) > -1, open = detail === true || !!S.openC[c.id], tk = c.tackle || {};
  const has = !!(tk.rod || tk.reel || tk.line || tk.lure);
  const rows = [['rod', 'rod'], ['reel', 'reel'], ['line', 'lineLbl'], ['lure', 'lureLbl']].filter((r) => tk[r[0]]).map((r) => `<div><span class="k">${esc(T(r[1]))}</span><span>${esc(tk[r[0]])}</span></div>`).join('');
  const tackle = has ? `<div class="tackle"><div class="row" style="gap:8px"><b class="small">${esc(T('tackleLbl'))}</b>${!tk.pub ? `<span class="pill">${esc(T('onlyYou'))}</span>` : ''}</div><div class="facts">${rows}</div></div>` : `<div class="muted small">${esc(T('tacklePrivate'))}</div>`;
  const img = c.photo ? `<img class="photo" alt="${esc(fName(c.fish))}" src="${esc(c.photo)}" loading="lazy">` : ph(c);
  const cm = c.comments.map((m) => {
    const cu = userOf(m.u), canDel = m.u === myId() || mine || isAdmin();
    return `<div class="cm">${av(cu)}<div><b>${profLink(cu)}</b><time>${esc(timeStr(m.t))}</time>${canDel ? ` <button class="linkbtn small muted" data-act="delcomment" data-id="${esc(m.id)}">${esc(T('del'))}</button>` : ''}${m.u !== myId() && !isAdmin() ? ' ' + reportBtn('comment', m.id) : ''}<p>${esc(m.x)}</p></div></div>`;
  }).join('');
  const pin = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 21s-6.5-5.6-6.5-11a6.5 6.5 0 0 1 13 0c0 5.4-6.5 11-6.5 11z"/><circle cx="12" cy="10" r="2.3"/></svg>';
  const heart = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 20s-7-4.6-7-10a4 4 0 0 1 7-2.6A4 4 0 0 1 19 10c0 5.4-7 10-7 10z"/></svg>';
  return `<article class="panel catch">${img}<div class="body"><div class="byline">${av(u)}<b>${profLink(u)}</b><span class="muted">· ${esc(dateStr(parseD(c.when)))}</span></div>
   <div class="tags">${feedBadges(x.info)}</div>
   <div><h3>${esc(fName(c.fish))}${c.size ? ` · <span class="num">${c.size} cm</span>` : ''}</h3><span class="loc">${pin}${esc(locName(c.loc))}</span></div>
   ${c.cap ? `<p>${esc(c.cap)}</p>` : ''}${tackle}
   <div class="actions"><button class="like" data-act="like" data-c="${c.id}" aria-pressed="${liked}" aria-label="${esc(T('likeLbl'))}">${heart}<span class="num">${c.likes.length}</span></button>
   ${detail === true ? `<b class="small">${esc(T('commentsN')(c.comments.length))}</b>` : `<button class="btn sm" data-act="togglec" data-c="${c.id}" aria-expanded="${open}">${esc(T('commentsN')(c.comments.length))}</button>`}
   ${!mine && !isAdmin() ? reportBtn('catch', c.id) : ''}${mine ? `<button class="btn sm warn" data-act="delcatch" data-c="${c.id}">${esc(T('del'))}</button>` : isAdmin() ? `<button class="btn sm warn" data-act="delcatch" data-c="${c.id}" data-admin="1">${esc(T('adminRemove'))}</button>` : ''}</div>
   ${open ? `<div class="comments">${cm}<form class="send" data-form="comment" data-c="${c.id}"><input type="text" id="cm-${c.id}" maxlength="200" autocomplete="off" placeholder="${esc(T('addComment'))}" aria-label="${esc(T('addComment'))}"><button class="btn primary sm" type="submit">${esc(T('postBtn'))}</button></form></div>` : ''}</div></article>`;
}
function catchesView() {
  let list = (S.data.catches || []).map((c) => ({ c, info: feedInfo(c.by, catchPref(c)) })).filter((x) => scopeOk(x.info, S.cScope));
  if (S.cSort === 'foryou') list = list.map((x, i) => ({ x, i })).sort((a, b) => (b.x.info.tier - a.x.info.tier) || (a.i - b.i)).map((o) => o.x);
  return `<section><p class="muted small feednote">${esc(S.cSort === 'foryou' ? T('feedNote')(prefName(myPref())) : T('sortedNew'))}</p>
   <div class="boardbar"><p class="muted small" style="max-width:60ch">${esc(T('catchLead'))}</p><button class="btn primary" data-act="newcatch">+ ${esc(T('shareCatch'))}</button></div>
   <div class="boardbar">${scopeChips('cscope', S.cScope)}<select id="csort" aria-label="${esc(T('sortLbl'))}" style="width:auto"><option value="foryou"${S.cSort === 'foryou' ? ' selected' : ''}>${esc(T('sortForYou'))}</option><option value="new"${S.cSort === 'new' ? ' selected' : ''}>${esc(T('sortNew'))}</option></select></div>
   ${list.length ? `<div class="catches">${list.map((x) => catchCard(x)).join('')}</div>` : `<div class="panel empty">${esc(T('noCatches'))}</div>`}</section>`;
}

/* ---------- map ---------- */
const TYPE_COL = { s: '#2F5D8C', b: '#B5702A', f: '#4F7F3F' };
const M = { el: null, map: null, cluster: null, pinLayer: null, selLayer: null, sig: '', t: 0 };
const myPins = () => (S.data && S.data.pins) || [];
const mapLib = () => typeof L !== 'undefined' && !!L.markerClusterGroup;
function distKm(la1, ln1, la2, ln2) { const r = Math.PI / 180, x = (ln2 - ln1) * r * Math.cos((la1 + la2) / 2 * r), y = (la2 - la1) * r; return 6371 * Math.hypot(x, y); }
const mapSpots = () => S.spots.filter((s) => s.active && s.lat != null && (S.mapWater === 'all' || (S.mapWater === 'fresh' ? s.type === 'f' : s.type !== 'f')));
const spotCatches = (id) => (S.data.catches || []).filter((c) => c.loc.k === 'spot' && c.loc.v === id);
function pinCatches(pin) {
  const out = [];
  (S.data.catches || []).forEach((c) => {
    if (c.loc.k !== 'spot') return;
    const s = SM[c.loc.v]; if (!s || s.lat == null) return;
    const d = distKm(pin.lat, pin.lng, s.lat, s.lng);
    if (d <= 10) out.push({ c, d });
  });
  return out.sort((x, y) => x.d - y.d);
}
function thumbs(list) {
  return `<div class="thumbs">${list.map((c) => `<button class="thumb" data-act="opencatch" data-c="${esc(c.id)}" aria-label="${esc(fName(c.fish))}${c.size ? ' ' + c.size + ' cm' : ''}">${c.photo ? `<img alt="" loading="lazy" src="${esc(c.photo)}">` : ph(c)}<span>${esc(fName(c.fish))}${c.size ? ' · ' + c.size + ' cm' : ''}</span></button>`).join('')}</div>`;
}
function spotListHtml() {
  const q = S.mapQ.trim().toLowerCase(), all = mapSpots();
  let rows, head;
  if (q) {
    rows = all.filter((s) => (s.en + ' ' + s.ja + ' ' + prefName(s.pref) + ' ' + (D.PREFS.find((x) => x.id === s.pref) || {}).en).toLowerCase().indexOf(q) > -1);
    head = T('mapResults')(Math.min(rows.length, 50), rows.length);
  } else {
    const c = M.map ? M.map.getCenter() : { lat: 36.5, lng: 138 };
    rows = all.map((s) => ({ s, d: distKm(c.lat, c.lng, s.lat, s.lng) })).sort((x, y) => x.d - y.d).slice(0, 50).map((o) => o.s);
    head = T('mapNearest');
  }
  const list = rows.slice(0, 50).map((s) => `<button class="mrow-btn" data-act="mapsel" data-t="spot" data-id="${esc(s.id)}"><span class="swatch" style="background:${TYPE_COL[s.type]}"></span><span class="grow"><b>${esc(s[S.lang])}</b><br><span class="muted small">${esc(prefName(s.pref))}${esc(spotTag(s))}</span></span><span class="num muted small">${spotCatches(s.id).length ? '📷 ' + spotCatches(s.id).length : ''}</span></button>`).join('');
  return `<p class="small muted" style="margin:0 0 8px">${esc(head)}</p>${list || `<p class="muted">${esc(T('mapNone'))}</p>`}`;
}
function pinsListHtml() {
  const pins = myPins();
  return `<div class="sec"><b class="small muted">${esc(T('mapMyPins'))}</b>${pins.length ? pins.map((p) => `<button class="mrow-btn" data-act="mapsel" data-t="pin" data-id="${esc(p.id)}"><span class="swatch star">★</span><span class="grow"><b>${esc(p.name)}</b></span></button>`).join('') : `<p class="muted small">${esc(me() ? T('mapNoPins') : T('mapPinsLogin'))}</p>`}</div>`;
}
function spotPanel(id) {
  const s = SM[id]; if (!s) return backBtn() + `<p class="muted">${esc(T('mapNone'))}</p>`;
  const cs = spotCatches(id);
  return `${backBtn()}<h3 style="margin:8px 0 2px">${esc(s[S.lang])}</h3><p class="muted small">${esc(s[S.lang === 'en' ? 'ja' : 'en'])} · ${esc(prefName(s.pref))}${esc(spotTag(s))}</p>
   <div class="row" style="gap:8px;margin:10px 0"><button class="btn sm primary" data-act="sethome" data-id="${esc(id)}">${esc(T('setHome'))}</button><button class="btn sm" data-act="newcatch">${esc(T('shareCatch'))}</button></div>
   <b class="small muted">${esc(T('catchesHere')(cs.length))}</b>${cs.length ? thumbs(cs) : `<p class="muted small">${esc(T('noCatchesHere'))}</p>`}`;
}
function pinPanel(id) {
  const pn = myPins().find((x) => x.id === id); if (!pn) return backBtn() + `<p class="muted">${esc(T('mapNone'))}</p>`;
  const near = pinCatches(pn);
  return `${backBtn()}<h3 style="margin:8px 0 2px">★ ${esc(pn.name)}</h3><p class="small"><span class="pill good">${esc(T('pinPrivate'))}</span></p>${pn.note ? `<p style="margin:8px 0">${esc(pn.note)}</p>` : ''}
   <p class="muted small num">${pn.lat.toFixed(5)}, ${pn.lng.toFixed(5)}</p>
   <div class="row" style="gap:8px;margin:10px 0"><button class="btn sm" data-act="editpin" data-id="${esc(pn.id)}">${esc(T('edit'))}</button><button class="btn sm warn" data-act="delpin" data-id="${esc(pn.id)}">${esc(T('del'))}</button></div>
   <b class="small muted">${esc(T('catchesNearPin')(near.length))}</b>${near.length ? thumbs(near.map((o) => o.c)) : `<p class="muted small">${esc(T('noCatchesHere'))}</p>`}`;
}
const backBtn = () => `<button class="linkbtn small" data-act="mapclear">‹ ${esc(T('backToList'))}</button>`;
function mapSideHtml() {
  const s = S.mapSel;
  if (s && s.t === 'spot') return spotPanel(s.id);
  if (s && s.t === 'pin') return pinPanel(s.id);
  return spotListHtml() + pinsListHtml();
}
function mapView() {
  const chip = (v, k) => `<button class="chip" data-act="mapwater" data-v="${v}" aria-pressed="${S.mapWater === v}">${esc(T(k))}</button>`;
  const legend = ['s', 'b', 'f'].map((t) => `<span class="lg"><span class="swatch" style="background:${TYPE_COL[t]}"></span>${esc(T('type_' + t))}</span>`).join('') + `<span class="lg"><span class="swatch star">★</span>${esc(T('mapMyPins'))}</span>`;
  return `<section><div class="maptools"><input type="text" id="mapq" value="${esc(S.mapQ)}" placeholder="${esc(T('mapSearchPh'))}" aria-label="${esc(T('mapSearchPh'))}" autocomplete="off">
   <div class="chips">${chip('all', 'waterAll')}${chip('salt', 'waterSalt')}${chip('fresh', 'waterFresh')}</div>
   <button class="btn${S.pinMode ? ' warn' : ' primary'}" data-act="mappin">${esc(S.pinMode ? T('cancel') : '★ ' + T('mapAddPin'))}</button></div>
   ${S.pinMode ? `<p class="pinhelp">${esc(T('mapPinHelp'))}</p>` : ''}
   <div class="maplayout"><div><div id="mapslot" class="mapslot"></div><div class="legend small muted">${legend}<span class="grow"></span><span class="chips" role="group" aria-label="${esc(T('mapBaseLbl'))}">${BASES.map((v) => `<button class="chip" data-act="mapbase" data-v="${v}" aria-pressed="${v === (M.baseKey || mapBase())}">${esc(T('mapBase_' + v))}</button>`).join('')}</span><span>${esc(T('mapCount')(mapSpots().length))}</span></div></div>
   <aside class="mapside panel" id="mapside">${mapSideHtml()}</aside></div></section>`;
}
/* Base maps: OpenFreeMap (vector, labels follow the site language) is the default; GSI standard and aerial photos are the alternatives. */
const BASES = ['openfree', 'gsi', 'photo'];
const GSI_ATTR = '<a href="https://maps.gsi.go.jp/development/ichiran.html" target="_blank" rel="noopener">出典:国土地理院 / GSI Japan</a>';
const OSM_NOTE = ' · Imported spots © <a href="https://www.openstreetmap.org/copyright" target="_blank" rel="noopener">OpenStreetMap</a> contributors';
const OF_ATTR = '<a href="https://openfreemap.org" target="_blank" rel="noopener">OpenFreeMap</a> © <a href="https://openmaptiles.org/" target="_blank" rel="noopener">OpenMapTiles</a> Data from <a href="https://www.openstreetmap.org/copyright" target="_blank" rel="noopener">OpenStreetMap</a>';
function mapBase() { let b = null; try { b = localStorage.getItem('castomo.base'); } catch (e) { /* storage blocked */ } return BASES.includes(b) ? b : 'openfree'; }
function applyMapLang() {
  const gl = M.gl; if (!gl || !M.glOk) return;
  const expr = S.lang === 'ja' ? ['coalesce', ['get', 'name:ja'], ['get', 'name']] : ['coalesce', ['get', 'name:en'], ['get', 'name:latin'], ['get', 'name']];
  try {
    (gl.getStyle().layers || []).forEach((l) => {
      const tf = l.layout && l.layout['text-field'];
      if (l.type === 'symbol' && tf && JSON.stringify(tf).includes('name') && !/housenumber/.test(l.id)) gl.setLayoutProperty(l.id, 'text-field', expr);
    });
    M.glLang = S.lang;
  } catch (e) { /* style not ready yet */ }
}
function setBase(b) {
  if (M.layer) { M.map.removeLayer(M.layer); M.layer = null; }
  M.gl = null; M.glOk = false; M.baseKey = b;
  if (b === 'openfree' && window.maplibregl && L.maplibreGL) {
    try {
      window.maplibregl.setWorkerUrl('/vendor/maplibre/maplibre-gl-csp-worker.js');
      const layer = L.maplibreGL({ style: 'https://tiles.openfreemap.org/styles/liberty', attribution: OF_ATTR + OSM_NOTE });
      layer.addTo(M.map); M.layer = layer;
      const gl = layer.getMaplibreMap(); M.gl = gl;
      const giveUp = () => { if (M.layer === layer && !M.glOk) { M.baseKey = 'gsi'; setBase('gsi'); syncBaseChips(); } };
      gl.on('load', () => { M.glOk = true; applyMapLang(); });
      gl.on('styledata', () => { if (M.glOk) applyMapLang(); });
      gl.on('error', () => { if (!M.glOk) giveUp(); });
      setTimeout(giveUp, 15000);
      return;
    } catch (e) { M.layer = null; M.gl = null; b = 'gsi'; M.baseKey = 'gsi'; }
  }
  const photo = b === 'photo';
  M.layer = L.tileLayer('https://cyberjapandata.gsi.go.jp/xyz/' + (photo ? 'seamlessphoto/{z}/{x}/{y}.jpg' : 'std/{z}/{x}/{y}.png'), { maxZoom: 18, attribution: GSI_ATTR + OSM_NOTE }).addTo(M.map);
  M.layer.bringToBack();
}
function syncBaseChips() { document.querySelectorAll('[data-act=mapbase]').forEach((c) => c.setAttribute('aria-pressed', String(c.dataset.v === (M.baseKey || mapBase())))); }
function initMap() {
  M.el = document.createElement('div'); M.el.className = 'leafmap';
  const home = SM[homeSpotId()];
  M.map = L.map(M.el, { center: home && home.lat != null ? [home.lat, home.lng] : [36.5, 138], zoom: home && home.lat != null ? 9 : 5, minZoom: 5, maxZoom: 18, preferCanvas: true });
  setBase(mapBase());
  M.cluster = L.markerClusterGroup({ showCoverageOnHover: false, maxClusterRadius: 45, chunkedLoading: true, disableClusteringAtZoom: 13 }).addTo(M.map);
  M.pinLayer = L.layerGroup().addTo(M.map);
  M.selLayer = L.layerGroup().addTo(M.map);
  M.map.on('click', (e) => {
    if (S.pinMode) { S.pinMode = false; S.sheet = { k: 'pin', lat: Math.round(e.latlng.lat * 1e5) / 1e5, lng: Math.round(e.latlng.lng * 1e5) / 1e5 }; render(); }
    else if (S.mapSel) { S.mapSel = null; render(); }
  });
  M.map.on('moveend', () => { clearTimeout(M.t); M.t = setTimeout(() => { const box = $('#mapside'); if (box && S.tab === 'map' && !S.mapSel && !S.sheet && !(document.activeElement && document.activeElement.id === 'mapq')) box.innerHTML = mapSideHtml(); }, 350); });
}
function syncMarkers() {
  const sig = [S.spotsRev, S.spots.length, S.lang, S.mapWater, JSON.stringify(myPins()), isAdmin() && S.admin && S.admin.candidates ? S.admin.candidates.map((c) => c.id + c.n).join() : ''].join('|');
  if (sig === M.sig) return;
  M.sig = sig;
  M.cluster.clearLayers(); M.pinLayer.clearLayers();
  const arr = mapSpots().map((s) => {
    const m = L.circleMarker([s.lat, s.lng], { radius: 7, weight: 2, color: '#fff', fillColor: TYPE_COL[s.type], fillOpacity: 0.95, bubblingMouseEvents: false });
    m.on('click', () => { S.mapSel = { t: 'spot', id: s.id }; render(); });
    m.bindTooltip(esc(s[S.lang]));
    return m;
  });
  M.cluster.addLayers(arr);
  if (isAdmin() && S.admin && S.admin.candidates) S.admin.candidates.forEach((c) => {
    const m = L.marker([c.lat, c.lng], { icon: L.divIcon({ className: 'candpin', html: '?', iconSize: [26, 26], iconAnchor: [13, 13] }), keyboard: true, title: T('ns_adminOnly') });
    m.on('click', () => { S.tab = 'admin'; S.adminTab = 'newspots'; render(); });
    m.bindTooltip(esc(T('ns_mapTip')(c.n)));
    M.pinLayer.addLayer(m);
  });
  myPins().forEach((pn) => {
    const m = L.marker([pn.lat, pn.lng], { icon: L.divIcon({ className: 'mypin', html: '★', iconSize: [28, 28], iconAnchor: [14, 14] }), keyboard: true, title: pn.name });
    m.on('click', () => { S.mapSel = { t: 'pin', id: pn.id }; render(); });
    m.bindTooltip(esc(pn.name));
    M.pinLayer.addLayer(m);
  });
}
function syncSel() {
  M.selLayer.clearLayers();
  const s = S.mapSel; let pt = null;
  if (s && s.t === 'spot' && SM[s.id] && SM[s.id].lat != null) pt = [SM[s.id].lat, SM[s.id].lng];
  if (s && s.t === 'pin') { const pn = myPins().find((x) => x.id === s.id); if (pn) pt = [pn.lat, pn.lng]; }
  if (pt) L.circleMarker(pt, { radius: 15, weight: 3, color: '#E0412B', fill: false, interactive: false }).addTo(M.selLayer);
  if (S.mapFly && pt) { M.map.flyTo(pt, Math.max(M.map.getZoom(), 13), { duration: 0.6 }); }
  S.mapFly = false;
}
function mountMap() {
  const slot = $('#mapslot'); if (!slot) return;
  if (!mapLib()) { slot.innerHTML = `<div class="panel empty">${esc(T('mapFail'))}</div>`; return; }
  if (!M.map) initMap();
  slot.appendChild(M.el);
  M.map.invalidateSize(false);
  M.el.classList.toggle('pinmode', !!S.pinMode);
  if (M.gl && M.glOk && M.glLang !== S.lang) applyMapLang();
  syncMarkers(); syncSel();
}
function pinSheet() {
  const sh = S.sheet, pn = sh.id ? myPins().find((x) => x.id === sh.id) : null;
  const lat = pn ? pn.lat : sh.lat, lng = pn ? pn.lng : sh.lng;
  return sheetWrap(`<h2>★ ${esc(pn ? T('pinEdit') : T('pinNew'))}</h2><p class="small"><span class="pill good">${esc(T('pinPrivate'))}</span></p>
   <form data-form="pin"${pn ? ` data-id="${esc(pn.id)}"` : ''} style="display:grid;gap:12px">
   <label class="f">${esc(T('pinName'))}<input type="text" id="pn-name" required maxlength="40" value="${esc(pn ? pn.name : '')}"></label>
   <label class="f">${esc(T('pinNote'))}<textarea id="pn-note" maxlength="300">${esc(pn ? pn.note : '')}</textarea></label>
   <div class="two"><label class="f">${esc(T('latLbl'))}<input type="number" id="pn-lat" required step="0.00001" min="20" max="46" value="${lat}"></label><label class="f">${esc(T('lngLbl'))}<input type="number" id="pn-lng" required step="0.00001" min="122" max="154" value="${lng}"></label></div>
   <p class="err" id="pn-err" role="alert"></p>${btnRow('closesheet', T('save'))}</form>`);
}
function catchViewSheet() {
  const c = (S.data.catches || []).find((x) => x.id === S.sheet.id);
  if (!c) return '';
  return sheetWrap(catchCard({ c, info: feedInfo(c.by, catchPref(c)) }, true) + `<div class="row" style="justify-content:flex-end"><button class="btn" data-act="closesheet">${esc(T('close'))}</button></div>`);
}

/* ---------- chat ---------- */
function roomTitle(key) {
  if (key === 'all') return T('everyone');
  if (key.indexOf('region-') === 0) return regionName(key.slice(7));
  if (key.indexOf('dm-') === 0) return '@' + userOf(key.slice(3)).nick;
  if (key.indexOf('group-') === 0) { const g = (S.data.groups || []).find((x) => 'group-' + x.id === key); return g ? g.name : ''; }
  const p = (S.data.posts || []).find((x) => 'post-' + x.id === key);
  return p ? postSpot(p) + ' · ' + dateStr(parseD(p.date)) : T('trip');
}
function roomGroups() {
  const rooms = S.data.rooms || {}, out = { all: ['all'], region: [], post: [], group: [], dm: [] };
  Object.keys(rooms).forEach((k) => { if (k.indexOf('post-') === 0) out.post.push(k); else if (k.indexOf('group-') === 0) out.group.push(k); else if (k.indexOf('dm-') === 0) out.dm.push(k); });
  D.REGIONS.forEach((r) => { if (rooms['region-' + r.id]) out.region.push('region-' + r.id); });
  if (S.room.indexOf('dm-') === 0 && !rooms[S.room] && userOf(S.room.slice(3)).id) out.dm.push(S.room);
  return out;
}
function recipientCount(key) {
  if (key.indexOf('dm-') === 0) return 1;
  if (key.indexOf('post-') === 0) { const p = (S.data.posts || []).find((x) => 'post-' + x.id === key); return p ? Math.max(0, p.members.length - 1) : 0; }
  if (key.indexOf('group-') === 0) { const g = (S.data.groups || []).find((x) => 'group-' + x.id === key); return g ? Math.max(0, g.members.length - 1) : 0; }
  return 0;
}
function tickHtml(m, key) {
  const n = recipientCount(key), s = Math.min(m.seen.length, n);
  const one = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4 12.5l4.5 4.5L15 8"/></svg>';
  const two = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M2 12.5l4.5 4.5L13 8"/><path d="M10 15.5l1.5 1.5L20 8"/></svg>';
  if (!s) return `<div class="tick">${one}${esc(T('sent'))}</div>`;
  const label = s >= n ? (n > 1 ? T('seenAll') : T('seen')) : T('seenBy')(s, n);
  return `<div class="tick seen">${two}${esc(label)}</div>`;
}
function threadHtml(key) {
  const r = (S.data.rooms || {})[key] || { read: 0, messages: [] };
  const status = /^(post|group|dm)-/.test(key);
  let sub = '';
  if (key.indexOf('post-') === 0) {
    const p = (S.data.posts || []).find((x) => 'post-' + x.id === key);
    sub = esc(T('tripNote')) + (p ? '<br>' + esc(p.members.map((id) => userOf(id).nick).join(', ')) + ' · ' + esc(T('meetAt')) + ': ' + esc(p.time) + (p.meet ? ', ' + esc(p.meet) : '') : '');
  } else if (key.indexOf('group-') === 0) {
    const g = (S.data.groups || []).find((x) => 'group-' + x.id === key);
    sub = esc(T('groupNote')) + (g ? '<br>' + esc(g.members.map((id) => userOf(id).nick).join(', ')) : '');
  } else if (key.indexOf('dm-') === 0) { const u = userOf(key.slice(3)); sub = esc(stName(u.style)) + ' · ' + esc(fName(u.target)); }
  else sub = esc(T('publicNote'));
  const msgs = r.messages.map((m) => {
    if (m.sys) return `<div class="sys">${esc(T('sys_' + m.sys)(userOf(m.u).nick))}</div>`;
    const u = userOf(m.u), mine = m.u === myId();
    return `<div class="msg${mine ? ' me' : ''}">${mine ? '' : av(u)}<div class="col"><div><b>${mine ? esc(T('you')) : profLink(u)}</b><time>${esc(timeStr(m.t))}</time></div><div class="bubble">${esc(m.x)}</div>${mine && status ? tickHtml(m, key) : ''}</div></div>`;
  }).join('');
  return `<div class="panel thread"><header><h3>${esc(roomTitle(key))}</h3><div class="muted small">${sub}</div></header>
   <div class="msgs" id="msgs">${msgs || `<div class="muted">${esc(key.indexOf('post-') === 0 ? T('emptyTrip') : T('emptyRoom'))}</div>`}</div>
   <form class="send" data-form="send" data-room="${esc(key)}"><input type="text" id="chatin" maxlength="1000" autocomplete="off" placeholder="${esc(T('typeMsg'))}" aria-label="${esc(T('typeMsg'))}"><button class="btn primary" type="submit">${esc(T('send'))}</button></form></div>`;
}
function loginPrompt(why) { return `<div class="panel empty"><span>${esc(why)}</span><div class="row"><button class="btn primary" data-act="login">${esc(T('logIn'))}</button><button class="btn" data-act="register">${esc(T('signUp'))}</button></div></div>`; }
function chatView() {
  if (!me()) return loginPrompt(T('chatLogin'));
  const g = roomGroups();
  const all = [].concat(g.all, g.region, g.post, g.group, g.dm);
  if (all.indexOf(S.room) < 0) S.room = 'all';
  const list = (keys, label) => keys.length ? `<h3>${esc(label)}</h3>` + keys.map((k) => { const n = unreadIn(k); return `<button data-act="room" data-v="${esc(k)}" aria-current="${k === S.room}">${esc(roomTitle(k))}${n ? `<span class="dot">${n}</span>` : ''}</button>`; }).join('') : '';
  return `<section class="chat"><div class="rooms">${list(g.all, T('rooms'))}${list(g.post, T('myTrips'))}${list(g.group, T('groupRooms'))}${list(g.dm, T('dms'))}${list(g.region, T('areaRooms'))}</div>${threadHtml(S.room)}</section>`;
}

/* ---------- anglers ---------- */
function anglerRows() {
  const q = S.q.trim().toLowerCase();
  return (S.data.users || []).map((u) => ({ u, info: feedInfo(u.id, userPref(u)) })).filter((x) => {
    const u = x.u;
    if (!scopeOk(x.info, S.aScope)) return false;
    if (S.fs !== 'all' && u.style !== S.fs) return false;
    if (S.ft !== 'all' && u.target !== S.ft) return false;
    if (!q) return true;
    const sp = spotOf(u.spot), st = D.STYLES[u.style] ? D.STYLES[u.style].en + ' ' + D.STYLES[u.style].ja : '';
    const fs = [u.target].concat(u.fish || []).map((f) => (D.FISH[f] ? D.FISH[f].en + ' ' + D.FISH[f].ja : '')).join(' ');
    return [u.nick, u.name, u.bio, sp.en, sp.ja, st, fs].join(' ').toLowerCase().indexOf(q) > -1;
  }).sort((a, b) => (a.u.id === myId() ? -1 : b.u.id === myId() ? 1 : 0) || (b.info.tier - a.info.tier) || a.u.nick.localeCompare(b.u.nick));
}
function anglerList() {
  const rows = anglerRows();
  return `<div class="muted small">${esc(T('registered')(rows.length))}</div>` + (rows.length ? `<div class="people">${rows.map((x) => {
    const u = x.u, self = u.id === myId();
    return `<article class="panel person" data-act="profile" data-u="${esc(u.id)}"><div class="row" style="flex-wrap:nowrap">${av(u, 'lg')}<div style="min-width:0"><h3><button class="linkbtn" data-act="profile" data-u="${esc(u.id)}">${esc(u.nick)}</button>${self ? ` <span class="pill">${esc(T('youTag'))}</span>` : ''}</h3><div class="muted small">${u.name ? esc(u.name) + ' · ' : ''}${esc(sName(u.spot))}</div></div></div>
     <div class="tags">${feedBadges(x.info)}</div>
     <div class="facts"><div><span class="k">${esc(T('styleLbl'))}</span><span><span class="pill">${esc(stName(u.style))}</span></span></div><div><span class="k">${esc(T('primary'))}</span><span><span class="pill car">${esc(fName(u.target))}</span></span></div></div>
     <div class="row" style="justify-content:space-between"><span class="muted small">${esc(T('tripsDone')(u.trips))}</span>${self ? '' : `<button class="btn sm" data-act="profile" data-u="${esc(u.id)}">${esc(T('message'))}</button>`}</div></article>`;
  }).join('')}</div>` : `<div class="panel empty" style="margin-top:14px">${esc(T('noOne'))}</div>`);
}
/* ---------- my profile page ---------- */
function profileView() {
  const m = me(); if (!m) return `<section><div class="panel empty">${esc(T('needLogin'))}</div></section>`;
  const seg = ([v, label]) => `<button data-act="theme" data-v="${v}" aria-pressed="${S.theme === v}">${esc(label)}</button>`;
  const h = S.hist, f = S.histF || 'all';
  const chip = (v, k) => `<button class="chip" data-act="histfilter" data-v="${v}" aria-pressed="${f === v}">${esc(T(k))}</button>`;
  const catches = new Set((S.data.catches || []).map((c) => c.id));
  const rows = !h ? `<div class="panel empty">${esc(T('loading'))}</div>` : (h.items.filter((x) => f === 'all' || (f === 'trips' ? x.k === 'post' : x.k === 'catch')).map((x) => {
    const when = esc(timeStr(x.at));
    if (x.k === 'catch') {
      const open = catches.has(x.id);
      const pic = x.photo ? `<img src="${esc(x.photo)}" alt="" loading="lazy">` : '🎣';
      return `<article class="panel hist"><${open ? `button class="histpic" data-act="opencatch" data-c="${esc(x.id)}" aria-label="${esc(fName(x.fish))}"` : 'span class="histpic"'}>${pic}</${open ? 'button' : 'span'}>
        <div class="grow"><div class="row" style="justify-content:space-between;gap:8px"><b>${esc(fName(x.fish))}${x.size ? ` · <span class="num">${x.size} cm</span>` : ''}</b><span class="muted small num">${when}</span></div>
        <div class="small muted">${esc(locName(x.loc))} · ${esc(dateStr(parseD(x.date)))}</div>${x.cap ? `<div class="small">${esc(x.cap)}</div>` : ''}
        <div class="small muted">♥ ${x.likes} · 💬 ${x.comments}</div></div></article>`;
    }
    const tr = { car: 'optCar', ride: 'optRide', transit: 'optTransit' }[x.transport];
    return `<article class="panel hist"><span class="histpic">🚗</span><div class="grow"><div class="row" style="justify-content:space-between;gap:8px"><b>${esc(postSpot(x))} · ${esc(dateStr(parseD(x.date)))} ${esc(x.time)}</b><span class="muted small num">${when}</span></div>
      <div class="small"><span class="pill">${esc(T(x.role === 'host' ? 'roleHost' : 'roleJoined'))}</span> <span class="pill">${esc(fName(x.fish))}</span> <span class="pill">${esc(T(tr))}</span> <span class="muted">${esc(T('goingCount')(x.members))}</span></div>
      ${x.note ? `<div class="small muted">${esc(x.note)}</div>` : ''}</div></article>`;
  }).join('') || `<div class="panel empty">${esc(T('histEmpty'))}</div>`);
  return `<section class="mypage">
   <div class="panel myhead"><div class="row" style="flex-wrap:nowrap;gap:16px">${av(m, 'xl')}<div style="min-width:0"><h2>${esc(m.nick)}${m.admin ? ` <span class="pill">${esc(T('adminTag'))}</span>` : ''}</h2>
     <div class="muted small">${m.name ? esc(m.name) + ' · ' : ''}${esc(sName(m.spot))}</div>${m.bio ? `<p class="small" style="margin:6px 0 0">${esc(m.bio)}</p>` : ''}</div></div>
    <div class="row" style="gap:8px"><label class="btn sm primary" for="av-file" tabindex="0">${esc(T('changePic'))}</label><input type="file" id="av-file" accept="image/*" hidden>${m.avatar ? `<button class="btn sm" data-act="delavatar">${esc(T('removePic'))}</button>` : ''}<button class="btn sm" data-act="account">${esc(T('editProfile'))}</button></div></div>
   <div class="panel"><b class="small muted">${esc(T('appearance'))}</b><div class="seg" role="group" aria-label="${esc(T('themeLbl'))}" style="margin-top:8px;margin-left:0">${[['auto', T('theme_auto')], ['light', T('theme_light')], ['dark', T('theme_dark')]].map(seg).join('')}</div></div>
   <div class="row" style="justify-content:space-between;gap:8px"><h3>${esc(T('yourActivity'))}</h3><div class="chips">${chip('all', 'hist_all')}${chip('trips', 'hist_trips')}${chip('catches', 'hist_catches')}</div></div>
   <div class="histlist">${rows}</div></section>`;
}
function loadHistory() { api('GET', '/api/me/history').then((r) => { S.hist = r; render(); }).catch(() => { S.hist = { items: [] }; render(); }); }
function cropSquare(file, size) {
  return new Promise((res) => {
    const fr = new FileReader();
    fr.onload = () => {
      const img = new Image();
      img.onload = () => {
        const side = Math.min(img.width, img.height), c = document.createElement('canvas');
        c.width = c.height = size;
        c.getContext('2d').drawImage(img, (img.width - side) / 2, (img.height - side) / 2, side, side, 0, 0, size, size);
        res(c.toDataURL('image/jpeg', 0.85));
      };
      img.onerror = () => res(null); img.src = fr.result;
    };
    fr.onerror = () => res(null); fr.readAsDataURL(file);
  });
}
function anglersView() {
  const inc = friends().incoming;
  const req = me() && inc.length ? `<div class="panel reqbox"><b>${esc(T('friendReqs'))} (${inc.length})</b>${inc.map((id) => { const u = userOf(id); return `<div class="row" style="justify-content:space-between">${`<span class="row" style="gap:8px">${av(u)}${profLink(u)}</span>`}<span class="row" style="gap:6px"><button class="btn sm primary" data-act="friendaccept" data-u="${esc(id)}">${esc(T('accept'))}</button><button class="btn sm" data-act="friendremove" data-u="${esc(id)}">${esc(T('decline'))}</button></span></div>`; }).join('')}</div>` : '';
  return `<section>${req}<div class="filters"><input type="text" id="q" value="${esc(S.q)}" placeholder="${esc(T('searchPh'))}" aria-label="${esc(T('searchPh'))}" autocomplete="off">
   <select id="fs" aria-label="${esc(T('styleLbl'))}">${styleOpts(S.fs, T('anyStyle'))}</select><select id="ft" aria-label="${esc(T('primary'))}">${fishOpts(S.ft, false, T('anyTarget'))}</select></div>
   <div style="margin-top:10px">${scopeChips('ascope', S.aScope)}</div><div id="results" style="margin-top:12px">${anglerList()}</div></section>`;
}

/* ---------- groups ---------- */
function groupCard(g) {
  const r = (S.data.rooms || {})['group-' + g.id], last = r && r.messages.filter((m) => !m.sys).slice(-1)[0];
  const n = unreadIn('group-' + g.id);
  return `<article class="panel gcard"><div class="row" style="justify-content:space-between;align-items:flex-start"><h3>${esc(g.name)}</h3><span class="pill">${esc(T('memberCount')(g.members.length))}</span></div>${g.desc ? `<p class="muted">${esc(g.desc)}</p>` : ''}
   <div class="stack">${g.members.slice(0, 6).map((id) => av(userOf(id))).join('')}</div>
   <p class="small muted">${last ? esc((last.u === myId() ? T('you') : userOf(last.u).nick) + ': ' + last.x) : esc(T('noMsgYet'))}</p>
   <div><button class="btn primary sm" data-act="opengroup" data-g="${g.id}">${esc(T('openChatBtn'))}${n ? `<span class="dot">${n}</span>` : ''}</button></div></article>`;
}
function groupDetail(g) {
  const owner = g.owner === myId();
  const addable = (S.data.users || []).filter((u) => g.members.indexOf(u.id) < 0);
  const mem = g.members.map((id) => { const u = userOf(id); return `<div class="mrow"><span>${av(u)}${profLink(u)}${id === g.owner ? ` <span class="pill">${esc(T('ownerTag'))}</span>` : ''}</span>${owner && id !== myId() ? `<button class="btn sm" data-act="rmmember" data-g="${g.id}" data-u="${esc(id)}">${esc(T('removeBtn'))}</button>` : ''}</div>`; }).join('');
  const add = owner ? `<div class="add"><b class="small">${esc(T('addMember'))}</b>${addable.length ? `<select id="gm-add" aria-label="${esc(T('addMember'))}">${addable.map((u) => `<option value="${esc(u.id)}">${esc(u.nick)}</option>`).join('')}</select><button class="btn sm" data-act="addmember" data-g="${g.id}">${esc(T('addBtn'))}</button>` : `<span class="muted small">${esc(T('nobodyToAdd'))}</span>`}</div>` : '';
  return `<section><div class="boardbar"><div class="row"><button class="btn sm" data-act="groupback">‹ ${esc(T('backGroups'))}</button><h2 style="font-size:22px">${esc(g.name)}</h2></div><span class="pill">${esc(T('privateNote'))}</span></div>${g.desc ? `<p class="muted" style="margin-bottom:14px">${esc(g.desc)}</p>` : ''}
   <div class="gdetail">${threadHtml('group-' + g.id)}<div class="panel members"><h3 style="font-size:15px">${esc(T('membersLbl'))} (${g.members.length})</h3>${mem}${add}<button class="btn sm warn" data-act="leavegroup" data-g="${g.id}">${esc(T('leaveGroup'))}</button></div></div></section>`;
}
function groupsView() {
  if (!me()) return loginPrompt(T('groupsLogin'));
  const mine = S.data.groups || [];
  if (S.group) { const g = mine.find((x) => x.id === S.group); if (g) return groupDetail(g); S.group = null; }
  return `<section><div class="boardbar"><p class="muted small">${esc(T('groupsLead'))}</p><button class="btn primary" data-act="newgroup">+ ${esc(T('newGroup'))}</button></div>
   ${mine.length ? `<div class="groups">${mine.map(groupCard).join('')}</div>` : `<div class="panel empty"><span>${esc(T('noGroups'))}</span><button class="btn primary" data-act="newgroup">+ ${esc(T('newGroup'))}</button></div>`}</section>`;
}

/* ---------- admin dashboard ---------- */
const FB_STATUS = ['new', 'in_progress', 'done', 'wontfix'];
function spotRows() {
  const a = S.admin, q = S.spotQ.trim().toLowerCase();
  return a.spots.filter((s) => (S.spotPref === 'all' || s.pref === S.spotPref) && (!q || (s.en + ' ' + s.ja + ' ' + s.id).toLowerCase().indexOf(q) > -1));
}
function spotTable() {
  const allRows = spotRows(), rows = allRows.slice(0, 150);
  if (!rows.length) return `<div class="panel empty">${esc(T('noSpotsFound'))}</div>`;
  return `<div class="panel tablewrap"><table class="tbl"><thead><tr><th>${esc(T('spotName'))}</th><th>${esc(T('typeLbl'))}</th><th>${esc(T('prefLbl'))}</th><th>${esc(T('usedBy'))}</th><th></th></tr></thead><tbody>${rows.map((s) =>
    `<tr class="${s.active ? '' : 'off'}"><td><b>${esc(s.en)}</b><br><span class="muted small">${esc(s.ja)} · ${esc(s.id)}${s.builtin ? '' : ' · ' + esc(T('customTag'))}</span></td><td>${esc(T('type_' + s.type))}</td><td>${esc(prefName(s.pref))}</td><td class="num">${s.used}</td>
    <td class="rowbtns"><button class="btn sm" data-act="editspot" data-id="${esc(s.id)}">${esc(T('edit'))}</button><button class="btn sm${s.active ? ' warn' : ''}" data-act="togglespot" data-id="${esc(s.id)}">${esc(s.active ? T('hide') : T('show'))}</button></td></tr>`).join('')}</tbody></table></div>${allRows.length > rows.length ? `<p class="small muted" style="margin-top:8px">${esc(T('showingFirst')(rows.length, allRows.length))}</p>` : ''}`;
}
function feedbackList() {
  const a = S.admin, list = a.feedback.filter((f) => S.fbFilter === 'all' || f.status === S.fbFilter);
  const cnt = (s) => a.feedback.filter((f) => s === 'all' || f.status === s).length;
  const chips = ['all'].concat(FB_STATUS).map((s) => `<button class="chip" data-act="fbfilter" data-v="${s}" aria-pressed="${S.fbFilter === s}">${esc(s === 'all' ? T('fAll') : T('fbs_' + s))}<i class="num">${cnt(s)}</i></button>`).join('');
  return `<div class="chips" style="margin-bottom:12px">${chips}</div>` + (list.length ? list.map((f) => {
    const u = f.uid ? userOf(f.uid) : null;
    return `<article class="panel fbcard"><div class="row" style="justify-content:space-between"><span class="row" style="gap:8px"><span class="pill ${f.kind === 'bug' ? 'ride' : 'car'}">${esc(T('fbk_' + f.kind))}</span><span class="muted small">${u ? profLink(u) : esc(f.nick || T('deletedUser'))} · ${esc(timeStr(f.created_at))}${f.page ? ' · ' + esc(f.page) : ''} · ${esc(f.lang.toUpperCase())}</span></span>
     <select class="fbstatus" data-id="${esc(f.id)}" aria-label="${esc(T('statusLbl'))}">${FB_STATUS.map((s) => `<option value="${s}"${s === f.status ? ' selected' : ''}>${esc(T('fbs_' + s))}</option>`).join('')}</select></div>
     <p class="fbtext">${esc(f.text)}</p>
     <form class="fbreply" data-form="fbreply" data-id="${esc(f.id)}"><textarea id="note-${esc(f.id)}" maxlength="1000" placeholder="${esc(T('replyPh'))}" aria-label="${esc(T('replyPh'))}">${esc(f.note)}</textarea>
     <div class="row"><button class="btn sm primary" type="submit">${esc(T('saveReply'))}</button><button class="btn sm warn" type="button" data-act="delfb" data-id="${esc(f.id)}">${esc(T('del'))}</button></div></form></article>`;
  }).join('') : `<div class="panel empty">${esc(T('noFeedback'))}</div>`);
}
function adminView() {
  if (!isAdmin()) return `<div class="panel empty">${esc(T('err_forbidden'))}</div>`;
  const a = S.admin;
  if (!a) return `<div class="panel empty">${esc(T('loading'))}</div>`;
  const sub = ['overview', 'reports', 'newspots', 'spots', 'feedback', 'admins', 'activity'];
  const nav = `<div class="chips" style="margin-bottom:16px">${sub.map((k) => `<button class="chip" data-act="admintab" data-v="${k}" aria-pressed="${S.adminTab === k}">${esc(T('adm_' + k))}${k === 'feedback' && a.counts.feedbackNew ? `<i class="num">${a.counts.feedbackNew}</i>` : ''}${k === 'reports' && a.counts.reportsOpen ? `<i class="num">${a.counts.reportsOpen}</i>` : ''}${k === 'newspots' && a.counts.candidatesReady ? `<i class="num">${a.counts.candidatesReady}</i>` : ''}</button>`).join('')}</div>`;
  let body = '';
  if (S.adminTab === 'overview') {
    const c = a.counts, tile = (k, v) => `<div class="stat panel"><small>${esc(T(k))}</small><b class="num">${v}</b></div>`;
    body = `<div class="stats">${tile('st_users', c.users)}${tile('st_new7', c.newUsers7d)}${tile('st_posts', c.posts)}${tile('st_catches', c.catches)}${tile('st_groups', c.groups)}${tile('st_msgs', c.messages)}${tile('st_spots', c.spots)}${tile('st_newspots', c.candidatesReady)}${tile('st_reports', c.reportsOpen)}${tile('st_fbnew', c.feedbackNew)}</div>
     <div class="panel pad"><b>${esc(T('adm_what'))}</b><p class="muted">${esc(T('adm_whatBody'))}</p><div class="row"><button class="btn primary" data-act="admintab" data-v="spots">${esc(T('adm_spots'))}</button><button class="btn" data-act="admintab" data-v="feedback">${esc(T('adm_feedback'))}</button></div></div>`;
  } else if (S.adminTab === 'spots') {
    const pref = `<option value="all">${esc(T('allPrefs'))}</option>` + D.PREFS.map((p) => `<option value="${p.id}"${S.spotPref === p.id ? ' selected' : ''}>${esc(p[S.lang])}</option>`).join('');
    body = `<div class="boardbar"><div class="filters"><input type="text" id="aspq" value="${esc(S.spotQ)}" placeholder="${esc(T('searchSpots'))}" aria-label="${esc(T('searchSpots'))}" autocomplete="off"><select id="aspp" aria-label="${esc(T('prefLbl'))}">${pref}</select><span></span></div><span class="row" style="gap:8px">${me() && me().owner ? `<button class="btn" data-act="importosm">${esc(T('importOsm'))}</button>` : ''}<button class="btn primary" data-act="addspot">+ ${esc(T('addSpot'))}</button></span></div><p class="muted small" style="margin-bottom:10px">${esc(T('spotsNote'))} ${esc(T('importNote'))}</p><div id="aspots">${spotTable()}</div>`;
  } else if (S.adminTab === 'reports') body = reportsList();
  else if (S.adminTab === 'newspots') body = candidatesList();
  else if (S.adminTab === 'feedback') body = feedbackList();
  else if (S.adminTab === 'admins') {
    const owner = !!me().owner;
    body = `<div class="panel pad"><b>${esc(T('whitelistTitle'))}</b><p class="muted">${esc(T('whitelistBody'))}</p>
     ${a.admins.map((u) => `<div class="mrow"><span>${av(u)}<b>${esc(u.nick)}</b> <span class="pill ${u.role === 'owner' ? 'good' : ''}">${esc(T('role_' + u.role))}</span></span>${owner && u.role === 'admin' ? `<button class="btn sm warn" data-act="rmadmin" data-id="${esc(u.id)}">${esc(T('removeBtn'))}</button>` : ''}</div>`).join('')}
     ${owner ? `<form class="row" data-form="adminadd" style="margin-top:12px"><input type="text" id="adm-nick" maxlength="24" required placeholder="${esc(T('adminNickPh'))}" aria-label="${esc(T('adminNickPh'))}" style="flex:1;min-width:180px"><button class="btn primary" type="submit">${esc(T('addAdmin'))}</button></form><p class="muted small">${esc(T('adminAddNote'))}</p>` : `<p class="muted small">${esc(T('ownerOnly'))}</p>`}</div>`;
  } else {
    body = a.audit.length ? `<div class="panel tablewrap"><table class="tbl"><thead><tr><th>${esc(T('whenLbl'))}</th><th>${esc(T('actorLbl'))}</th><th>${esc(T('actionLbl'))}</th><th>${esc(T('detailLbl'))}</th></tr></thead><tbody>${a.audit.map((r) => `<tr><td class="num">${esc(timeStr(r.created_at))}</td><td>${esc(r.actor_nick)}</td><td>${esc(r.action)}</td><td class="muted">${esc(r.target)}${r.detail ? ' · ' + esc(r.detail) : ''}</td></tr>`).join('')}</tbody></table></div>` : `<div class="panel empty">${esc(T('noActivity'))}</div>`;
  }
  return `<section><h2 class="admh">${esc(T('admin'))}</h2>${nav}${body}</section>`;
}

/* ---------- password rules (same as the server) ---------- */
const pwChecks = (pw) => ({ len: pw.length >= 8, up: /[A-Z]/.test(pw), low: /[a-z]/.test(pw), num: /[0-9]/.test(pw), spec: /[^A-Za-z0-9\s]/.test(pw) });
const pwOk = (c) => c.len && c.up && c.low && c.num && c.spec;
function pwListHtml(pw, pw2) {
  const c = pwChecks(pw), li = (ok, t) => `<li class="${ok ? 'ok' : ''}"><span aria-hidden="true">${ok ? '✓' : '○'}</span> ${esc(t)}</li>`;
  let h = li(c.len, T('r8')) + li(c.up, T('rUp')) + li(c.low, T('rLow')) + li(c.num, T('rNum')) + li(c.spec, T('rSpec'));
  if (pw2.length) h += li(pw === pw2, pw === pw2 ? T('pwMatch') : T('pwMismatch'));
  return h;
}
function pwRefresh(p1, p2, list, btn, optional) {
  const a = $('#' + p1), b = $('#' + p2); if (!a || !b) return;
  const l = $('#' + list); if (l) l.innerHTML = pwListHtml(a.value, b.value);
  const s = $('#' + btn);
  if (s) s.disabled = optional && !a.value ? false : !(pwOk(pwChecks(a.value)) && a.value === b.value);
}
const pwField = (id, label, auto) => `<label class="f">${esc(label)}<input type="password" id="${id}" autocomplete="${auto}" maxlength="64"></label>`;

/* ---------- sheets ---------- */
const sheetWrap = (inner) => `<div class="scrim" data-act="scrim"><div class="sheet" role="dialog" aria-modal="true">${inner}</div></div>`;
const btnRow = (cancelAct, okLabel, okId) => `<div class="row" style="justify-content:flex-end"><button class="btn" type="button" data-act="${cancelAct}">${esc(T('cancel'))}</button><button class="btn primary" type="submit"${okId ? ` id="${okId}"` : ''}>${esc(okLabel)}</button></div>`;
function openAuth(mode, why) { S.sheet = { k: 'auth', mode, why: why || '' }; render(); }
function authSheet() {
  const reg = S.sheet.mode === 'register';
  const head = `<h2>${esc(reg ? T('createAccount') : T('logIn'))}</h2>${S.sheet.why ? `<p class="muted small">${esc(S.sheet.why)}</p>` : ''}`;
  const sw = `<p class="small muted">${esc(reg ? T('haveAccount') : T('noAccount'))} <button class="linkbtn" type="button" data-act="authmode" data-v="${reg ? 'login' : 'register'}">${esc(reg ? T('logIn') : T('signUp'))}</button></p>`;
  if (!reg) return sheetWrap(`${head}<form data-form="login" style="display:grid;gap:12px"><label class="f">${esc(T('nick'))}<input type="text" id="l-nick" required maxlength="24" autocomplete="username"></label>${pwField('l-pw', T('pwLbl'), 'current-password')}<label class="check"><input type="checkbox" id="l-keep"${S.keep === false ? '' : ' checked'}> ${esc(T('keepLogged'))}</label><p class="err" id="auth-err" role="alert"></p>${btnRow('closesheet', T('logIn'))}</form>${sw}`);
  return sheetWrap(`${head}<p class="muted small">${esc(T('regNote'))}</p><form data-form="register" style="display:grid;gap:12px" autocomplete="off"><label class="f">${esc(T('nick'))}<input type="text" id="r-nick" required minlength="2" maxlength="24" autocomplete="username"><span class="hint">${esc(T('nickRule'))}</span></label>
   ${pwField('r-pw', T('pwLbl'), 'new-password')}${pwField('r-pw2', T('pwConfirm'), 'new-password')}<div class="small muted">${esc(T('pwRules'))}</div><ul class="pwl" id="pw-list" aria-live="polite">${pwListHtml('', '')}</ul>
   <div class="two"><label class="f">${esc(T('name'))}<input type="text" id="r-name" maxlength="40"></label><label class="f">${esc(T('email'))}<input type="email" id="r-email" maxlength="80" autocomplete="email"></label></div>
   <p class="small muted" id="email-note">${esc(T('emailNote'))}</p>
   <label class="f">${esc(T('homespot'))}<select id="r-spot">${spotOpts(homeSpotId())}</select></label><p class="err" id="auth-err" role="alert"></p>${btnRow('closesheet', T('createBtn'), 'r-submit').replace('id="r-submit"', 'id="r-submit" disabled')}</form>${sw}`);
}
function accountSheet() {
  const m = me(), u = userOf(m.id);
  return sheetWrap(`<h2>${esc(T('account'))}</h2><form data-form="account" style="display:grid;gap:12px"><label class="f">${esc(T('nick'))}<input type="text" id="a-nick" required minlength="2" maxlength="24" value="${esc(m.nick)}"></label>
   <div class="two"><label class="f">${esc(T('name'))}<input type="text" id="a-name" maxlength="40" value="${esc(m.name)}"></label><label class="f">${esc(T('email'))}<input type="email" id="a-email" maxlength="80" value="${esc(m.email)}"></label></div><p class="small muted">${esc(T('emailNote'))}</p>
   <label class="f">${esc(T('homespot'))}<select id="a-spot">${spotOpts(m.spot)}</select></label>
   <div class="two"><label class="f">${esc(T('styleLbl'))}<select id="a-style">${styleOpts(m.style)}</select></label><label class="f">${esc(T('primary'))}<select id="a-target">${fishOpts(m.target, false)}</select></label></div>
   <label class="f">${esc(T('aboutYou'))}<textarea id="a-bio" maxlength="200">${esc(m.bio)}</textarea></label>${btnRow('closesheet', T('save'))}</form>
   <details class="sec"><summary><b>${esc(T('pwChange'))}</b></summary><form data-form="pw" style="display:grid;gap:10px;margin-top:10px" autocomplete="off">${pwField('c-pw', T('pwCurrent'), 'current-password')}${pwField('n-pw', T('pwNew'), 'new-password')}${pwField('n-pw2', T('pwConfirm'), 'new-password')}<ul class="pwl" id="pw-list2" aria-live="polite">${pwListHtml('', '')}</ul><div><button class="btn primary" type="submit" id="n-submit" disabled>${esc(T('pwSave'))}</button></div></form></details>
   ${S.data.setup && S.data.setup.claimable ? `<div class="sec"><b>${esc(T('claimTitle'))}</b><form data-form="claim" style="display:grid;gap:10px"><p class="muted small">${esc(T('claimBody'))}</p><input type="password" id="claim-code" autocomplete="off" aria-label="${esc(T('claimTitle'))}" required><div><button class="btn primary" type="submit">${esc(T('claimBtn'))}</button></div></form></div>` : ''}
   <div class="sec row" style="justify-content:space-between"><button class="btn" type="button" data-act="logout">${esc(T('logOut'))}</button></div>
   <details class="sec"><summary class="muted">${esc(T('dangerZone'))}</summary><form data-form="delme" style="display:grid;gap:10px;margin-top:10px"><p class="muted small">${esc(m.owner ? T('ownerNoDelete') : T('deleteBody'))}</p>${m.owner ? '' : `${pwField('d-pw', T('pwCurrent'), 'current-password')}<div><button class="btn warn" type="submit">${esc(T('deleteAccount'))}</button></div>`}</form></details>`);
}
function friendButtons(u) {
  const f = friends();
  if (f.accepted.indexOf(u.id) > -1) return `<div class="row"><span class="pill good">${esc(T('friendsNow'))}</span><button class="btn sm" data-act="friendremove" data-u="${esc(u.id)}">${esc(T('unfriend'))}</button></div>`;
  if (f.outgoing.indexOf(u.id) > -1) return `<div class="row"><span class="pill">${esc(T('reqSent'))}</span><button class="btn sm" data-act="friendremove" data-u="${esc(u.id)}">${esc(T('cancelReq'))}</button></div>`;
  if (f.incoming.indexOf(u.id) > -1) return `<div class="row"><button class="btn sm primary" data-act="friendaccept" data-u="${esc(u.id)}">${esc(T('acceptFriend'))}</button><button class="btn sm" data-act="friendremove" data-u="${esc(u.id)}">${esc(T('decline'))}</button></div>`;
  return `<div><button class="btn sm primary" data-act="friendadd" data-u="${esc(u.id)}">+ ${esc(T('addFriend'))}</button></div>`;
}
function profileSheet() {
  const u = userOf(S.sheet.u); if (!u.id) return '';
  const self = u.id === myId(), nCatch = (S.data.catches || []).filter((c) => c.by === u.id).length;
  const langs = (u.langs || []).map((l) => `<span class="pill">${esc(T('langs')[l] || l)}</span>`).join(''), also = (u.fish || []).map((f) => `<span class="pill">${esc(fName(f))}</span>`).join('');
  const info = feedInfo(u.id, userPref(u));
  const head = `<div class="row" style="flex-wrap:nowrap">${av(u, 'lg')}<div style="min-width:0"><h2>${esc(u.nick)}${self ? ` <span class="pill">${esc(T('youTag'))}</span>` : ''}</h2><div class="muted small">${u.name ? esc(u.name) + ' · ' : ''}${esc(sName(u.spot))} · ${esc(prefName(userPref(u)))}</div></div></div><div class="tags">${feedBadges(info)}</div>`;
  const facts = `<div class="facts"><div><span class="k">${esc(T('styleLbl'))}</span><span><span class="pill">${esc(stName(u.style))}</span></span></div><div><span class="k">${esc(T('primary'))}</span><span><span class="pill car">${esc(fName(u.target))}</span></span></div>
   ${also ? `<div><span class="k">${esc(T('alsoFor'))}</span><span class="tags">${also}</span></div>` : ''}${langs ? `<div><span class="k">${esc(T('speaks'))}</span><span class="tags">${langs}</span></div>` : ''}<div><span class="k">${esc(T('tripsLbl'))}</span><span class="num">${u.trips} · ${esc(T('catchCount')(nCatch))}</span></div></div>${u.bio ? `<div class="sec"><b class="small muted">${esc(T('aboutLbl'))}</b><p>${esc(u.bio)}</p></div>` : ''}`;
  if (self) return sheetWrap(head + facts + `<div class="row" style="justify-content:flex-end"><button class="btn" data-act="closesheet">${esc(T('close'))}</button><button class="btn primary" data-act="account">${esc(T('editProfile'))}</button></div>`);
  const today = todayStr(), mine = (S.data.posts || []).filter((p) => p.host === myId() && p.date >= today);
  const inv = mine.length ? `<form class="sec" data-form="invite" data-u="${esc(u.id)}"><b class="small muted">${esc(T('inviteTrip'))}</b><select id="inv-post" aria-label="${esc(T('pickTrip'))}">${mine.map((p) => `<option value="${p.id}">${esc(postSpot(p) + ' · ' + dateStr(parseD(p.date)) + ' ' + p.time)}</option>`).join('')}</select><div><button class="btn" type="submit">${esc(T('sendInvite'))}</button></div></form>` : `<div class="sec"><b class="small muted">${esc(T('inviteTrip'))}</b><span class="muted small">${esc(T('noTrips'))}</span></div>`;
  return sheetWrap(head + facts + `<div class="sec">${me() ? friendButtons(u) : `<span class="muted small">${esc(T('needLogin'))}</span>`}</div>` +
    `<form class="sec" data-form="pm" data-u="${esc(u.id)}"><b class="small muted">${esc(T('sendMsg'))}</b><textarea id="pm-msg" maxlength="1000" required placeholder="${esc(T('msgPh'))}" aria-label="${esc(T('msgPh'))}"></textarea><div><button class="btn primary" type="submit">${esc(T('send'))}</button></div></form>` + (me() ? inv : '') +
    `<div class="row" style="justify-content:flex-end"><button class="btn" data-act="closesheet">${esc(T('close'))}</button></div>`);
}
function postSheet() {
  const d = new Date(); d.setDate(d.getDate() + 3);
  return sheetWrap(`<h2>${esc(T('postTitle'))}</h2><form data-form="post" style="display:grid;gap:12px">
   <div class="two"><label class="f">${esc(T('date'))}<input type="date" id="p-date" required min="${todayStr()}" value="${ymd(d)}"></label><label class="f">${esc(T('time'))}<input type="time" id="p-time" required value="05:30"></label></div>
   <div class="two"><label class="f">${esc(T('spotLbl'))}<select id="p-spot">${spotOpts(homeSpotId(), { custom: true })}</select></label><label class="f">${esc(T('targetLbl'))}<select id="p-fish">${fishOpts('any', false)}</select></label></div>
   <label class="f" id="p-customwrap" hidden>${esc(T('customName'))}<input type="text" id="p-custom" maxlength="40"></label>
   <label class="f">${esc(T('meetLbl'))}<input type="text" id="p-meet" required maxlength="80"></label>
   <div class="opts" role="radiogroup" aria-label="${esc(T('howGet'))}"><div class="small muted"><b>${esc(T('howGet'))}</b></div>
   <label><input type="radio" name="p-tr" value="car" checked> ${esc(T('optCar'))}</label><label><input type="radio" name="p-tr" value="ride"> ${esc(T('optRide'))}</label><label><input type="radio" name="p-tr" value="transit"> ${esc(T('optTransit'))}</label></div>
   <label class="f" id="p-seatwrap">${esc(T('seatsOffer'))}<input type="number" id="p-seats" min="0" max="7" value="2"></label>
   <label class="f">${esc(T('noteLbl'))}<textarea id="p-note" maxlength="240"></textarea></label>${btnRow('closesheet', T('publish'))}</form>`);
}
function catchSheet() {
  return sheetWrap(`<h2>${esc(T('shareCatch'))}</h2><form data-form="catch" style="display:grid;gap:12px">
   <label class="f">${esc(T('photoLbl'))}<input type="file" id="c-file" accept="image/*"><span class="hint">${esc(T('photoHint'))}</span></label><img class="prev" id="c-prev" alt="" hidden><p class="small muted" id="c-gps"${S.gps ? '' : ' hidden'}>📍 ${esc(T('gpsNote'))}</p>
   <div class="two"><label class="f">${esc(T('species'))}<select id="c-fish">${fishOpts('seabass', true)}</select></label><label class="f">${esc(T('size'))}<input type="number" id="c-size" min="1" max="300"></label></div>
   <div class="two"><label class="f">${esc(T('caught'))}<input type="date" id="c-date" required max="${todayStr()}" value="${todayStr()}"></label><label class="f">${esc(T('locLbl'))}<select id="c-loc">${spotOpts(homeSpotId(), { custom: true, area: true })}</select></label></div>
   <label class="f" id="c-customwrap" hidden>${esc(T('customName'))}<input type="text" id="c-custom" maxlength="40"></label><p class="small muted">${esc(T('locNote'))}</p>
   <label class="f">${esc(T('caption'))}<textarea id="c-cap" maxlength="240"></textarea></label>
   <div class="sec"><b class="small muted">${esc(T('tackleLbl'))}</b><div class="two"><label class="f">${esc(T('rod'))}<input type="text" id="c-rod" maxlength="60"></label><label class="f">${esc(T('reel'))}<input type="text" id="c-reel" maxlength="60"></label></div>
   <div class="two"><label class="f">${esc(T('lineLbl'))}<input type="text" id="c-line" maxlength="60"></label><label class="f">${esc(T('lureLbl'))}<input type="text" id="c-lure" maxlength="60"></label></div><label class="check"><input type="checkbox" id="c-pub"> ${esc(T('shareTackle'))}</label></div>${btnRow('closesheet', T('postCatch'))}</form>`);
}
function groupSheet() {
  const f = friends().accepted, users = (S.data.users || []).filter((u) => u.id !== myId()).sort((a, b) => (f.indexOf(b.id) > -1) - (f.indexOf(a.id) > -1) || a.nick.localeCompare(b.nick));
  return sheetWrap(`<h2>${esc(T('newGroup'))}</h2><form data-form="group" style="display:grid;gap:12px"><label class="f">${esc(T('groupName'))}<input type="text" id="g-name" required maxlength="40"></label>
   <label class="f">${esc(T('groupDesc'))}<textarea id="g-desc" maxlength="160"></textarea></label><div class="opts scrollopts"><div class="small muted"><b>${esc(T('pickMembers'))}</b></div>${users.map((u) => `<label><input type="checkbox" name="g-mem" value="${esc(u.id)}"> ${av(u)} ${esc(u.nick)}${f.indexOf(u.id) > -1 ? ` <span class="pill good">${esc(T('badgeFriend'))}</span>` : ''}</label>`).join('')}</div>
   <p class="small muted">${esc(T('privateNote'))}</p>${btnRow('closesheet', T('createGroup'))}</form>`);
}
function joinSheet() {
  const p = (S.data.posts || []).find((x) => x.id === S.sheet.p); if (!p) return '';
  const car = p.transport === 'car', ride = p.transport === 'ride';
  return sheetWrap(`<h2>${esc(T('requestJoin'))}</h2><p class="muted small">${esc(postSpot(p))} · ${esc(dateStr(parseD(p.date), true))} ${esc(p.time)}</p><form data-form="join" data-p="${p.id}" style="display:grid;gap:12px">
   ${car ? `<label class="check"><input type="checkbox" id="j-ride"${p.seatsFree > 0 ? '' : ' disabled'}> ${esc(p.seatsFree > 0 ? T('needRideChk') : T('full'))}</label>` : ''}${ride ? `<label class="check"><input type="checkbox" id="j-drive"> ${esc(T('canDrive'))}</label>` : ''}
   <label class="f">${esc(T('msgOpt'))}<textarea id="j-msg" maxlength="200"></textarea></label>${btnRow('closesheet', T('sendReq'))}</form>`);
}
function spotSheet() {
  const s = S.sheet.id ? S.admin.spots.find((x) => x.id === S.sheet.id) : null;
  const pref = D.PREFS.map((p) => `<option value="${p.id}"${s && s.pref === p.id ? ' selected' : ''}>${esc(p[S.lang])}</option>`).join('');
  const type = ['s', 'b', 'f'].map((t) => `<option value="${t}"${s && s.type === t ? ' selected' : ''}>${esc(T('type_' + t))}</option>`).join('');
  return sheetWrap(`<h2>${esc(s ? T('editSpot') : T('addSpot'))}</h2><form data-form="spot" data-id="${s ? esc(s.id) : ''}" style="display:grid;gap:12px">
   <div class="two"><label class="f">${esc(T('nameEn'))}<input type="text" id="s-en" required minlength="2" maxlength="60" value="${s ? esc(s.en) : ''}"></label><label class="f">${esc(T('nameJa'))}<input type="text" id="s-ja" required maxlength="60" value="${s ? esc(s.ja) : ''}"></label></div>
   <div class="two"><label class="f">${esc(T('prefLbl'))}<select id="s-pref">${pref}</select></label><label class="f">${esc(T('typeLbl'))}<select id="s-type">${type}</select></label></div>
   ${s ? `<p class="muted small">ID: ${esc(s.id)}</p>` : `<label class="f">${esc(T('spotId'))}<input type="text" id="s-id" maxlength="40" pattern="[a-z0-9][a-z0-9\\-]{1,39}"><span class="hint">${esc(T('spotIdHint'))}</span></label>`}
   <div class="two"><label class="f">${esc(T('latLbl'))}<input type="number" id="s-lat" required step="0.0001" min="20" max="46" value="${s && s.lat != null ? s.lat : ''}"></label><label class="f">${esc(T('lngLbl'))}<input type="number" id="s-lng" required step="0.0001" min="122" max="154" value="${s && s.lng != null ? s.lng : ''}"></label></div>
   <p class="small muted">${esc(T('spotTideNote'))}</p><p class="err" id="spot-err" role="alert"></p>${btnRow('closesheet', T('save'))}</form>`);
}
const reportBtn = (t, id) => `<button class="linkbtn small muted" data-act="report" data-t="${t}" data-id="${esc(id)}">⚑ ${esc(T('report'))}</button>`;
function reportSheet() {
  const reasons = ['spam', 'not_fishing', 'other'].map((r, i) => `<label><input type="radio" name="rr" value="${r}"${i === 0 ? ' checked' : ''}> ${esc(T('rs_' + r))}</label>`).join('');
  return sheetWrap(`<h2>${esc(T('reportTitle'))}</h2><form data-form="report" data-t="${esc(S.sheet.t)}" data-id="${esc(S.sheet.id)}" style="display:grid;gap:12px">
   <p class="muted small">${esc(T('reportWhy'))}</p><div class="opts">${reasons}</div>
   <label class="f">${esc(T('reportNote'))}<textarea id="rp-note" maxlength="200"></textarea></label>
   <p class="err" id="rp-err" role="alert"></p>${btnRow('closesheet', T('reportSend'))}</form>`);
}
function candidatesList() {
  const list = S.admin.candidates || [];
  const prefOpts = (sel) => D.PREFS.map((p) => `<option value="${p.id}"${sel === p.id ? ' selected' : ''}>${esc(p[S.lang])}</option>`).join('');
  const cards = list.map((c) => `<article class="panel fbcard">
    <div class="row" style="gap:8px;justify-content:space-between"><span class="row" style="gap:8px"><span class="pill ride">${esc(T('ns_count')(c.n, c.anglers))}</span><span class="pill">${esc(T('ns_adminOnly'))}</span></span><span class="muted small num">${esc(timeStr(c.last))}</span></div>
    <div class="small muted">${c.near ? esc(T('ns_near')(c.near[S.lang], c.near.km)) + ' · ' : ''}<span class="num">${c.lat}, ${c.lng}</span> · <a href="https://www.google.com/maps?q=${c.lat},${c.lng}" target="_blank" rel="noopener">${esc(T('ns_openMap'))}</a></div>
    ${c.photos.length ? `<div class="thumbs">${c.photos.map((u) => `<span class="thumb"><img src="${esc(u)}" alt="" loading="lazy"></span>`).join('')}</div>` : ''}
    <div class="two"><label class="f">${esc(T('ns_nameEn'))}<input type="text" id="ns-en-${esc(c.id)}" maxlength="60"></label><label class="f">${esc(T('ns_nameJa'))}<input type="text" id="ns-ja-${esc(c.id)}" maxlength="60"></label></div>
    <div class="two"><label class="f">${esc(T('typeLbl'))}<select id="ns-type-${esc(c.id)}">${['s', 'b', 'f'].map((t) => `<option value="${t}"${c.type === t ? ' selected' : ''}>${esc(T('type_' + t))}</option>`).join('')}</select></label><label class="f">${esc(T('prefLbl'))}<select id="ns-pref-${esc(c.id)}">${prefOpts(c.pref)}</select></label></div>
    <p class="err" id="ns-err-${esc(c.id)}" role="alert"></p>
    <div class="row" style="justify-content:flex-end;gap:8px"><button class="btn sm warn" data-act="candact" data-id="${esc(c.id)}" data-a="reject">${esc(T('ns_reject'))}</button><button class="btn sm primary" data-act="candact" data-id="${esc(c.id)}" data-a="approve">${esc(T('ns_approve'))}</button></div></article>`).join('');
  return `<p class="muted small" style="margin-bottom:12px">${esc(T('ns_intro'))}</p>${cards || `<div class="panel empty">${esc(T('ns_none'))}</div>`}`;
}
function reportsList() {
  const a = S.admin, open = a.reports.filter((r) => r.status === 'open'), done = a.reports.filter((r) => r.status !== 'open');
  const list = S.repFilter === 'open' ? open : done;
  const chips = [['open', 'rp_open', open.length], ['handled', 'rp_handled', done.length]].map((c) => `<button class="chip" data-act="repfilter" data-v="${c[0]}" aria-pressed="${S.repFilter === c[0]}">${esc(T(c[1]))}<i class="num">${c[2]}</i></button>`).join('');
  const cards = list.map((r) => {
    const sn = r.snap || {};
    return `<article class="panel fbcard"><div class="row" style="gap:8px;justify-content:space-between"><span class="row" style="gap:8px"><span class="pill">${esc(T('rp_type_' + r.type))}</span><span class="pill ride">${esc(T('rs_' + r.reason))}</span>${r.status !== 'open' ? `<span class="pill good">${esc(T(r.status === 'removed' ? 'rp_removed' : 'rp_dismissed'))}</span>` : ''}</span><span class="muted small">${esc(timeStr(r.created_at))}</span></div>
     <div class="small muted">${esc(T('rp_by'))} <b>${esc(r.reporter || '?')}</b> · ${esc(T('rp_author'))} <b>${esc(sn.nick || '?')}</b></div>
     ${r.note ? `<p class="small"><i>“${esc(r.note)}”</i></p>` : ''}
     <div class="fbmine">${sn.photo && r.live ? `<img class="prev" alt="" loading="lazy" src="${esc(sn.photo)}">` : sn.photo ? `<span class="muted small">${esc(T('rp_gone'))}</span>` : ''}<p class="fbtext">${esc(sn.text || '')}</p></div>
     ${r.status === 'open' ? `<div class="row" style="justify-content:flex-end;gap:8px"><button class="btn sm" data-act="repact" data-id="${esc(r.id)}" data-a="dismiss">${esc(T('rp_dismiss'))}</button><button class="btn sm warn" data-act="repact" data-id="${esc(r.id)}" data-a="remove">${esc(T('rp_delete'))}</button></div>` : `<div class="muted small">${esc(r.handler || '')} · ${esc(r.handled_at ? timeStr(r.handled_at) : '')}</div>`}</article>`;
  }).join('');
  return `<div class="chips" style="margin-bottom:12px">${chips}</div>${cards || `<div class="panel empty">${esc(T('rp_none'))}</div>`}`;
}
const unreadCount = () => ((S.data && S.data.inbox) || []).filter((m) => !m.read_at).length;
function inboxSheet() {
  const list = (S.data.inbox || []);
  const fresh = S.inboxNew || [];
  const body = list.length ? list.map((m) => `<article class="fbmine"${fresh.indexOf(m.id) > -1 ? ' style="border:1px solid var(--accent)"' : ''}>
    <div class="row" style="gap:8px"><span class="pill car">${esc(T('fromAdmin'))}</span><span class="muted small">${esc(timeStr(m.created_at))}</span></div>
    <p class="fbtext">${esc(m.kind === 'moderation' ? T('modMsg')(m.body.split('|')[0], m.body.split('|')[1]) : m.body)}</p>
    ${m.ref_text ? `<p class="small muted">${esc(T(m.kind === 'moderation' ? 'aboutYourContent' : 'aboutYourFeedback'))}: ${esc(m.ref_text)}</p>` : ''}
    <div class="row" style="justify-content:flex-end"><button class="linkbtn small" data-act="delinbox" data-id="${m.id}">${esc(T('del'))}</button></div></article>`).join('') : `<p class="muted">${esc(T('inboxEmpty'))}</p>`;
  return sheetWrap(`<h2>${esc(T('inboxTitle'))}</h2>${body}<div class="row" style="justify-content:flex-end"><button class="btn" data-act="closesheet">${esc(T('close'))}</button></div>`);
}
function feedbackSheet() {
  const mineFb = (S.data.feedback || []);
  const past = mineFb.length ? `<div class="sec"><b class="small muted">${esc(T('myFeedback'))}</b>${mineFb.map((f) => `<div class="fbmine"><div class="row" style="gap:8px"><span class="pill">${esc(T('fbk_' + f.kind))}</span><span class="pill ${f.status === 'done' ? 'good' : ''}">${esc(T('fbs_' + f.status))}</span><span class="muted small">${esc(timeStr(f.created_at))}</span></div><p class="small">${esc(f.text)}</p>${f.note ? `<p class="small reply"><b>${esc(T('adminReply'))}:</b> ${esc(f.note)}</p>` : ''}</div>`).join('')}</div>` : '';
  return sheetWrap(`<h2>${esc(T('feedbackTitle'))}</h2><p class="muted small">${esc(T('feedbackLead'))}</p><form data-form="feedback" style="display:grid;gap:12px">
   <div class="opts" role="radiogroup" aria-label="${esc(T('kindLbl'))}">${['bug', 'idea', 'other'].map((k, i) => `<label><input type="radio" name="fb-kind" value="${k}"${i === 0 ? ' checked' : ''}> ${esc(T('fbk_' + k))}</label>`).join('')}</div>
   <label class="f">${esc(T('feedbackText'))}<textarea id="fb-text" required minlength="5" maxlength="2000" placeholder="${esc(T('feedbackPh'))}"></textarea></label><p class="small muted">${esc(T('feedbackCtx')(T(S.tab)))}</p><p class="err" id="fb-err" role="alert"></p>${btnRow('closesheet', T('sendFeedback'))}</form>${past}`);
}
function sheetHtml() {
  if (!S.sheet) return '';
  switch (S.sheet.k) {
    case 'auth': return authSheet();
    case 'account': return me() ? accountSheet() : '';
    case 'profile': return profileSheet();
    case 'post': return postSheet();
    case 'catch': return catchSheet();
    case 'group': return groupSheet();
    case 'join': return joinSheet();
    case 'spot': return S.admin ? spotSheet() : '';
    case 'feedback': return feedbackSheet();
    case 'inbox': return me() ? inboxSheet() : '';
    case 'pin': return me() ? pinSheet() : '';
    case 'report': return me() ? reportSheet() : '';
    case 'catchview': return catchViewSheet();
  }
  return '';
}

/* ---------- render ---------- */
function applyTheme() {
  const r = document.documentElement;
  if (S.theme === 'auto') { if (ORIG_THEME) r.setAttribute('data-theme', ORIG_THEME); else r.removeAttribute('data-theme'); } else r.setAttribute('data-theme', S.theme);
}
function captureInputs() {
  const keep = { vals: {}, focus: null };
  $$('#app input[id], #app textarea[id]').forEach((el) => { if (el.type === 'file' || el.type === 'checkbox' || el.type === 'radio') return; keep.vals[el.id] = el.value; });
  const a = document.activeElement;
  if (a && a.id && $('#app').contains(a)) keep.focus = { id: a.id, s: a.selectionStart, e: a.selectionEnd };
  return keep;
}
function restoreInputs(keep) {
  Object.keys(keep.vals).forEach((id) => { const el = document.getElementById(id); if (el && !el.value && keep.vals[id]) el.value = keep.vals[id]; });
  pwRefresh('r-pw', 'r-pw2', 'pw-list', 'r-submit', false); pwRefresh('n-pw', 'n-pw2', 'pw-list2', 'n-submit', false);
  if (keep.focus) { const el = document.getElementById(keep.focus.id); if (el) { el.focus(); try { if (keep.focus.s != null) el.setSelectionRange(keep.focus.s, keep.focus.e); } catch (_) { /* not a text field */ } } }
}
function mainView() {
  if (!S.data) {
    return S.loadError ? `<div class="panel empty"><span>${esc(T('loadError'))}</span><button class="btn primary" data-act="retry">${esc(T('retry'))}</button></div>` : `<div class="panel empty">${esc(T('loading'))}</div>`;
  }
  switch (S.tab) {
    case 'map': return mapView();
    case 'board': return boardView();
    case 'catches': return catchesView();
    case 'groups': return groupsView();
    case 'chat': return chatView();
    case 'anglers': return anglersView();
    case 'profile': return profileView();
    case 'admin': return adminView();
  }
  return tideView();
}
function render() {
  const keep = captureInputs();
  const prevMsgs = $('#msgs'), atBottom = !prevMsgs || prevMsgs.scrollHeight - prevMsgs.scrollTop - prevMsgs.clientHeight < 80;
  document.documentElement.lang = S.lang; document.title = T('brand'); applyTheme();
  $('#app').innerHTML = header() + tabs() + `<main>${mainView()}</main><footer>${esc(T('footer'))} · <button class="linkbtn" data-act="feedback">${esc(T('feedbackBtn'))}</button></footer>` + (S.data ? sheetHtml() : '');
  restoreInputs(keep);
  if (S.tab === 'map') mountMap();
  S.rendered = true; S.dirty = false;
  const sc = $('#scroller');
  if (sc) { const nowM = S.day === 0 ? new Date().getHours() * 60 + new Date().getMinutes() : 360; sc.scrollLeft = Math.max(0, nowM / 60 * CW - sc.clientWidth / 2); }
  const m = $('#msgs'); if (m && atBottom) m.scrollTop = m.scrollHeight;
  if (S.focusId) { const f = document.getElementById(S.focusId); if (f) f.focus(); S.focusId = null; }
  else if (S.sheet && !keep.focus && ['auth', 'account', 'feedback', 'spot'].indexOf(S.sheet.k) > -1) { const f = $('.sheet input:not([type=hidden]),.sheet textarea'); if (f) f.focus(); }
  markRead();
}
function closeSheet() { S.sheet = null; S.photo = null; S.gps = null; }
function openRoom(key) { S.room = key; S.tab = 'chat'; S.sheet = null; S.focusId = 'chatin'; render(); load(); }

/* ---------- GPS from the photo's EXIF block (read in the browser; the uploaded copy has all location data stripped) ---------- */
function readGps(file) {
  return new Promise((res) => {
    const fr = new FileReader();
    fr.onload = () => {
      try {
        const v = new DataView(fr.result); let o = 2;
        if (v.getUint16(0) !== 0xFFD8) return res(null);
        while (o + 4 < v.byteLength) {
          const mk = v.getUint16(o), len = v.getUint16(o + 2);
          if (mk === 0xFFE1 && v.getUint32(o + 4) === 0x45786966) { res(parseExif(v, o + 10)); return; }
          if ((mk & 0xFF00) !== 0xFF00 || mk === 0xFFDA) break;
          o += 2 + len;
        }
      } catch (e) { /* unreadable EXIF */ }
      res(null);
    };
    fr.onerror = () => res(null);
    fr.readAsArrayBuffer(file.slice(0, 262144));
  });
}
function parseExif(v, t) {
  const le = v.getUint16(t) === 0x4949, u16 = (p) => v.getUint16(p, le), u32 = (p) => v.getUint32(p, le);
  const ifd = (off) => { const m = {}, n = u16(t + off); for (let i = 0; i < n; i++) { const e = t + off + 2 + i * 12; m[u16(e)] = { type: u16(e + 2), cnt: u32(e + 4), at: e + 8 }; } return m; };
  const gp = ifd(u32(t + 4))[0x8825]; if (!gp) return null;
  const g = ifd(u32(gp.at));
  const rat = (e) => { const p = t + u32(e.at); let r = 0; for (let i = 0; i < 3; i++) r += (u32(p + i * 8) / (u32(p + i * 8 + 4) || 1)) / Math.pow(60, i); return r; };
  const ch = (e) => String.fromCharCode(v.getUint8(e.at));
  if (!g[2] || !g[4] || !g[1] || !g[3]) return null;
  let lat = rat(g[2]), lng = rat(g[4]);
  if (ch(g[1]) === 'S') lat = -lat; if (ch(g[3]) === 'W') lng = -lng;
  return isFinite(lat) && isFinite(lng) && (lat || lng) ? { lat: Math.round(lat * 1e6) / 1e6, lng: Math.round(lng * 1e6) / 1e6 } : null;
}

/* ---------- photo resize (strips location data by re-drawing) ---------- */
function resizeImage(file) {
  return new Promise((res) => {
    const fr = new FileReader();
    fr.onload = () => {
      const img = new Image();
      img.onload = () => {
        const sc = Math.min(1, 1200 / Math.max(img.width, img.height)), c = document.createElement('canvas');
        c.width = Math.max(1, Math.round(img.width * sc)); c.height = Math.max(1, Math.round(img.height * sc));
        c.getContext('2d').drawImage(img, 0, 0, c.width, c.height);
        res(c.toDataURL('image/jpeg', 0.82));
      };
      img.onerror = () => res(null); img.src = fr.result;
    };
    fr.onerror = () => res(null); fr.readAsDataURL(file);
  });
}

/* ---------- actions (clicks) ---------- */
const find = (list, id) => (list || []).find((x) => x.id === id);
const A = {
  lang(el) { S.lang = el.dataset.v; LS.set('lang', S.lang); },
  theme(el) { S.theme = el.dataset.v; LS.set('theme', S.theme); },
  tab(el) { S.tab = el.dataset.v; LS.set('tab', S.tab); S.group = null; if (S.tab === 'admin') { loadAdmin(); } },
  day(el) { S.day = +el.dataset.v; }, dayprev() { S.day = Math.max(0, S.day - 1); }, daynext() { S.day = Math.min(6, S.day + 1); },
  water(el) { S.water = el.dataset.v; },
  filter(el) { S.filter = el.dataset.v; }, scope(el) { S.scope = el.dataset.v; }, cscope(el) { S.cScope = el.dataset.v; }, ascope(el) { S.aScope = el.dataset.v; },
  retry() { S.loadError = false; load(); },
  login() { S.sheet = { k: 'auth', mode: 'login', why: '' }; }, register() { S.sheet = { k: 'auth', mode: 'register', why: '' }; },
  authmode(el) { S.sheet.mode = el.dataset.v; },
  account() { if (!needLogin()) return false; S.sheet = { k: 'account' }; },
  profile(el) { if (me() && el.dataset.u === myId()) { S.sheet = null; S.tab = 'profile'; S.hist = null; loadHistory(); return; } S.sheet = { k: 'profile', u: el.dataset.u }; },
  myprofile() { if (!needLogin()) return false; S.sheet = null; S.tab = 'profile'; S.hist = null; loadHistory(); },
  histfilter(el) { S.histF = el.dataset.v; },
  delavatar() { api('DELETE', '/api/me/avatar').then(() => load()).catch(fail); return false; },
  feedback() { if (!needLogin()) return false; S.sheet = { k: 'feedback' }; },
  report(el) { if (!needLogin()) return false; S.sheet = { k: 'report', t: el.dataset.t, id: el.dataset.id }; },
  repfilter(el) { S.repFilter = el.dataset.v; },
  candact(el) {
    const id = el.dataset.id, a = el.dataset.a;
    if (a === 'reject') { if (!confirm(T('ns_confirmReject'))) return false; }
    const body = { action: a };
    if (a === 'approve') {
      body.en = val('ns-en-' + id).trim(); body.ja = val('ns-ja-' + id).trim(); body.type = val('ns-type-' + id); body.pref = val('ns-pref-' + id);
      if (body.en.length < 2 || !body.ja) { setErr('ns-err-' + id, { code: 'invalid_name' }); return false; }
    }
    api('POST', '/api/admin/candidates/' + id, body).then(() => load().then(() => loadAdmin())).then(() => { toast(T(a === 'approve' ? 'ns_approved' : 'ns_rejected')); render(); }).catch((e) => setErr('ns-err-' + id, e));
    return false;
  },
  repact(el) {
    if (el.dataset.a === 'remove' && !confirm(T('rp_confirm'))) return false;
    api('POST', '/api/admin/reports/' + el.dataset.id, { action: el.dataset.a }).then(() => load().then(() => loadAdmin())).then(() => { toast(T('rp_done')); render(); }).catch(fail);
    return false;
  },
  mapsel(el) { S.mapSel = { t: el.dataset.t, id: el.dataset.id }; S.mapFly = true; },
  mapclear() { S.mapSel = null; },
  mapwater(el) { S.mapWater = el.dataset.v; },
  mapbase(el) { const v = el.dataset.v; try { localStorage.setItem('castomo.base', v); } catch (e) { /* storage blocked */ } if (M.map) { setBase(v); syncBaseChips(); } return false; },
  mappin() { if (!needLogin()) return false; S.pinMode = !S.pinMode; S.mapSel = null; },
  editpin(el) { S.sheet = { k: 'pin', id: el.dataset.id }; },
  delpin(el) { if (!confirm(T('confirmDelete'))) return false; api('DELETE', '/api/pins/' + el.dataset.id).then(() => { S.mapSel = null; return load(); }).then(() => render()).catch(fail); return false; },
  opencatch(el) { S.sheet = { k: 'catchview', id: el.dataset.c }; },
  sethome(el) { if (!needLogin()) return false; act(api('PATCH', '/api/me', { spot: el.dataset.id }), T('homeSet')); return false; },
  importosm() {
    if (!confirm(T('importConfirm'))) return false;
    toast(T('importing'));
    api('POST', '/api/admin/import-osm').then((r) => load().then(() => loadAdmin()).then(() => { toast(T('importDone')(r)); render(); })).catch(fail);
    return false;
  },
  inbox() {
    if (!needLogin()) return false;
    S.inboxNew = (S.data.inbox || []).filter((m) => !m.read_at).map((m) => m.id);
    S.sheet = { k: 'inbox' };
    if (S.inboxNew.length) api('POST', '/api/inbox/read').then(() => load()).catch(() => {});
  },
  delinbox(el) { api('DELETE', '/api/inbox/' + el.dataset.id).then(() => load()).catch(fail); },
  closesheet() { closeSheet(); }, scrim(el, e) { if (e.target !== el) return false; closeSheet(); },
  pwtoggle(el) { $$('#r-pw,#r-pw2').forEach((i) => { i.type = i.type === 'password' ? 'text' : 'password'; }); return false; },
  newpost() { if (!needLogin()) return false; S.sheet = { k: 'post' }; },
  newcatch() { if (!needLogin()) return false; S.photo = null; S.gps = null; S.sheet = { k: 'catch' }; },
  newgroup() { if (!needLogin()) return false; S.sheet = { k: 'group' }; },
  join(el) { if (!needLogin()) return false; S.sheet = { k: 'join', p: el.dataset.p }; },
  logout() { api('POST', '/api/logout').then(() => { closeSheet(); S.admin = null; if (S.tab === 'admin') S.tab = 'tide'; return load(); }).catch(fail); return false; },
  cancelreq(el) { act(api('DELETE', '/api/posts/' + el.dataset.p + '/join')); return false; },
  accept(el) { act(api('POST', '/api/posts/' + el.dataset.p + '/accept', { uid: el.dataset.u })); return false; },
  decline(el) { act(api('POST', '/api/posts/' + el.dataset.p + '/decline', { uid: el.dataset.u })); return false; },
  delpost(el) { if (confirm(T(el.dataset.admin ? 'confirmAdminRemove' : 'confirmCancelTrip'))) act(api('DELETE', '/api/posts/' + el.dataset.p)); return false; },
  delcatch(el) { if (confirm(T(el.dataset.admin ? 'confirmAdminRemove' : 'confirmDelete'))) act(api('DELETE', '/api/catches/' + el.dataset.c)).then(() => { if (S.sheet && S.sheet.k === 'catchview') { closeSheet(); render(); } }); return false; },
  delcomment(el) { if (confirm(T('confirmDelete'))) act(api('DELETE', '/api/comments/' + el.dataset.id)); return false; },
  like(el) { if (!needLogin()) return false; act(api('POST', '/api/catches/' + el.dataset.c + '/like')); return false; },
  togglec(el) { S.openC[el.dataset.c] = !S.openC[el.dataset.c]; if (S.openC[el.dataset.c]) S.focusId = 'cm-' + el.dataset.c; },
  room(el) { S.room = el.dataset.v; S.focusId = 'chatin'; },
  tripchat(el) { S.room = 'post-' + el.dataset.p; S.tab = 'chat'; S.focusId = 'chatin'; },
  opengroup(el) { S.group = el.dataset.g; S.focusId = 'chatin'; }, groupback() { S.group = null; },
  addmember(el) { const sel = $('#gm-add'); if (sel && sel.value) act(api('POST', '/api/groups/' + el.dataset.g + '/members', { uid: sel.value })); return false; },
  rmmember(el) { act(api('DELETE', '/api/groups/' + el.dataset.g + '/members/' + el.dataset.u)); return false; },
  leavegroup(el) { if (confirm(T('confirmLeave'))) act(api('DELETE', '/api/groups/' + el.dataset.g + '/members/' + myId())).then(() => { S.group = null; render(); }); return false; },
  friendadd(el) { if (!needLogin()) return false; act(api('POST', '/api/friends', { to: el.dataset.u }), T('friendReqSent')); return false; },
  friendaccept(el) { act(api('POST', '/api/friends/' + el.dataset.u + '/accept')); return false; },
  friendremove(el) { act(api('DELETE', '/api/friends/' + el.dataset.u)); return false; },
  admintab(el) { S.adminTab = el.dataset.v; },
  fbfilter(el) { S.fbFilter = el.dataset.v; },
  addspot() { S.sheet = { k: 'spot', id: '' }; }, editspot(el) { S.sheet = { k: 'spot', id: el.dataset.id }; },
  togglespot(el) { const s = find(S.admin.spots, el.dataset.id); if (!s) return false; api('PATCH', '/api/admin/spots/' + s.id, { active: !s.active }).then(() => load().then(() => loadAdmin())).catch(fail); return false; },
  delfb(el) { if (confirm(T('confirmDelete'))) api('DELETE', '/api/admin/feedback/' + el.dataset.id).then(() => loadAdmin()).catch(fail); return false; },
  rmadmin(el) { if (confirm(T('confirmRemoveAdmin'))) api('DELETE', '/api/admin/admins/' + el.dataset.id).then(() => load().then(() => loadAdmin())).catch(fail); return false; }
};
document.addEventListener('click', (e) => {
  const el = e.target.closest('[data-act]'); if (!el) return;
  const fn = A[el.dataset.act]; if (!fn) return;
  if (el.tagName === 'A') e.preventDefault();
  const r = fn(el, e);
  if (r === false) return;
  render();
});

/* ---------- changes and typing ---------- */
const customWrap = (wrapId, inputId) => (e) => { const w = $('#' + wrapId); if (w) { w.hidden = e.target.value !== '__new'; if (!w.hidden) $('#' + inputId).focus(); } };
document.addEventListener('change', (e) => {
  const t = e.target, id = t.id;
  if (id === 'spot') {
    S.homeSpot = t.value; LS.set('spot', t.value);
    if (me()) { api('PATCH', '/api/me', { spot: t.value }).then(() => load()).catch(fail); } render();
  } else if (id === 'sort') { S.sort = t.value; render(); }
  else if (id === 'csort') { S.cSort = t.value; render(); }
  else if (id === 'sf') { S.sf = t.value; render(); }
  else if (id === 'fs') { S.fs = t.value; render(); }
  else if (id === 'ft') { S.ft = t.value; render(); }
  else if (id === 'aspp') { S.spotPref = t.value; render(); }
  else if (id === 'p-spot') customWrap('p-customwrap', 'p-custom')(e);
  else if (id === 'c-loc') customWrap('c-customwrap', 'c-custom')(e);
  else if (id === 'av-file') {
    const f = t.files && t.files[0]; t.value = ''; if (!f) return;
    cropSquare(f, 256).then((url) => { if (!url) { toast(T('err_invalid_photo'), 'bad'); return; } return api('POST', '/api/me/avatar', { photo: url }).then(() => load()); }).catch(fail);
  } else if (id === 'c-file') {
    const f = t.files && t.files[0]; S.photo = null; const pv = $('#c-prev'); if (pv) pv.hidden = true;
    if (f) { S.gps = null; readGps(f).then((g) => { S.gps = g; const gn = $('#c-gps'); if (gn) gn.hidden = !g; }); }
    if (f) resizeImage(f).then((url) => { S.photo = url; if (url && pv) { pv.src = url; pv.hidden = false; } else if (!url) toast(T('err_invalid_photo'), 'bad'); });
  } else if (t.name === 'p-tr') { const w = $('#p-seatwrap'); if (w) w.hidden = t.value !== 'car'; }
  else if (t.classList.contains('fbstatus')) { api('PATCH', '/api/admin/feedback/' + t.dataset.id, { status: t.value }).then(() => loadAdmin()).catch(fail); }
});
document.addEventListener('input', (e) => {
  const id = e.target.id;
  if (id === 'q') { S.q = e.target.value; $('#results').innerHTML = anglerList(); }
  else if (id === 'mapq') { S.mapQ = e.target.value; S.mapSel = null; const box = $('#mapside'); if (box) box.innerHTML = mapSideHtml(); if (M.map) syncSel(); }
  else if (id === 'aspq') { S.spotQ = e.target.value; const box = $('#aspots'); if (box) box.innerHTML = spotTable(); }
  else if (id === 'r-pw' || id === 'r-pw2') pwRefresh('r-pw', 'r-pw2', 'pw-list', 'r-submit', false);
  else if (id === 'n-pw' || id === 'n-pw2') pwRefresh('n-pw', 'n-pw2', 'pw-list2', 'n-submit', false);
});

/* ---------- forms ---------- */
const val = (id) => { const el = document.getElementById(id); return el ? el.value : ''; };
function setErr(id, e) { const el = document.getElementById(id); if (el) el.textContent = errText(e); }
const FORMS = {
  report(f) {
    const r = f.querySelector('input[name=rr]:checked');
    api('POST', '/api/reports', { type: f.dataset.t, id: f.dataset.id, reason: r ? r.value : 'spam', note: val('rp-note').trim() })
      .then(() => { closeSheet(); toast(T('reportThanks')); render(); })
      .catch((e) => setErr('rp-err', e));
  },
  pin(f) {
    const body = { name: val('pn-name').trim(), note: val('pn-note').trim(), lat: parseFloat(val('pn-lat')), lng: parseFloat(val('pn-lng')) };
    const id = f.dataset.id;
    (id ? api('PATCH', '/api/pins/' + id, body).then(() => ({ id })) : api('POST', '/api/pins', body))
      .then((r) => { closeSheet(); return load().then(() => { S.mapSel = { t: 'pin', id: r.id }; S.mapFly = true; S.tab = 'map'; toast(T('saved')); render(); }); })
      .catch((e) => setErr('pn-err', e));
  },
  send(f) {
    const inp = $('#chatin'), text = inp.value.trim(); if (!text) return;
    const room = f.dataset.room; inp.value = '';
    api('POST', '/api/rooms/' + encodeURIComponent(room) + '/messages', { text }).then(() => { S.focusId = 'chatin'; return load(); }).catch((e) => { inp.value = text; fail(e); });
  },
  comment(f) {
    const inp = document.getElementById('cm-' + f.dataset.c), text = inp.value.trim(); if (!text || !needLogin()) return;
    inp.value = ''; S.focusId = 'cm-' + f.dataset.c;
    api('POST', '/api/catches/' + f.dataset.c + '/comments', { text }).then(() => load()).catch((e) => { inp.value = text; fail(e); });
  },
  login() {
    api('POST', '/api/login', { nick: val('l-nick').trim(), password: val('l-pw'), keep: !!(document.getElementById('l-keep') || {}).checked }).then(() => { closeSheet(); return load().then(() => { if (isAdmin()) loadAdmin(); toast(T('welcomeBack')); }); }).catch((e) => setErr('auth-err', e));
  },
  register() {
    const pw = val('r-pw'); if (!(pwOk(pwChecks(pw)) && pw === val('r-pw2'))) return;
    api('POST', '/api/register', { nick: val('r-nick').trim(), password: pw, name: val('r-name').trim(), email: val('r-email').trim(), spot: val('r-spot'), lang: S.lang })
      .then(() => { closeSheet(); return load().then(() => toast(T('welcomeNew'))); }).catch((e) => setErr('auth-err', e));
  },
  account() {
    const body = { nick: val('a-nick').trim(), name: val('a-name').trim(), email: val('a-email').trim(), spot: val('a-spot'), style: val('a-style'), target: val('a-target'), bio: val('a-bio').trim() };
    api('PATCH', '/api/me', body).then(() => { closeSheet(); return load().then(() => toast(T('saved'))); }).catch(fail);
  },
  pw() {
    const pw = val('n-pw'); if (!(pwOk(pwChecks(pw)) && pw === val('n-pw2'))) return;
    api('PATCH', '/api/me', { password: pw, currentPassword: val('c-pw') }).then(() => { closeSheet(); render(); toast(T('pwChanged')); }).catch(fail);
  },
  claim() { api('POST', '/api/admin/claim', { code: val('claim-code') }).then(() => { closeSheet(); return load().then(() => { toast(T('claimed')); return loadAdmin(); }); }).catch(fail); },
  delme() { if (!val('d-pw') || !confirm(T('confirmDeleteAccount'))) return; api('DELETE', '/api/me', { password: val('d-pw') }).then(() => { closeSheet(); S.admin = null; S.tab = 'tide'; return load(); }).catch(fail); },
  pm(f) {
    const text = val('pm-msg').trim(); if (!text || !needLogin()) return;
    const uid = f.dataset.u;
    api('POST', '/api/rooms/' + encodeURIComponent('dm-' + uid) + '/messages', { text }).then(() => { toast(T('msgSent')); openRoom('dm-' + uid); }).catch(fail);
  },
  invite(f) {
    const p = find(S.data.posts, val('inv-post')); if (!p) return;
    const uid = f.dataset.u;
    api('POST', '/api/rooms/' + encodeURIComponent('dm-' + uid) + '/messages', { text: T('inviteMsg')(postSpot(p), dateStr(parseD(p.date)), p.time) }).then(() => { toast(T('msgSent')); openRoom('dm-' + uid); }).catch(fail);
  },
  post() {
    const v = val('p-spot'); let spot = v, custom = '';
    if (v === '__new') { custom = val('p-custom').trim(); if (!custom) { $('#p-custom').focus(); return; } spot = 'custom'; }
    else if (v.indexOf('c:') === 0) { spot = 'custom'; custom = v.slice(2); }
    if (custom) { const cs = customSpots(); if (cs.indexOf(custom) < 0) { cs.push(custom); LS.set('custom', cs.slice(-20)); } }
    const tr = (document.querySelector('input[name="p-tr"]:checked') || {}).value || 'car';
    api('POST', '/api/posts', { date: val('p-date'), time: val('p-time'), spot, custom, meet: val('p-meet').trim(), fish: val('p-fish'), transport: tr, seats: tr === 'car' ? parseInt(val('p-seats'), 10) || 0 : 0, note: val('p-note').trim() })
      .then(() => { closeSheet(); S.tab = 'board'; S.filter = 'all'; S.sf = 'all'; S.scope = 'all'; return load().then(() => render()); }).catch(fail);
  },
  join(f) {
    const rd = $('#j-ride'), dr = $('#j-drive');
    api('POST', '/api/posts/' + f.dataset.p + '/join', { needRide: !!(rd && rd.checked), canDrive: !!(dr && dr.checked), msg: val('j-msg').trim() }).then(() => { closeSheet(); return load(); }).catch(fail);
  },
  catch() {
    const v = val('c-loc'); let loc;
    if (v === '__new') { const n = val('c-custom').trim(); if (!n) { $('#c-custom').focus(); return; } loc = { k: 'custom', v: n }; const cs = customSpots(); if (cs.indexOf(n) < 0) { cs.push(n); LS.set('custom', cs.slice(-20)); } }
    else if (v.indexOf('a:') === 0) loc = { k: 'area', v: v.slice(2) }; else if (v.indexOf('c:') === 0) loc = { k: 'custom', v: v.slice(2) }; else loc = { k: 'spot', v };
    const size = parseInt(val('c-size'), 10);
    api('POST', '/api/catches', { photo: S.photo || '', gps: S.photo && S.gps ? S.gps : undefined, fish: val('c-fish'), size: isNaN(size) ? 0 : size, date: val('c-date'), loc, cap: val('c-cap').trim(), tackle: { rod: val('c-rod').trim(), reel: val('c-reel').trim(), line: val('c-line').trim(), lure: val('c-lure').trim(), pub: $('#c-pub').checked } })
      .then(() => { closeSheet(); S.tab = 'catches'; return load().then(() => render()); }).catch(fail);
  },
  group() {
    const mem = $$('input[name="g-mem"]:checked').map((c) => c.value);
    api('POST', '/api/groups', { name: val('g-name').trim(), desc: val('g-desc').trim(), members: mem }).then((r) => { closeSheet(); S.tab = 'groups'; S.group = r.id; S.focusId = 'chatin'; return load().then(() => render()); }).catch(fail);
  },
  feedback() {
    const kind = (document.querySelector('input[name="fb-kind"]:checked') || {}).value || 'bug';
    api('POST', '/api/feedback', { kind, text: val('fb-text').trim(), page: S.tab, lang: S.lang }).then(() => load().then(() => { toast(T('feedbackThanks')); S.sheet = { k: 'feedback' }; render(); })).catch((e) => setErr('fb-err', e));
  },
  spot(f) {
    const body = { en: val('s-en').trim(), ja: val('s-ja').trim(), pref: val('s-pref'), type: val('s-type'), lat: parseFloat(val('s-lat')), lng: parseFloat(val('s-lng')) };
    const id = f.dataset.id;
    let p;
    if (id) p = api('PATCH', '/api/admin/spots/' + id, body);
    else { const sid = val('s-id').trim(); if (sid) body.id = sid; p = api('POST', '/api/admin/spots', body); }
    p.then(() => { closeSheet(); return load().then(() => loadAdmin()).then(() => { toast(T('saved')); render(); }); }).catch((e) => setErr('spot-err', e));
  },
  fbreply(f) {
    api('PATCH', '/api/admin/feedback/' + f.dataset.id, { note: val('note-' + f.dataset.id).trim() }).then(() => { toast(T('saved')); return loadAdmin(); }).catch(fail);
  },
  adminadd() {
    api('POST', '/api/admin/admins', { nick: val('adm-nick').trim() }).then(() => { toast(T('saved')); return load().then(() => loadAdmin()); }).catch(fail);
  }
};
document.addEventListener('submit', (e) => {
  const f = e.target.closest('form[data-form]'); if (!f) return;
  e.preventDefault();
  const fn = FORMS[f.dataset.form]; if (fn) fn(f);
});
document.addEventListener('keydown', (e) => {
  if (e.key === 'Escape' && S.sheet) { closeSheet(); render(); return; }
  const tag = (document.activeElement && document.activeElement.tagName) || '';
  if (S.tab === 'tide' && !S.sheet && tag !== 'INPUT' && tag !== 'SELECT' && tag !== 'TEXTAREA') {
    if (e.key === 'ArrowRight' && S.day < 6) { S.day++; render(); }
    if (e.key === 'ArrowLeft' && S.day > 0) { S.day--; render(); }
  }
});
document.addEventListener('visibilitychange', () => { if (!document.hidden && S.loaded) { load(true); markRead(); } });
setInterval(() => { if (!document.hidden && S.loaded) load(true); }, 30000);

/* ---------- start ---------- */
render();
connectEvents();
load().then(() => { if (isAdmin()) loadAdmin(); });
})();
