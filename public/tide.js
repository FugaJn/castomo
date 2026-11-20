/* Sample tide, sun and weather model. FALLBACK ONLY: the home page uses it when the live forecast (JMA tide + Open-Meteo,
   served by /api/forecast/:spot) cannot be loaded, and says so on screen. tideIdx() (spring/neap name from the moon's age) is real astronomy. */
(function () {
  'use strict';
  var D = window.CAST;
  var BASE = Date.UTC(2025, 11, 31, 15);
  function pad(n) { return String(n).padStart(2, '0'); }
  function today0() { var d = new Date(); return new Date(d.getFullYear(), d.getMonth(), d.getDate()); }
  function dayAt(off) { var d = today0(); return new Date(d.getFullYear(), d.getMonth(), d.getDate() + off); }
  function height(sp, ms) {
    var t = (ms - BASE) / 36e5, w = 2 * Math.PI;
    return sp.mean + sp.a * (Math.cos(w * t / 12.4206 - sp.p) + 0.38 * Math.cos(w * t / 12 - sp.p2) + 0.28 * Math.cos(w * t / 24.0658 - sp.p3));
  }
  var SR = [418, 402, 371, 334, 305, 286, 295, 317, 341, 363, 385, 412], SSN = [1027, 1056, 1080, 1103, 1127, 1147, 1150, 1128, 1091, 1050, 1016, 1006];
  function sunTimes(d) {
    var pos = d.getMonth() + (d.getDate() - 15) / 30, i = Math.floor(pos), f = pos - i;
    var a = ((i % 12) + 12) % 12, b = (a + 1) % 12;
    return { sr: SR[a] + (SR[b] - SR[a]) * f, ss: SSN[a] + (SSN[b] - SSN[a]) * f };
  }
  function tideIdx(ms) {
    var age = (((ms - Date.UTC(2000, 0, 6, 18, 14)) / 864e5) % 29.530588 + 29.530588) % 29.530588;
    var m = (age + 1) % 14.765;
    if (m < 2.9) return 0; if (m < 6.9) return 1; if (m < 9.9) return 2; if (m < 10.9) return 3; if (m < 11.9) return 4; return 1;
  }
  function weather(sp, d) {
    var r = D.rng(D.hash(sp.id) + Math.floor(d.getTime() / 864e5) * 7919);
    var baseT = 11 + r() * 6, cloud = r(), wb = 1.5 + r() * 5.5, wd = r() * 360, rainDay = r() < 0.28, rs = Math.floor(r() * 14) + 4, sun = sunTimes(d), out = [];
    for (var h = 0; h < 24; h++) {
      var temp = baseT + 4 * Math.sin(2 * Math.PI * (h - 9) / 24) + (r() - .5);
      var ws = Math.max(0.3, wb * (0.85 + 0.4 * Math.sin(2 * Math.PI * (h - 8) / 24)) + (r() - .4) * 1.2);
      var cl = Math.min(1, Math.max(0, cloud + 0.25 * Math.sin(h / 3.1) + (r() - .5) * .25));
      var night = h * 60 + 30 < sun.sr || h * 60 + 30 > sun.ss;
      var g = (rainDay && h >= rs && h < rs + 4) ? '☂︎' : cl < .35 ? (night ? '☾' : '☀︎') : cl < .75 ? '⛅︎' : '☁︎';
      out.push({ t: temp, w: ws, d: (wd + h * 4) % 360, g: g });
    }
    return out;
  }
  function dayData(sp, off) {
    var start = dayAt(off), ms0 = start.getTime();
    var H = function (m) { return height(sp, ms0 + m * 6e4); };
    var curve = [], m;
    for (m = 0; m <= 1440; m += 10) curve.push([m, H(m)]);
    var ext = [], prev = H(-5), cur = H(0), nx;
    for (m = 0; m <= 1440; m += 5) {
      nx = H(m + 5);
      if (m < 1440) {
        if (cur > prev && cur >= nx) ext.push({ m: m, h: cur, hi: true });
        else if (cur < prev && cur <= nx) ext.push({ m: m, h: cur, hi: false });
      }
      prev = cur; cur = nx;
    }
    var s = sunTimes(start);
    return { start: start, ms0: ms0, H: H, curve: curve, ext: ext, sr: s.sr, ss: s.ss, tn: tideIdx(ms0 + 12 * 36e5), wx: weather(sp, start) };
  }
  window.TIDE = { dayAt: dayAt, today0: today0, dayData: dayData, tideIdx: tideIdx, pad: pad };
})();
