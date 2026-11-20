'use strict';
/*
 * Live tide and weather for a spot.
 *  - Tide: official JMA (Japan Meteorological Agency) tide-table predictions for the nearest station (hourly levels + high/low times).
 *  - Weather: Open-Meteo forecast (temperature, weather code, wind, sunrise/sunset). Free, no API key.
 * Both are cached (JMA yearly files on disk, weather in memory) and every call has a timeout.
 */
const fs = require('node:fs');
const path = require('node:path');
const STATIONS = require('./stations.js');

const JMA_URL = (year, code) => `https://www.data.jma.go.jp/kaiyou/data/db/tide/suisan/txt/${year}/${code}.txt`;
const WX_URL = (lat, lng) => 'https://api.open-meteo.com/v1/forecast?latitude=' + lat + '&longitude=' + lng +
  '&hourly=temperature_2m,weather_code,wind_speed_10m,wind_direction_10m&daily=sunrise,sunset&wind_speed_unit=ms&timezone=Asia%2FTokyo&forecast_days=7';

/* A few spots face a different coast than their nearest station. */
const STATION_OVERRIDE = { kujukuri: 'ZF' };
const MAX_STATION_KM = 120;
const JST_MS = 9 * 3600 * 1000;

function km(la1, ln1, la2, ln2) {
  const r = Math.PI / 180, x = (ln2 - ln1) * r * Math.cos(((la1 + la2) / 2) * r), y = (la2 - la1) * r;
  return 6371 * Math.hypot(x, y);
}
function nearestStation(lat, lng, spotId) {
  if (spotId && STATION_OVERRIDE[spotId]) {
    const s = STATIONS.find((t) => t[0] === STATION_OVERRIDE[spotId]);
    if (s) return { code: s[0], name: s[1], km: Math.round(km(lat, lng, s[2], s[3])) };
  }
  let best = null;
  for (const s of STATIONS) {
    const d = km(lat, lng, s[2], s[3]);
    if (!best || d < best.d) best = { d, s };
  }
  if (!best || best.d > MAX_STATION_KM) return null;
  return { code: best.s[0], name: best.s[1], km: Math.round(best.d) };
}

/* Parse a JMA yearly hourly text file into { 'YYYY-MM-DD': { hourly:[24], highs:[{m,h}], lows:[{m,h}] } }. */
function parseJma(text) {
  const out = {};
  for (const line of String(text).split(/\r?\n/)) {
    if (line.length < 80) continue;
    const hourly = [];
    for (let i = 0; i < 24; i++) hourly.push(parseInt(line.slice(i * 3, i * 3 + 3), 10));
    const yy = parseInt(line.slice(72, 74), 10), mm = parseInt(line.slice(74, 76), 10), dd = parseInt(line.slice(76, 78), 10);
    if (hourly.some(Number.isNaN) || [yy, mm, dd].some(Number.isNaN)) continue;
    const ext = (from) => {
      const list = [];
      for (let i = 0; i < 4; i++) {
        const slot = line.slice(from + i * 7, from + i * 7 + 7);
        if (slot.length < 7) break;
        const t = slot.slice(0, 4), h = slot.slice(4, 7);
        if (t === '9999' || h === '999' || !/^\d{4}$/.test(t)) continue;
        const m = parseInt(t.slice(0, 2), 10) * 60 + parseInt(t.slice(2), 10), hv = parseInt(h, 10);
        if (!Number.isNaN(hv) && m < 1440) list.push({ m, h: hv });
      }
      return list;
    };
    const date = `${2000 + yy}-${String(mm).padStart(2, '0')}-${String(dd).padStart(2, '0')}`;
    out[date] = { hourly, highs: ext(80), lows: ext(108) };
  }
  return out;
}

function jstDate(offsetDays, now) {
  return new Date(now + JST_MS + offsetDays * 86400000).toISOString().slice(0, 10);
}
const toMin = (iso) => parseInt(iso.slice(11, 13), 10) * 60 + parseInt(iso.slice(14, 16), 10);

