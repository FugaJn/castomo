'use strict';
/*
 * Public, crawlable pages for search engines: /ja/ and /en/ landing pages, prefecture pages,
 * fishing-spot pages, robots.txt and sitemap.xml. The app itself stays a client-side SPA at "/".
 * Only non-personal data is rendered here (spot names, prefectures, types). No user data, no tide numbers
 * (built-in tide values are sample numbers, so they are deliberately not published).
 */
const D = require('./public/spots.js');

const TYPE = {
  s: { en: 'saltwater', ja: '海釣り' },
  b: { en: 'brackish water', ja: '汽水域' },
  f: { en: 'freshwater', ja: '川・湖の釣り' }
};
const esc = (s) => String(s == null ? '' : s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const other = (l) => (l === 'ja' ? 'en' : 'ja');

const COPY = {
  ja: {
    brand: 'キャストモ',
    homeTitle: 'キャストモ | 釣り仲間と釣行・釣果をつなぐ日本の釣りコミュニティ',
    homeDesc: 'キャストモは日本中の釣り仲間をつなぐ無料の釣りコミュニティ。釣行の募集掲示板、車の乗り合い、釣果の共有、グループ、チャットが使えます。海釣り・川釣りの釣り場を全国から検索。',
    h1: '日本中の釣り仲間をつなぐ釣りコミュニティ',
    lead: 'キャストモは、釣行の仲間探し、車の乗り合い、釣果の共有ができる釣り人のためのコミュニティアプリです。メールアドレスなしでも始められます。',
    features: [
      ['釣行掲示板', '行きたい日・場所・集合場所を投稿し、参加リクエストを受け付けられます。車の有無や空席数も共有できます。'],
      ['乗り合い', '車を出せる人、乗せてほしい人、電車で行く人で絞り込めます。'],
      ['釣果の共有', '写真付きで釣果を投稿。正確な場所は公開せず、いいねやコメントもできます。'],
      ['グループとチャット', '仲間内の非公開グループや、釣行ごとのチャットが使えます。'],
      ['全国の釣り場マップ', '海・川・湖の釣り場を地図で探し、自分だけのピンも保存できます。']
    ],
    open: 'アプリを開く', areas: '都道府県から釣り場を探す', spotsIn: (p) => p + 'の釣り場',
    areaTitle: (p) => p + 'の釣り場一覧(海釣り・川釣り) | キャストモ',
    areaDesc: (p, n) => p + 'の釣り場を' + n + '件掲載。海釣り・汽水域・川釣りのスポットを探して、釣り仲間を募集できます。',
    spotTitle: (s, p) => s + '(' + p + ')の釣り場情報 | キャストモ',
    spotDesc: (s, p, t) => p + 'の釣り場「' + s + '」(' + t + ')。位置情報、同じ県の近くの釣り場、釣り仲間の募集はキャストモで。',
    type: '釣りのタイプ', pref: '都道府県', map: '地図で開く', nearby: '同じ県の他の釣り場', join: 'この釣り場で仲間を募集する',
    joinText: 'キャストモのアプリで、この釣り場への釣行を投稿して参加者を募集できます。', home: 'ホーム', all: 'すべて見る'
  },
  en: {
    brand: 'Castomo',
    homeTitle: 'Castomo – Find Fishing Buddies, Trips & Catches in Japan',
    homeDesc: 'Castomo is a free community for anglers in Japan: a fishing trip board with ride sharing, catch sharing, groups and chat. Browse saltwater and freshwater fishing spots nationwide.',
    h1: 'The fishing community connecting anglers across Japan',
    lead: 'Castomo is a community app for anglers to find trip partners, share rides and post catches. You can start without an email address.',
    features: [
      ['Trip board', 'Post when and where you plan to fish, with a meeting point. Others send join requests, and you can say whether you have a car and how many seats are free.'],
      ['Ride sharing', 'Filter by who has a car, who offers a ride, who needs one, or who takes public transport.'],
      ['Catch sharing', 'Post catches with photos. Exact locations stay private; others can like and comment.'],
      ['Groups and chat', 'Private groups for your fishing crew and a chat for every trip.'],
      ['Fishing spot map', 'Find saltwater, river and lake spots across Japan and save private pins of your own.']
    ],
    open: 'Open the app', areas: 'Browse fishing spots by prefecture', spotsIn: (p) => 'Fishing spots in ' + p,
    areaTitle: (p) => 'Fishing Spots in ' + p + ', Japan (Sea, River & Lake) | Castomo',
    areaDesc: (p, n) => n + ' fishing spots in ' + p + ', Japan. Find saltwater, brackish and freshwater spots and look for fishing partners on Castomo.',
    spotTitle: (s, p) => s + ' Fishing Spot, ' + p + ' | Castomo',
    spotDesc: (s, p, t) => s + ' (' + t + ') in ' + p + ', Japan. See its location, nearby spots in the same prefecture, and find fishing partners on Castomo.',
    type: 'Fishing type', pref: 'Prefecture', map: 'Open in map', nearby: 'More spots in this prefecture', join: 'Find fishing partners for this spot',
    joinText: 'In the Castomo app you can post a trip to this spot and invite other anglers to join.', home: 'Home', all: 'View all'
  }
};

const CSS = 'body{margin:0;font:16px/1.65 system-ui,-apple-system,"Hiragino Sans","Noto Sans JP",sans-serif;color:#1c2733;background:#fff}'
  + 'header,main,footer{max-width:820px;margin:0 auto;padding:16px 20px}header{display:flex;justify-content:space-between;align-items:center;gap:12px;flex-wrap:wrap}'
  + 'a{color:#27466B}h1{font-size:1.7rem;line-height:1.3}h2{font-size:1.2rem;margin-top:2rem}'
  + '.btn{display:inline-block;background:#27466B;color:#fff;padding:10px 18px;border-radius:8px;text-decoration:none;font-weight:600}'
  + 'ul.cols{columns:2;padding-left:1.1rem}nav a{margin-right:12px}footer{color:#5b6773;font-size:.9rem;border-top:1px solid #e3e8ee;margin-top:2rem}'
  + '@media(prefers-color-scheme:dark){body{background:#12171d;color:#e6ebf0}a{color:#8db4e8}.btn{background:#8db4e8;color:#12171d}footer{border-color:#2a333d;color:#98a4b0}}'
  + '@media(max-width:520px){ul.cols{columns:1}}';

function createSeo({ q, siteUrl }) {
  const base = String(siteUrl || 'https://castomo.app').replace(/\/+$/, '');
  const prefs = new Map(D.PREFS.map((p) => [p.id, p]));
  const spotsRaw = () => q('SELECT id,en,ja,type,pref,lat,lng FROM spots WHERE active=1 ORDER BY pref, en').all();

  /* Page URLs (the same path in both languages, prefixed /ja or /en). */
  const u = {
    home: (l) => `${base}/${l}/`,
    area: (l, p) => `${base}/${l}/area/${encodeURIComponent(p)}`,
    spot: (l, id) => `${base}/${l}/spot/${encodeURIComponent(id)}`
  };
  const name = (o, l) => o[l] || o[other(l)] || '';

  function layout({ l, title, desc, canonical, alts, body, ld }) {
    const c = COPY[l];
    const hreflangs = alts ? Object.entries(alts).map(([k, v]) => `<link rel="alternate" hreflang="${k}" href="${esc(v)}">`).join('\n') : '';
    return `<!doctype html>
<html lang="${l}">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>${esc(title)}</title>
<meta name="description" content="${esc(desc)}">
<link rel="canonical" href="${esc(canonical)}">
${hreflangs}
<meta name="theme-color" content="#27466B">
<meta property="og:type" content="website">
<meta property="og:site_name" content="${c.brand}">
<meta property="og:title" content="${esc(title)}">
<meta property="og:description" content="${esc(desc)}">
<meta property="og:url" content="${esc(canonical)}">
<meta property="og:image" content="${base}/icon-512.png">
<meta property="og:locale" content="${l === 'ja' ? 'ja_JP' : 'en_US'}">
<meta name="twitter:card" content="summary">
<link rel="icon" type="image/png" href="/favicon.png">
<link rel="manifest" href="/manifest.webmanifest">
${ld ? `<script type="application/ld+json">${JSON.stringify(ld).replace(/</g, '\\u003c')}</script>` : ''}
<style>${CSS}</style>
</head>
<body>
<header><a href="${u.home(l)}"><b>${c.brand}</b></a><nav><a href="${alts ? esc(alts[other(l)]) : '#'}" hreflang="${other(l)}" lang="${other(l)}">${l === 'ja' ? 'English' : '日本語'}</a><a class="btn" href="/">${c.open}</a></nav></header>
<main>
${body}
</main>
<footer>© Castomo / キャストモ · <a href="${u.home('ja')}">日本語</a> · <a href="${u.home('en')}">English</a></footer>
</body>
</html>`;
  }

  function prefList(l) {
    return D.REGIONS.map((r) => `<h3>${esc(name(r, l))}</h3><ul class="cols">${D.PREFS.filter((p) => p.region === r.id).map((p) => `<li><a href="${u.area(l, p.id)}">${esc(name(p, l))}</a></li>`).join('')}</ul>`).join('');
  }

  function home(l) {
    const c = COPY[l];
    const ld = [
      { '@context': 'https://schema.org', '@type': 'Organization', name: 'Castomo', alternateName: 'キャストモ', url: base + '/', logo: base + '/icon-512.png' },
      { '@context': 'https://schema.org', '@type': 'WebSite', name: 'Castomo', alternateName: 'キャストモ', url: base + '/', inLanguage: ['ja', 'en'] },
      { '@context': 'https://schema.org', '@type': 'WebApplication', name: 'Castomo', alternateName: 'キャストモ', url: base + '/', applicationCategory: 'SocialNetworkingApplication', operatingSystem: 'Any (web browser)', inLanguage: ['ja', 'en'], description: c.homeDesc, offers: { '@type': 'Offer', price: '0', priceCurrency: 'JPY' } }
    ];
    const body = `<h1>${esc(c.h1)}</h1><p>${esc(c.lead)}</p><p><a class="btn" href="/">${c.open}</a></p>`
      + c.features.map((f) => `<h2>${esc(f[0])}</h2><p>${esc(f[1])}</p>`).join('')
      + `<h2>${esc(c.areas)}</h2>${prefList(l)}`;
    return layout({ l, title: c.homeTitle, desc: c.homeDesc, canonical: u.home(l), alts: { ja: u.home('ja'), en: u.home('en'), 'x-default': u.home('ja') }, body, ld });
  }

  function area(l, pid) {
    const p = prefs.get(pid);
    if (!p) return null;
    const c = COPY[l];
    const rows = spotsRaw().filter((s) => s.pref === pid);
    const pn = name(p, l);
    const items = rows.map((s) => `<li><a href="${u.spot(l, s.id)}">${esc(name(s, l))}</a> <small>(${esc(TYPE[s.type] ? TYPE[s.type][l] : '')})</small></li>`).join('');
    const ld = [
      { '@context': 'https://schema.org', '@type': 'BreadcrumbList', itemListElement: [
        { '@type': 'ListItem', position: 1, name: c.brand, item: u.home(l) }, { '@type': 'ListItem', position: 2, name: c.spotsIn(pn), item: u.area(l, pid) }] }
    ];
    const body = `<p><a href="${u.home(l)}">${c.home}</a> › ${esc(pn)}</p><h1>${esc(c.spotsIn(pn))}</h1><ul>${items}</ul><p><a class="btn" href="/">${c.open}</a></p>`;
    return layout({ l, title: c.areaTitle(pn), desc: c.areaDesc(pn, rows.length), canonical: u.area(l, pid), alts: { ja: u.area('ja', pid), en: u.area('en', pid), 'x-default': u.area('ja', pid) }, body, ld });
  }

  function spot(l, id) {
    const s = q('SELECT id,en,ja,type,pref,lat,lng FROM spots WHERE id=? AND active=1').get(id);
    if (!s) return null;
    const p = prefs.get(s.pref), c = COPY[l];
    const sn = name(s, l), pn = p ? name(p, l) : '', tn = TYPE[s.type] ? TYPE[s.type][l] : '';
    const near = q('SELECT id,en,ja FROM spots WHERE active=1 AND pref=? AND id<>? ORDER BY en LIMIT 12').all(s.pref, s.id);
    const hasGeo = typeof s.lat === 'number' && typeof s.lng === 'number';
    const ld = [
      { '@context': 'https://schema.org', '@type': 'BreadcrumbList', itemListElement: [
        { '@type': 'ListItem', position: 1, name: c.brand, item: u.home(l) },
        { '@type': 'ListItem', position: 2, name: c.spotsIn(pn), item: u.area(l, s.pref) },
        { '@type': 'ListItem', position: 3, name: sn, item: u.spot(l, s.id) }] },
      { '@context': 'https://schema.org', '@type': 'Place', name: sn, alternateName: name(s, other(l)), url: u.spot(l, s.id),
        address: { '@type': 'PostalAddress', addressRegion: pn, addressCountry: 'JP' },
        ...(hasGeo ? { geo: { '@type': 'GeoCoordinates', latitude: s.lat, longitude: s.lng } } : {}) }
    ];
    const body = `<p><a href="${u.home(l)}">${c.home}</a> › <a href="${u.area(l, s.pref)}">${esc(pn)}</a> › ${esc(sn)}</p>`
      + `<h1>${esc(l === 'ja' ? sn + '(' + pn + ')の釣り場' : sn + ' fishing spot, ' + pn)}</h1>`
      + `<p>${esc(name(s, other(l)))}</p>`
      + `<ul><li>${c.pref}: <a href="${u.area(l, s.pref)}">${esc(pn)}</a></li><li>${c.type}: ${esc(tn)}</li>`
      + (hasGeo ? `<li><a href="https://www.openstreetmap.org/?mlat=${s.lat}&amp;mlon=${s.lng}#map=14/${s.lat}/${s.lng}" rel="noopener">${c.map}</a></li>` : '') + '</ul>'
      + `<h2>${c.join}</h2><p>${esc(c.joinText)}</p><p><a class="btn" href="/">${c.open}</a></p>`
      + (near.length ? `<h2>${c.nearby}</h2><ul class="cols">${near.map((n) => `<li><a href="${u.spot(l, n.id)}">${esc(name(n, l))}</a></li>`).join('')}</ul>` : '');
    return layout({ l, title: c.spotTitle(sn, pn), desc: c.spotDesc(sn, pn, tn), canonical: u.spot(l, s.id), alts: { ja: u.spot('ja', s.id), en: u.spot('en', s.id), 'x-default': u.spot('ja', s.id) }, body, ld });
  }

  function sitemap() {
    const alt = (fn) => ['ja', 'en'].map((l) => `<xhtml:link rel="alternate" hreflang="${l}" href="${esc(fn(l))}"/>`).join('') + `<xhtml:link rel="alternate" hreflang="x-default" href="${esc(fn('ja'))}"/>`;
    const entry = (fn, l) => `<url><loc>${esc(fn(l))}</loc>${alt(fn)}</url>`;
    const out = [];
    for (const l of ['ja', 'en']) out.push(entry(u.home, l));
    for (const p of D.PREFS) for (const l of ['ja', 'en']) out.push(entry((x) => u.area(x, p.id), l));
    for (const s of spotsRaw()) for (const l of ['ja', 'en']) out.push(entry((x) => u.spot(x, s.id), l));
    return '<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9" xmlns:xhtml="http://www.w3.org/1999/xhtml">\n' + out.join('\n') + '\n</urlset>\n';
  }

  const robots = () => `User-agent: *\nAllow: /\nDisallow: /api/\nDisallow: /uploads/\n\nSitemap: ${base}/sitemap.xml\n`;

  /* Returns { type, body, cache } for a public SEO path, null if the path is not one of ours. 404 pages return { status: 404 }. */
  function handle(p) {
    if (p === '/robots.txt') return { type: 'text/plain; charset=utf-8', body: robots(), cache: 'public, max-age=3600' };
    if (p === '/sitemap.xml') return { type: 'application/xml; charset=utf-8', body: sitemap(), cache: 'public, max-age=3600' };
    const m = /^\/(ja|en)(?:\/(?:(area|spot)\/([^/]+))?)?$/.exec(p);
    if (!m) return null;
    const l = m[1];
    const html = (b) => (b ? { type: 'text/html; charset=utf-8', body: b, cache: 'public, max-age=3600' } : { status: 404 });
    if (!m[2]) return html(home(l));
    return html(m[2] === 'area' ? area(l, m[3]) : spot(l, m[3]));
  }
  return { handle };
}

module.exports = { createSeo };