function createForecaster({ dataDir, fetchText, now = () => Date.now(), timeoutMs = 8000, log = () => {} }) {
  const cacheDir = path.join(dataDir, 'cache');
  fs.mkdirSync(cacheDir, { recursive: true });
  const years = new Map();     // 'YYYY-CODE' -> { data, at } (in memory)
  const failed = new Map();    // key -> until (negative cache so a down service is not hammered)
  const wxCache = new Map();   // 'lat,lng' -> { data, at }
  const inflight = new Map();

  async function get(url) {
    const ctrl = new AbortController(), timer = setTimeout(() => ctrl.abort(), timeoutMs);
    try { return await fetchText(url, ctrl.signal); } finally { clearTimeout(timer); }
  }
  function once(key, fn) {
    if (inflight.has(key)) return inflight.get(key);
    const p = fn().finally(() => inflight.delete(key));
    inflight.set(key, p);
    return p;
  }

  async function jmaYear(year, code) {
    const key = year + '-' + code;
    const mem = years.get(key);
    if (mem) return mem;
    const file = path.join(cacheDir, `jma-${key}.txt`);
    try {
      const txt = fs.readFileSync(file, 'utf8');
      const data = parseJma(txt);
      if (Object.keys(data).length > 300) { years.set(key, data); return data; }
    } catch (_) { /* not cached yet */ }
    if ((failed.get(key) || 0) > now()) return null;
    return once('jma' + key, async () => {
      try {
        const txt = await get(JMA_URL(year, code));
        const data = parseJma(txt);
        if (Object.keys(data).length < 300) throw new Error('unexpected JMA file');
        fs.writeFileSync(file, txt);
        years.set(key, data);
        return data;
      } catch (e) {
        log('JMA ' + key + ': ' + e.message);
        failed.set(key, now() + 10 * 60000);
        return null;
      }
    });
  }

  async function weather(lat, lng) {
    const key = lat.toFixed(1) + ',' + lng.toFixed(1);
    const c = wxCache.get(key);
    if (c && now() - c.at < 30 * 60000) return c.data;
    if ((failed.get('wx' + key) || 0) > now()) return c ? c.data : null;
    return once('wx' + key, async () => {
      try {
        const j = JSON.parse(await get(WX_URL(lat.toFixed(2), lng.toFixed(2))));
        const h = j.hourly, d = j.daily;
        if (!h || !d || !Array.isArray(h.time) || h.time.length < 24) throw new Error('unexpected weather response');
        const days = [];
        for (let i = 0; i < d.time.length; i++) {
          const sl = (arr) => arr.slice(i * 24, i * 24 + 24).map((v) => (v == null ? null : Number(v)));
          days.push({
            date: d.time[i], sr: toMin(d.sunrise[i]), ss: toMin(d.sunset[i]),
            temp: sl(h.temperature_2m), code: sl(h.weather_code), wind: sl(h.wind_speed_10m), dir: sl(h.wind_direction_10m)
          });
        }
        const data = { days };
        wxCache.set(key, { data, at: now() });
        return data;
      } catch (e) {
        log('weather ' + key + ': ' + e.message);
        failed.set('wx' + key, now() + 2 * 60000);
        return c ? c.data : null;
      }
    });
  }

  async function tide(spot, dates) {
    if (spot.type === 'f') return { na: 'freshwater' };
    const st = nearestStation(spot.lat, spot.lng, spot.id);
    if (!st) return { na: 'no_station' };
    const need = [...new Set(dates.concat(jstDate(7, now())).map((d) => d.slice(0, 4)))];
    const maps = {};
    for (const y of need) maps[y] = await jmaYear(y, st.code);
    const days = [];
    for (let i = 0; i < dates.length; i++) {
      const d = dates[i], row = maps[d.slice(0, 4)] && maps[d.slice(0, 4)][d];
      if (!row) return days.length ? { station: st, days, partial: true } : { error: true, station: st };
      const nextDate = jstDate(i + 1, now()), nrow = maps[nextDate.slice(0, 4)] && maps[nextDate.slice(0, 4)][nextDate];
      days.push({ date: d, hourly: row.hourly, next0: nrow ? nrow.hourly[0] : null, highs: row.highs, lows: row.lows });
    }
    return { station: st, days };
  }

  async function forecast(spot) {
    const dates = [];
    for (let i = 0; i < 7; i++) dates.push(jstDate(i, now()));
    const hasCoords = typeof spot.lat === 'number' && typeof spot.lng === 'number';
    if (!hasCoords) return { id: spot.id, error: 'no_coordinates', tide: null, weather: null, generated: new Date(now()).toISOString() };
    const [t, w] = await Promise.all([tide(spot, dates), weather(spot.lat, spot.lng)]);
    return { id: spot.id, dates, tide: t, weather: w, generated: new Date(now()).toISOString() };
  }

  return { forecast, parseJma, nearestStation };
}

module.exports = { createForecaster, parseJma, nearestStation, km, JMA_URL, WX_URL };
