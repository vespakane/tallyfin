/* Amazon Seller home clone – data model, daily backlog, simulation engine and rendering. */
(function () {
  "use strict";

  const KEY = "amzseller.v2";
  const OLD_KEY = "amzseller.v1";
  const $ = (s) => document.querySelector(s);
  const phone = $("#phone");

  /* ------------------------------------------------------------------ */
  /* Deterministic randomness: one seed per calendar unit, so nothing that
     has been shown ever reshuffles – it only rescales.                   */
  function hash(str) {
    let h1 = 0xdeadbeef ^ 7, h2 = 0x41c6ce57 ^ 7;
    for (let i = 0; i < str.length; i++) {
      const ch = str.charCodeAt(i);
      h1 = Math.imul(h1 ^ ch, 2654435761);
      h2 = Math.imul(h2 ^ ch, 1597334677);
    }
    h1 = Math.imul(h1 ^ (h1 >>> 16), 2246822507) ^ Math.imul(h2 ^ (h2 >>> 13), 3266489909);
    h2 = Math.imul(h2 ^ (h2 >>> 16), 2246822507) ^ Math.imul(h1 ^ (h1 >>> 13), 3266489909);
    return 4294967296 * (2097151 & h2) + (h1 >>> 0);
  }
  function rng(seedStr) {
    let a = hash(seedStr) >>> 0;
    return function () {
      a |= 0; a = (a + 0x6D2B79F5) | 0;
      let t = Math.imul(a ^ (a >>> 15), 1 | a);
      t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  }
  function gauss(r) { const u = Math.max(r(), 1e-9), v = r(); return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v); }
  function lognormal(r, sigma) { return Math.exp(sigma * gauss(r) - (sigma * sigma) / 2); }
  function between(r, a, b) { return a + (b - a) * r(); }
  function poisson(r, lambda) { let L = Math.exp(-lambda), k = 0, p = 1; do { k++; p *= r(); } while (p > L); return k - 1; }

  /* ------------------------------------------------------------------ */
  /* Dates */
  const DAY = 86400000;
  const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
  function ymd(d) { return d.getFullYear() + "-" + String(d.getMonth() + 1).padStart(2, "0") + "-" + String(d.getDate()).padStart(2, "0"); }
  function parseYmd(s) { const p = s.split("-").map(Number); return new Date(p[0], p[1] - 1, p[2]); }
  function startOfDay(d) { return new Date(d.getFullYear(), d.getMonth(), d.getDate()); }
  function addDays(d, n) { return new Date(d.getFullYear(), d.getMonth(), d.getDate() + n); }
  function daysBetween(a, b) { return Math.round((startOfDay(b) - startOfDay(a)) / DAY); }
  function daysInMonth(y, m) { return new Date(y, m + 1, 0).getDate(); }
  function isoDow(d) { return (d.getDay() + 6) % 7; } // Mon = 0
  function niceDate(s) { const d = parseYmd(s); return d.getDate() + " " + MONTHS[d.getMonth()]; }

  /* ------------------------------------------------------------------ */
  /* Behavioural shape: hour-of-day, day-of-week and month-of-year weights. */
  const HOUR_BASE = [0.55, 0.32, 0.18, 0.12, 0.10, 0.14, 0.32, 0.62, 0.95, 1.25, 1.40, 1.45, 1.40, 1.30, 1.25, 1.25, 1.30, 1.35, 1.40, 1.45, 1.50, 1.35, 1.10, 0.80];
  const DOW_BASE = [1.08, 1.05, 1.00, 0.98, 0.92, 0.90, 1.07]; // Mon..Sun
  const MONTH_BASE = [0.85, 0.80, 0.90, 0.90, 0.95, 0.95, 1.00, 0.90, 0.95, 1.05, 1.35, 1.30];
  const seasonOf = (d) => DOW_BASE[isoDow(d)] * MONTH_BASE[d.getMonth()];

  function dayWeight(date) {
    const r = rng("day:" + ymd(date));
    let w = seasonOf(date) * lognormal(r, 0.32);
    if (r() < 0.06) w *= between(r, 1.4, 2.1);      // the odd spike
    if (r() < 0.04) w *= between(r, 0.35, 0.6);     // and the odd quiet day
    return w;
  }
  /* Each day has its own hourly shape: noise that drifts over a few hours instead of jittering, and on
     some days a sell-out, a cheaper-at-night price, a rush, a lull or a burst of orders. `factor` is how
     much those events add to or take from the day's total.                                            */
  const shapes = {};
  function dayShape(date) {
    const key = ymd(date);
    if (shapes[key]) return shapes[key];
    const r = rng("hours:" + key);
    const plain = [];
    let z = 0;
    for (let h = 0; h < 24; h++) { z = 0.7 * z + 0.28 * gauss(r); plain[h] = HOUR_BASE[h] * Math.exp(z) * lognormal(r, 0.25); }
    const w = plain.slice();
    const mul = (from, to, f) => { for (let h = from; h < to; h++) w[h % 24] *= f; };
    const pick = (a, b) => Math.floor(between(r, a, b + 1));
    if (r() < 0.25) mul(21, 27, between(r, 1.6, 2.8));                                          // price is best at night
    if (r() < 0.1) { const s = pick(9, 21); mul(s, r() < 0.4 ? Math.min(s + pick(2, 6), 24) : 24, between(r, 0.03, 0.15)); } // sells out, sometimes restocked
    if (r() < 0.18) { const s = pick(7, 19); mul(s, s + pick(2, 3), between(r, 1.8, 3)); }         // a rush
    if (r() < 0.22) { const s = pick(8, 19); mul(s, s + pick(2, 4), between(r, 0.25, 0.55)); }     // a lull
    if (r() < 0.2) w[pick(7, 23)] *= between(r, 1.8, 3);                                         // a burst of orders
    for (let h = 0; h < 24; h++) if (r() < 0.06) w[h] *= between(r, 0.05, 0.3);                  // dead hours
    const sp = plain.reduce((a, b) => a + b, 0), sw = w.reduce((a, b) => a + b, 0);
    return (shapes[key] = { w, factor: Math.min(Math.max(sw / sp, 0.3), 1.8) });
  }
  /* fraction of a day's sales that have happened by `now`, for the given hourly shape */
  function dayFraction(now, w) {
    w = w || HOUR_BASE;
    const h = now.getHours(), m = now.getMinutes();
    const total = w.reduce((a, b) => a + b, 0);
    let done = 0;
    for (let i = 0; i < h; i++) done += w[i];
    done += w[h] * (m / 60);
    return Math.max(done / total, 0.02);
  }

  /* ------------------------------------------------------------------ */
  /* Storage.
     days[ymd] = { sales, orders, src: "entered" | "sim", ev }
     periods   = totals entered for the windows ending on periods.asOf
     auto      = whether the balance / the feedback card is simulated; manual holds the figures shown when it is not */
  const DEFAULTS = {
    days: {},
    periods: { d7: null, d30: null, month: null, year: null, lastYear: null, asOf: null },
    ordersCard: { pending: null, undispatched: null, dispatched: null },
    misc: { messages: null, ipi: null, deal: null, voucher: null },
    auto: { balance: true, feedback: true },
    manual: { balance: null, fbAvg: null, fbNeg: null, fbPos: null, fbNeu: null },
    sim: false,
    simSince: null
  };
  function num(v) { if (v == null || v === "") return null; const n = parseFloat(String(v).replace(/[£,\s]/g, "")); return isNaN(n) ? null : n; }
  function load() {
    try {
      const raw = localStorage.getItem(KEY);
      if (raw) {
        const s = JSON.parse(raw);
        return Object.assign(JSON.parse(JSON.stringify(DEFAULTS)), s, {
          days: s.days || {},
          periods: Object.assign({}, DEFAULTS.periods, s.periods),
          ordersCard: Object.assign({}, DEFAULTS.ordersCard, s.ordersCard),
          misc: Object.assign({}, DEFAULTS.misc, s.misc),
          auto: Object.assign({}, DEFAULTS.auto, s.auto),
          manual: s.manual ? Object.assign({}, DEFAULTS.manual, s.manual) : null
        });
      }
      // migrate the first version (single "today" record)
      const old = localStorage.getItem(OLD_KEY);
      if (old) {
        const o = JSON.parse(old), st = JSON.parse(JSON.stringify(DEFAULTS));
        const day = o.savedAt || ymd(new Date());
        if (o.today && (o.today.sales != null || o.today.orders != null)) {
          st.days[day] = { sales: num(o.today.sales), orders: num(o.today.orders), balance: num(o.today.balance),
            fbAvg: num(o.feedback && o.feedback.avg), fbNeg: num(o.feedback && o.feedback.neg), fbPos: num(o.feedback && o.feedback.pos), fbNeu: num(o.feedback && o.feedback.neu), src: "entered" };
        }
        if (o.periods) st.periods = Object.assign(st.periods, o.periods, { asOf: day });
        if (o.ordersCard) st.ordersCard = Object.assign(st.ordersCard, o.ordersCard);
        if (o.misc) st.misc = Object.assign(st.misc, o.misc);
        st.manual = null;
        return st;
      }
    } catch (e) {}
    return JSON.parse(JSON.stringify(DEFAULTS));
  }
  let save = function () { try { localStorage.setItem(KEY, JSON.stringify(state)); } catch (e) {} };
  let state = load();
  let range = "today";

  const enteredDays = () => Object.keys(state.days).filter((k) => state.days[k].src === "entered").sort();
  function latestEntered(field, upTo) {
    let best = null;
    for (const k of Object.keys(state.days)) {
      const d = state.days[k];
      if (d.src !== "entered" || d[field] == null) continue;
      if (upTo && k > upTo) continue;
      if (!best || k > best.date) best = { date: k, value: d[field] };
    }
    return best;
  }
  if (!state.manual) {   // balance and feedback used to be stored per day: keep the latest of each as the manual figure
    state.manual = {};
    for (const f of Object.keys(DEFAULTS.manual)) { const e = latestEntered(f); state.manual[f] = e ? e.value : null; }
  }

  /* ------------------------------------------------------------------ */
  /* Simulation of one day from the history that precedes it.            */
  function simulateDay(date, history, prevEv) {
    // history: [{date, sales}] chronological, deseasonalised inside
    const r = rng("sim:" + ymd(date));
    const recent = history.slice(-28);
    let base = 0, growth = 1;
    if (recent.length) {
      const de = recent.map((h) => ({ i: daysBetween(h.date, date), v: h.sales / seasonOf(h.date) }));
      const last14 = de.slice(-14);
      const m14 = last14.reduce((a, b) => a + b.v, 0) / last14.length;
      const m28 = de.reduce((a, b) => a + b.v, 0) / de.length;
      base = 0.7 * m14 + 0.3 * m28;   // recent level, gently anchored to the longer run
      if (de.length >= 10) {
        // least squares on log values against days-ago (negative index)
        const pts = de.filter((p) => p.v > 0).map((p) => [-p.i, Math.log(p.v)]);
        const n = pts.length, sx = pts.reduce((a, p) => a + p[0], 0), sy = pts.reduce((a, p) => a + p[1], 0);
        const sxx = pts.reduce((a, p) => a + p[0] * p[0], 0), sxy = pts.reduce((a, p) => a + p[0] * p[1], 0);
        const slope = (n * sxy - sx * sy) / Math.max(n * sxx - sx * sx, 1e-9);
        growth = Math.min(1.005, Math.max(0.995, Math.exp(slope)));   // trend continues, but never runs away
      }
    }
    const gap = recent.length ? daysBetween(recent[recent.length - 1].date, date) : 1;
    // events: stock-outs, supply issues, cash-flow squeezes, promotions
    let ev = prevEv && prevEv.remaining > 0 ? { type: prevEv.type, remaining: prevEv.remaining - 1, factor: prevEv.factor } : null;
    let factor = 1, recovery = 1;
    if (ev) factor = ev.factor;
    else {
      if (prevEv && prevEv.remaining === 0 && (prevEv.type === "stockout" || prevEv.type === "supply")) recovery = between(r, 1.1, 1.35); // backlog of demand
      const u = r();
      if (u < 0.018) ev = { type: "stockout", remaining: Math.floor(between(r, 2, 7)), factor: between(r, 0.08, 0.35) };
      else if (u < 0.05) ev = { type: "supply", remaining: Math.floor(between(r, 1, 4)), factor: between(r, 0.55, 0.8) };
      else if (u < 0.065) ev = { type: "cash", remaining: Math.floor(between(r, 3, 8)), factor: between(r, 0.45, 0.7) };
      else if (u < 0.095) ev = { type: "promo", remaining: Math.floor(between(r, 1, 3)), factor: between(r, 1.4, 2.1) };
      else if (u < 0.12) ev = { type: "dip", remaining: 0, factor: between(r, 0.7, 0.85) };
      if (ev) { ev.remaining -= 1; factor = ev.factor; }
    }
    const plain = base * Math.pow(growth, gap) * seasonOf(date) * lognormal(r, 0.22);
    const sales = plain * dayShape(date).factor * factor * recovery;
    return { sales: Math.round(sales * 100) / 100, plain, ev: ev && ev.remaining >= 0 ? ev : null, eventType: ev ? ev.type : null };
  }

  /* A figure entered during its own day is "sales so far" at that moment; the rest of the day keeps
     simulating. The forecast for the day is pulled towards what was entered, more so the later it was. */
  function entryTime(rec, key) {
    return rec && rec.src === "entered" && rec.sales != null && rec.at && ymd(new Date(rec.at)) === key ? new Date(rec.at) : null;
  }
  function completeDay(key, entered, at, forecast) {
    const shape = dayShape(at);
    const fAt = Math.min(dayFraction(at, shape.w), 0.999);
    const F = forecast > 0 ? forecast * shape.factor : entered / fAt;
    const ratio = F > 0 ? Math.pow(Math.max(entered / (F * fAt), 0.05), fAt / (fAt + 0.2)) : 0;
    const rest = Math.round(F * ratio * (1 - fAt) * lognormal(rng("rest:" + key), 0.12) * 100) / 100;
    return { entered, at, fAt, rest, full: Math.round((entered + rest) * 100) / 100 };
  }

  /* ------------------------------------------------------------------ */
  /* The daily series. Index 0 = 1 January of last year … last = today.  */
  function buildModel(now) {
    const today = startOfDay(now), todayKey = ymd(today);
    const y = today.getFullYear();
    const first = new Date(y - 1, 0, 1);
    const n = daysBetween(first, today) + 1;
    const dates = new Array(n), weights = new Array(n);
    for (let i = 0; i < n; i++) { dates[i] = addDays(first, i); weights[i] = dayWeight(dates[i]); }
    const last = n - 1;
    const dom = today.getDate();
    const doy = daysBetween(new Date(y, 0, 1), today) + 1;
    const frac = dayFraction(now, dayShape(today).w);
    const fracPrev = dayFraction(now, dayShape(addDays(today, -1)).w);   // yesterday by this time
    const idx = (key) => daysBetween(first, parseYmd(key));

    // Anchor: the day the period totals refer to (or the first entered day, or today)
    const entered = enteredDays();
    const anchorKey = state.periods.asOf || entered[0] || todayKey;
    const A = Math.min(Math.max(idx(anchorKey), 0), last);
    const anchorRec = state.days[anchorKey];
    const T0 = anchorRec && anchorRec.sales != null ? anchorRec.sales : null;
    const anchorAt = entryTime(anchorRec, anchorKey);
    const anchorFrac = anchorAt ? dayFraction(anchorAt, dayShape(anchorAt).w) : A === last ? frac : 1;   // period totals are as of that moment

    // ---- 1. Days up to the anchor: nested windows ending on the anchor ----
    const aDate = dates[A], aDom = aDate.getDate(), aDoy = daysBetween(new Date(aDate.getFullYear(), 0, 1), aDate) + 1;
    const win = [
      { id: "today", start: A, total: T0, entered: T0 != null },
      { id: "d7", start: A - 6, total: num(state.periods.d7), entered: state.periods.d7 != null },
      { id: "month", start: A - (aDom - 1), total: num(state.periods.month), entered: state.periods.month != null },
      { id: "d30", start: A - 29, total: num(state.periods.d30), entered: state.periods.d30 != null },
      { id: "year", start: A - (aDoy - 1), total: num(state.periods.year), entered: state.periods.year != null },
      { id: "lastYear", start: 0, total: null, entered: false, extra: num(state.periods.lastYear) }
    ];
    win.sort((a, b) => b.start - a.start);
    const rateR = rng("rate:" + anchorKey);
    let rate = T0 ? T0 / anchorFrac : 0;
    if (!rate) { // no anchor total: take the average of the entered days instead
      const vals = entered.map((k) => state.days[k].sales).filter((v) => v != null);
      rate = vals.length ? vals.reduce((a, b) => a + b, 0) / vals.length : 0;
    }
    let prevTotal = 0, prevStart = A + 1;
    for (const w of win) {
      const ringDays = prevStart - w.start;
      if (w.id === "lastYear") {
        const ly = w.extra != null ? w.extra : Math.round(prevTotal / Math.max(aDoy / 365, 0.05) * between(rateR, 0.55, 0.8) * 100) / 100;
        w.total = prevTotal + ly;
      } else if (!w.entered) {
        w.total = ringDays <= 0 ? prevTotal : Math.round((prevTotal + rate * ringDays * between(rateR, 0.82, 1.12)) * 100) / 100;
      }
      if (w.total < prevTotal - 0.005) w.total = prevTotal;
      const span = A + 1 - w.start - 1 + anchorFrac;
      if (w.entered && span > 0.3) rate = w.total / span;
      w.ringDays = ringDays; w.ringSum = w.total - prevTotal; w.prevStart = prevStart;
      prevTotal = w.total; prevStart = w.start;
    }
    const sales = new Array(n).fill(0);
    const fixed = new Array(n).fill(false);
    const comp = {};   // index -> completion of a day entered part-way through
    for (const k of entered) {
      const i = idx(k), rec = state.days[k];
      if (i < 0 || i > A || rec.sales == null) continue;
      const at = i < A ? entryTime(rec, k) : null;
      if (at) comp[i] = completeDay(k, rec.sales, at, rate);
      sales[i] = at ? comp[i].full : rec.sales; fixed[i] = true;
    }
    for (const w of win) {
      if (w.ringDays <= 0) continue;
      let sw = 0, fixedSum = 0;
      for (let i = w.start; i < w.prevStart; i++) { if (fixed[i]) fixedSum += sales[i]; else sw += weights[i]; }
      const rest = Math.max(w.ringSum - fixedSum, 0);
      let acc = 0, maxI = -1;
      for (let i = w.start; i < w.prevStart; i++) {
        if (fixed[i]) continue;
        const v = sw > 0 ? Math.round((rest * weights[i] / sw) * 100) / 100 : 0;
        sales[i] = v; acc += v;
        if (maxI < 0 || weights[i] > weights[maxI]) maxI = i;
      }
      if (maxI >= 0) sales[maxI] = Math.round((sales[maxI] + (rest - acc)) * 100) / 100;
    }

    // ---- 2. Days after the anchor: entered, frozen, or simulated (and frozen once past) ----
    const eventsToday = { type: null };
    let changed = false;
    let history = [];
    for (let i = Math.max(0, A - 60); i < A; i++) history.push({ date: dates[i], sales: sales[i] });
    if (anchorAt && T0 != null) { comp[A] = completeDay(anchorKey, T0, anchorAt, simulateDay(dates[A], history, null).plain); sales[A] = comp[A].full; }
    history.push({ date: dates[A], sales: sales[A] });
    let prevEv = anchorRec && anchorRec.ev ? anchorRec.ev : null;
    let simTodayTotal = null;
    for (let i = A + 1; i <= last; i++) {
      const key = ymd(dates[i]);
      const rec = state.days[key];
      const at = entryTime(rec, key);
      if (at) {
        comp[i] = completeDay(key, rec.sales, at, simulateDay(dates[i], history, null).plain);
        sales[i] = comp[i].full; fixed[i] = true; prevEv = null;
      } else if (rec && rec.sales != null && (rec.src === "entered" || rec.src === "sim")) {
        sales[i] = rec.sales; fixed[i] = rec.src === "entered";
        prevEv = rec.ev || null;
        if (i === last && rec.src === "sim") { simTodayTotal = rec.sales; eventsToday.type = rec.eventType || null; }
      } else {
        const s = simulateDay(dates[i], history, prevEv);
        prevEv = s.ev;
        if (i < last) {
          sales[i] = s.sales;
          state.days[key] = { sales: s.sales, src: "sim", ev: s.ev, eventType: s.eventType };   // freeze the backlog
          changed = true;
        } else {
          simTodayTotal = s.sales; eventsToday.type = s.eventType;
          sales[i] = s.sales;
        }
      }
      history.push({ date: dates[i], sales: sales[i] });
    }
    if (changed) save();

    // Today: what was entered plus the simulated sales since; otherwise the simulated full day scaled to the time of day
    const todayRec = state.days[todayKey];
    let todaySoFar, todayIsEntered = false;
    if (comp[last]) {
      const c = comp[last], since = Math.min(Math.max((frac - c.fAt) / (1 - c.fAt), 0), 1);
      todaySoFar = Math.round((c.entered + c.rest * since) * 100) / 100; todayIsEntered = true;
    }
    else if (todayRec && todayRec.src === "entered" && todayRec.sales != null) { todaySoFar = todayRec.sales; todayIsEntered = true; }
    else if (A === last) { todaySoFar = sales[last]; }
    else { todaySoFar = Math.round((simTodayTotal || sales[last]) * frac * 100) / 100; }
    sales[last] = todaySoFar;

    // ---- 3. Orders and units ----
    const aovRec = (() => { for (const k of entered.slice().reverse()) { const d = state.days[k]; if (d.sales > 0 && d.orders > 0) return d.sales / d.orders; } return null; })();
    const aov = aovRec || 15.77;
    const orders = new Array(n), units = new Array(n);
    for (let i = 0; i < n; i++) {
      const key = ymd(dates[i]), rec = state.days[key], r = rng("orders:" + key);
      if (rec && rec.src === "entered" && rec.orders != null) {
        orders[i] = rec.orders;
        const extra = comp[i] ? sales[i] - comp[i].entered : 0;   // orders keep coming in after the entry
        if (extra > 0) orders[i] += Math.round(extra / (aov * lognormal(r, 0.08)));
      }
      else orders[i] = sales[i] > 0 ? Math.max(1, Math.round(sales[i] / (aov * lognormal(r, 0.08)))) : 0;
      units[i] = orders[i] + Math.round(orders[i] * between(r, 0.012, 0.06));
    }

    // ---- 4. Today's hours ----
    const H = now.getHours();
    const hw = dayShape(today).w;
    const hourly = new Array(24).fill(null);
    const spread = (amount, from, to) => {   // share `amount` over the hours between two times of day
      const w = new Array(24).fill(0);
      let sw = 0;
      for (let h = Math.floor(from); h < 24 && h < to; h++) { w[h] = hw[h] * Math.max(Math.min(to, h + 1) - Math.max(from, h), 0); sw += w[h]; }
      if (!(sw > 0)) { w[Math.min(Math.floor(from), 23)] = 1; sw = 1; }
      let acc = 0, maxH = -1;
      for (let h = 0; h < 24; h++) {
        if (!(w[h] > 0)) continue;
        const v = Math.round(amount * w[h] / sw * 100) / 100;
        hourly[h] = (hourly[h] || 0) + v; acc += v; if (maxH < 0 || w[h] > w[maxH]) maxH = h;
      }
      hourly[maxH] = Math.round((hourly[maxH] + (amount - acc)) * 100) / 100;
    };
    if (todaySoFar > 0) {
      for (let h = 0; h <= H; h++) hourly[h] = 0;
      const nowH = H + Math.max(now.getMinutes(), 4) / 60;
      const c = comp[last];
      if (c) {
        const atH = Math.min(c.at.getHours() + c.at.getMinutes() / 60, nowH);
        spread(c.entered, 0, atH);
        if (todaySoFar > c.entered) spread(todaySoFar - c.entered, atH, nowH);
      } else spread(todaySoFar, 0, nowH);
    }

    // ---- 5. Balance: net sales are held until delivery + 7 days; whatever has unlocked is paid out daily ----
    let simBalance = 0;
    for (let age = 0; age <= 9; age++) {
      const i = last - age, r = rng("bal:" + ymd(dates[i]));
      const net = sales[i] * between(r, 0.7, 0.74);                    // after Amazon's fees
      const d1 = between(r, 0.3, 0.5), d3 = between(r, 0.1, 0.25);     // share delivered after one day / after three
      simBalance += net * (age <= 7 ? 1 : age === 8 ? 1 - d1 : d3);
    }
    simBalance = Math.round(simBalance * 100) / 100;

    // ---- 6. Feedback: a drifting share of orders (about 0.75%) leaves feedback, counted over the last 30 days ----
    const simFb = { avg: 0, neg: 0, pos: 0, neu: 0 };
    let stars = 0, count = 0;
    for (let i = last - 29; i <= last; i++) {
      const r = rng("fb:" + ymd(dates[i]));
      const level = between(rng("fbweek:" + ymd(addDays(dates[i], -isoDow(dates[i])))), 0.006, 0.009);   // drifts week to week
      const rate = Math.min(Math.max(level * lognormal(r, 0.2), 0.005), 0.01);
      const negP = between(r, 0.02, 0.05), neuP = between(r, 0.015, 0.035);
      let arrivals = poisson(r, orders[i - 4] * rate);   // feedback follows delivery, a few days after the order
      if (i === last) arrivals = Math.floor(arrivals * frac);
      for (let j = 0; j < arrivals; j++) {
        const u = r(), v = r();
        if (u < negP) { simFb.neg++; stars += v < 0.65 ? 1 : 2; }
        else if (u < negP + neuP) { simFb.neu++; stars += 3; }
        else { simFb.pos++; stars += v < 0.9 ? 5 : 4; }
        count++;
      }
    }
    simFb.avg = count ? Math.round(stars / count * 10) / 10 : 0;

    const man = state.manual, mv = (k) => num(man[k]) || 0;
    const balance = state.auto.balance ? simBalance : mv("balance");
    const fb = state.auto.feedback ? simFb : { avg: mv("fbAvg"), neg: mv("fbNeg"), pos: mv("fbPos"), neu: mv("fbNeu") };

    return { now, today, dates, sales, orders, units, hourly, last, dom, doy, y, frac, fracPrev, todayIsEntered, balance, fb, sim: { balance: simBalance, fb: simFb }, eventsToday, anchorKey };
  }

  function sum(arr, a, b) { let s = 0; for (let i = Math.max(a, 0); i <= Math.min(b, arr.length - 1); i++) s += arr[i]; return s; }

  /* ------------------------------------------------------------------ */
  /* Range views */
  function view(m, id) {
    const L = m.last, today = m.today;
    const dm = (i) => "" + m.dates[i].getDate() + " " + MONTHS[m.dates[i].getMonth()];
    if (id === "today") {
      const f = m.fracPrev;
      const yS = m.sales[L - 1] * f, yO = m.orders[L - 1] * f, yU = m.units[L - 1] * f;
      const labels = { 0: "12 AM", 5: "5 a.m.", 10: "10 AM", 15: "3 p.m.", 20: "8 PM" };
      return {
        slots: 24, bars: m.hourly.slice(), rotated: true,
        ticks: Object.keys(labels).map((k) => ({ i: +k, label: labels[k] })),
        sales: m.sales[L], units: m.units[L], orders: m.orders[L],
        prev: { sales: yS, units: yU, orders: yO }, suffix: "yesterday"
      };
    }
    if (id === "d7") {
      const idx = []; for (let i = L - 6; i <= L; i++) idx.push(i);
      return {
        slots: 7, bars: idx.map((i) => m.sales[i]), rotated: true,
        ticks: idx.map((i, k) => ({ i: k, label: dm(i) })),
        sales: sum(m.sales, L - 6, L), units: sum(m.units, L - 6, L), orders: sum(m.orders, L - 6, L),
        prev: { sales: sum(m.sales, L - 13, L - 7), units: sum(m.units, L - 13, L - 7), orders: sum(m.orders, L - 13, L - 7) }, suffix: "last 7D"
      };
    }
    if (id === "week") {
      const dow = isoDow(today), ws = L - dow;
      const bars = []; for (let k = 0; k < 7; k++) bars.push(k <= dow ? m.sales[ws + k] : null);
      return {
        slots: 7, bars, rotated: true,
        ticks: ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"].map((l, k) => ({ i: k, label: l })),
        sales: sum(m.sales, ws, L), units: sum(m.units, ws, L), orders: sum(m.orders, ws, L),
        prev: { sales: sum(m.sales, ws - 7, ws - 1), units: sum(m.units, ws - 7, ws - 1), orders: sum(m.orders, ws - 7, ws - 1) }, suffix: "last week"
      };
    }
    if (id === "d30") {
      const idx = []; for (let i = L - 29; i <= L; i++) idx.push(i);
      return {
        slots: 30, bars: idx.map((i) => m.sales[i]), rotated: true, tip: (k) => dm(idx[k]),
        ticks: idx.map((i, k) => ({ i: k, label: dm(i) })).filter((t) => t.i % 4 === 0),
        sales: sum(m.sales, L - 29, L), units: sum(m.units, L - 29, L), orders: sum(m.orders, L - 29, L),
        prev: { sales: sum(m.sales, L - 59, L - 30), units: sum(m.units, L - 59, L - 30), orders: sum(m.orders, L - 59, L - 30) }, suffix: "last 30D"
      };
    }
    if (id === "month") {
      const dim = daysInMonth(m.y, today.getMonth()), ms = L - (m.dom - 1);
      const bars = []; for (let d = 1; d <= dim; d++) bars.push(d <= m.dom ? m.sales[ms + d - 1] : null);
      const ticks = []; for (let d = 1; d <= dim; d += 6) ticks.push({ i: d - 1, label: "" + d });
      const pm = new Date(m.y, today.getMonth() - 1, 1);
      const pmStart = ms - daysInMonth(pm.getFullYear(), pm.getMonth());
      return {
        slots: dim, bars, rotated: false, ticks, tip: (k) => (k + 1) + " " + MONTHS[today.getMonth()],
        sales: sum(m.sales, ms, L), units: sum(m.units, ms, L), orders: sum(m.orders, ms, L),
        prev: { sales: sum(m.sales, pmStart, ms - 1), units: sum(m.units, pmStart, ms - 1), orders: sum(m.orders, pmStart, ms - 1) }, suffix: MONTHS[pm.getMonth()]
      };
    }
    const ys = L - (m.doy - 1);
    const bars = new Array(12).fill(null);
    for (let mo = 0; mo <= today.getMonth(); mo++) {
      let s = 0;
      for (let i = ys; i <= L; i++) if (m.dates[i].getMonth() === mo) s += m.sales[i];
      bars[mo] = s;
    }
    return {
      slots: 12, bars, rotated: true, ticks: MONTHS.map((l, k) => ({ i: k, label: l })), tip: (k) => MONTHS[k],
      sales: sum(m.sales, ys, L), units: sum(m.units, ys, L), orders: sum(m.orders, ys, L),
      prev: { sales: sum(m.sales, 0, ys - 1), units: sum(m.units, 0, ys - 1), orders: sum(m.orders, 0, ys - 1) }, suffix: "" + (m.y - 1)
    };
  }

  /* ------------------------------------------------------------------ */
  /* Formatting */
  function money(v) { return "£" + (Math.round(v * 100) / 100).toLocaleString("en-GB", { minimumFractionDigits: 2, maximumFractionDigits: 2 }); }
  function int(v) { return String(Math.round(v)); }
  function pct(cur, prev, decimals) {
    if (!prev) return "+0%";
    const p = (cur - prev) / prev * 100;
    let s = decimals ? (Math.round(p * 100) / 100).toFixed(2).replace(/\.?0+$/, "") : String(Math.round(p));
    if (s === "-0") s = "0";
    return (p >= 0 ? "+" : "") + s + "%";
  }
  function tickLabel(v) {
    if (v >= 1000) { const k = v / 1000; return (Math.round(k * 10) / 10) + "k"; }
    return String(Math.round(v));
  }
  function niceTop(max) {
    if (!(max > 0)) return 0;
    const raw = max / 2, p = Math.pow(10, Math.floor(Math.log10(raw))), e = raw / p;
    const step = p * (e >= Math.sqrt(50) ? 10 : e >= Math.sqrt(10) ? 5 : e >= Math.sqrt(2) ? 2 : 1);
    return Math.ceil(max / step - 1e-9) * step;
  }

  /* ------------------------------------------------------------------ */
  /* Chart (coordinates relative to the Sales card's outer top-left)      */
  const SVG_NS = "http://www.w3.org/2000/svg";
  const PLOT_X0 = 85.5, PLOT_X1 = 332, PLOT_TOP = 166, LABEL_BOTTOM = 335.4, LABEL_GAP = 17.5;
  const FONT = 13, CAP = 0.727 * FONT, R2 = Math.SQRT1_2;
  const XFONT = 12.5, XCAP = 0.727 * XFONT, XDESC = 0.2 * XFONT;   // rotated x labels are smaller
  function el(name, attrs, text) {
    const e = document.createElementNS(SVG_NS, name);
    for (const k in attrs) e.setAttribute(k, attrs[k]);
    if (text != null) e.textContent = text;
    return e;
  }
  function renderChart(v) {
    const svg = $("#chart");
    while (svg.firstChild) svg.removeChild(svg.firstChild);
    const has = v.bars.some((b) => b != null && b > 0);
    const max = has ? Math.max.apply(null, v.bars.map((b) => b || 0)) : 0;
    const top = niceTop(max);

    const slot = (PLOT_X1 - PLOT_X0) / v.slots;
    const labels = v.ticks.map((t) => {
      const txt = el("text", { "text-anchor": v.rotated ? "start" : "middle", class: v.rotated ? "xlab-rot" : "xlab" }, t.label);
      svg.appendChild(txt);
      const L = txt.getComputedTextLength() - 2;
      const hasDesc = /[gjpqy]/.test(t.label);
      return { t, txt, L, hasDesc, x: PLOT_X0 + slot * (t.i + 0.5) };
    });
    let blockH;
    if (v.rotated) blockH = Math.max.apply(null, labels.map((l) => (l.L + XCAP + (l.hasDesc ? XDESC : 0)) * R2));
    else blockH = CAP;
    const plotBottom = Math.round((LABEL_BOTTOM - LABEL_GAP - blockH) * 3) / 3;
    const plotH = plotBottom - PLOT_TOP;

    const ticks = top > 0 ? [0, top / 2, top] : [0];
    for (const tv of ticks) {
      const y = top > 0 ? plotBottom - (tv / top) * plotH : PLOT_TOP + 63.7;
      svg.insertBefore(el("line", { class: "grid", x1: PLOT_X0, x2: PLOT_X1, y1: y, y2: y }), svg.firstChild);
      svg.appendChild(el("text", { x: top > 0 ? 69.3 : 62.3, y: y + CAP / 2 - 0.3, "text-anchor": "end" }, tickLabel(tv)));
    }
    if (top === 0) svg.insertBefore(el("line", { class: "grid", x1: PLOT_X0, x2: PLOT_X1, y1: plotBottom, y2: plotBottom }), svg.firstChild);

    const barTops = {};
    if (top > 0) {
      const bw = slot * 0.88;
      v.bars.forEach((b, i) => {
        if (b == null || b <= 0) return;
        const h = Math.max((b / top) * plotH, 0.5);
        barTops[i] = plotBottom - h;
        const bx = PLOT_X0 + slot * i + (slot - bw) / 2, by = plotBottom - h, rr = Math.min(2.7, bw / 2, h);   // rounded top corners, like the app
        const d = "M" + bx + " " + plotBottom + " V" + (by + rr) + " a" + rr + " " + rr + " 0 0 1 " + rr + " -" + rr + " H" + (bx + bw - rr) + " a" + rr + " " + rr + " 0 0 1 " + rr + " " + rr + " V" + plotBottom + " Z";
        svg.appendChild(el("path", { class: "bar" + (selectedBar === i ? " selected" : ""), d }));
      });
    }
    // tap a bar (year, month, 30D) to see its total
    if (v.tip && top > 0) {
      v.bars.forEach((b, i) => {
        if (b == null) return;
        const hit = el("rect", { class: "hit", x: PLOT_X0 + slot * i, y: PLOT_TOP, width: slot, height: plotH, fill: "transparent" });
        hit.addEventListener("click", (e) => { e.stopPropagation(); selectedBar = selectedBar === i ? null : i; render(); });
        svg.appendChild(hit);
      });
    }

    const labelTop = plotBottom + LABEL_GAP;
    for (const l of labels) {
      if (v.rotated) {
        const d = l.hasDesc ? XDESC : 0;
        const tx = (l.x + 1.5) - (l.L + d) * R2;
        const ty = labelTop + (l.L + XCAP) * R2;
        l.txt.setAttribute("transform", "translate(" + tx.toFixed(2) + " " + ty.toFixed(2) + ") rotate(-45)");
      } else {
        l.txt.setAttribute("x", l.x); l.txt.setAttribute("y", labelTop + CAP);
      }
    }

    if (v.tip && selectedBar != null && v.bars[selectedBar] != null && barTops[selectedBar] != null) {
      // white card overlapping the top of the tapped bar: "Jul" / ● Sales: 17480.62 (measured from the app)
      const i = selectedBar, cx = PLOT_X0 + slot * (i + 0.5) + 2;
      const g = el("g", { class: "tip" });
      const l1 = el("text", { class: "tip-label" }, v.tip(i));
      const l2 = el("text", { class: "tip-value" }, "Sales: " + (Math.round(v.bars[i] * 100) / 100).toFixed(2));
      g.appendChild(l1); g.appendChild(l2); svg.appendChild(g);
      const w = Math.max(l1.getComputedTextLength(), 15.3 + l2.getComputedTextLength()) + 9.4 + 14, h = 49;
      let bx = cx - w / 2; bx = Math.max(PLOT_X0 - 30, Math.min(bx, PLOT_X1 + 30 - w));
      let by = barTops[i] + 4; if (by + h > plotBottom + 30) by = plotBottom + 30 - h;
      g.insertBefore(el("rect", { class: "tip-box", x: bx, y: by, width: w, height: h, rx: 4 }), l1);
      l1.setAttribute("x", bx + 9.4); l1.setAttribute("y", by + 20.3);
      g.appendChild(el("circle", { cx: bx + 9.4 + 2.3 + 4.65, cy: by + 31.3, r: 4.65, fill: "#ff9900" }));
      l2.setAttribute("x", bx + 9.4 + 15.3); l2.setAttribute("y", by + 35.5);
    }

    const cyAxis = ((PLOT_TOP + plotBottom) / 2).toFixed(1);
    svg.appendChild(el("text", { class: "axis-title", "text-anchor": "middle", transform: "translate(38.5 " + cyAxis + ") rotate(-90)" }, "Sales"));
    svg.appendChild(el("text", { class: "axis-title", "text-anchor": "middle", transform: "translate(342 " + cyAxis + ") rotate(90)" }, "Units"));

    const g = el("g", {});
    const salesT = el("text", { class: "legend-sales", x: 0, y: 0 }, "Sales");
    const unitsT = el("text", { class: "legend-units", x: 0, y: 0 }, "Units");
    svg.appendChild(g); g.appendChild(salesT); g.appendChild(unitsT);
    const w1 = salesT.getComputedTextLength(), w2 = unitsT.getComputedTextLength();
    const total = 12 + 7.3 + w1 + 22.7 + 12 + 7 + w2;
    let x = 190.5 - total / 2; const cy = 344;
    g.appendChild(el("circle", { cx: x + 6, cy, r: 6, fill: "#ff9900" })); x += 12 + 7.3;
    salesT.setAttribute("x", x); salesT.setAttribute("y", cy + CAP / 2); x += w1 + 22.7;
    g.appendChild(el("circle", { cx: x + 6, cy, r: 6, fill: "#666" })); x += 12 + 7;
    unitsT.setAttribute("x", x); unitsT.setAttribute("y", cy + CAP / 2);
  }

  /* ------------------------------------------------------------------ */
  /* Render everything */
  let model = null, selectedBar = null;
  function render() {
    const now = new Date();
    model = buildModel(now);
    const v = view(model, range);

    $("#m-sales").textContent = money(v.sales);
    $("#m-units").textContent = int(v.units);
    $("#m-orders").textContent = int(v.orders);
    $("#m-avg").textContent = v.orders > 0 ? (v.units / v.orders).toFixed(2) : "0";
    const prevAvg = v.prev.orders > 0 ? v.prev.units / v.prev.orders : 0;
    const curAvg = v.orders > 0 ? v.units / v.orders : 0;
    $("#c-sales").textContent = pct(v.sales, v.prev.sales, true) + " " + v.suffix;
    $("#c-units").textContent = pct(v.units, v.prev.units, false) + " " + v.suffix;
    $("#c-orders").textContent = pct(v.orders, v.prev.orders, false) + " " + v.suffix;
    $("#c-avg").textContent = pct(curAvg, prevAvg, true) + " " + v.suffix;
    document.querySelectorAll(".pill").forEach((p) => p.classList.toggle("active", p.dataset.range === range));
    renderChart(v);
    $("#refreshed").textContent = "in 0 seconds";

    $("#v-balance").textContent = money(model.balance);
    $("#v-fb-avg").textContent = String(model.fb.avg);
    $("#v-fb-neg").textContent = int(model.fb.neg);
    $("#v-fb-pos").textContent = int(model.fb.pos);
    $("#v-fb-neu").textContent = int(model.fb.neu);
    const oc = state.ordersCard, L = model.last;
    const r = rng("orders-card:" + ymd(model.today));
    const o7 = sum(model.orders, L - 6, L);
    // open orders: roughly 80% of today's order items and 20% of yesterday's
    const pending = oc.pending != null ? num(oc.pending) : Math.round(model.orders[L] * between(r, 0.72, 0.88) + model.orders[L - 1] * between(r, 0.14, 0.26));
    $("#v-pending").textContent = int(pending);
    $("#v-undispatched").textContent = int(oc.undispatched != null ? num(oc.undispatched) : 0);
    $("#v-dispatched").textContent = int(oc.dispatched != null ? num(oc.dispatched) : Math.max(o7 - pending, 0));
    $("#v-messages").textContent = int(num(state.misc.messages) || 0);
    $("#v-ipi").textContent = int(state.misc.ipi != null ? num(state.misc.ipi) : 896);
    $("#v-deal").textContent = money(num(state.misc.deal) || 0);
    $("#v-voucher").textContent = money(num(state.misc.voucher) || 0);
    $("#sim-switch").classList.toggle("on", !!state.sim);
    $("#sim-status").textContent = state.sim ? "On · new days are generated from your trend" : "Off · enter or overwrite days in the sheet";
  }

  function tickClock() {
    const d = new Date();
    $("#clock").textContent = d.getHours() + ":" + String(d.getMinutes()).padStart(2, "0");
  }

  /* ------------------------------------------------------------------ */
  /* Entry sheet */
  const setup = $("#setup"), form = $("#setup-form"), dayInput = form.elements.day;
  function openSheet(sheet) { phone.classList.add("sheet-open"); sheet.classList.add("open"); }
  function closeSheets() { phone.classList.remove("sheet-open"); document.querySelectorAll(".sheet.open").forEach((s) => s.classList.remove("open")); }
  function fillForm(dayKey) {
    const f = form.elements;
    const today = ymd(new Date());
    dayInput.max = today;
    dayInput.min = (new Date().getFullYear() - 1) + "-01-01";
    dayInput.value = dayKey || today;
    const d = state.days[dayInput.value] || {};
    const val = (v) => (v == null ? "" : v);
    f.sales.value = val(d.sales); f.orders.value = val(d.orders);
    formAuto = Object.assign({}, state.auto);
    showMode("balance"); showMode("feedback");
    const isToday = dayInput.value === today;
    $("#day-title").textContent = isToday ? "Today so far" : "Figures for " + niceDate(dayInput.value) + (d.src === "entered" ? " (entered)" : "");
    // what the dashboard currently shows for the chosen day
    const at = entryTime(d, dayInput.value);
    const i = model ? daysBetween(model.dates[0], parseYmd(dayInput.value)) : -1;
    let shown = "";
    if (model && i >= 0 && i <= model.last) {
      const s = money(model.sales[i]) + " · " + int(model.orders[i]) + " order items";
      const t = at ? at.getHours() + ":" + String(at.getMinutes()).padStart(2, "0") : "";
      if (at) shown = (isToday ? "Now " : "Full day: ") + s + " – your entry at " + t + " plus the simulated sales since.";
      else if (d.src !== "entered") shown = (isToday ? "Simulated so far: " : "Simulated: ") + s + ". Enter figures to overwrite.";
    }
    $("#day-shown").textContent = shown;
    renderDayChips(dayInput.value);
    f.d7.value = val(state.periods.d7); f.d30.value = val(state.periods.d30); f.month.value = val(state.periods.month); f.year.value = val(state.periods.year); f.lastYear.value = val(state.periods.lastYear);
    $("#periods-title").textContent = "Total sales per period (£) · optional" + (state.periods.asOf ? " · as of " + niceDate(state.periods.asOf) : "");
    f.pending.value = val(state.ordersCard.pending); f.undispatched.value = val(state.ordersCard.undispatched); f.dispatched.value = val(state.ordersCard.dispatched);
    f.messages.value = val(state.misc.messages); f.ipi.value = val(state.misc.ipi); f.deal.value = val(state.misc.deal); f.voucher.value = val(state.misc.voucher);
    const list = enteredDays();
    $("#history").textContent = list.length ? "Entered days: " + list.map(niceDate).join(", ") : "";
    checkConsistency();
  }
  /* Balance and feedback are each either simulated (inputs locked, showing the simulated figures) or manual
     (shown exactly as typed). The switches take effect on Save, like the rest of the sheet.                */
  const MODE_FIELDS = { balance: ["balance"], feedback: ["fbAvg", "fbNeg", "fbPos", "fbNeu"] };
  let formAuto = Object.assign({}, state.auto);
  function showMode(kind) {
    const on = formAuto[kind], sim = model ? model.sim : null;
    const simVal = { balance: sim ? sim.balance.toFixed(2) : "", fbAvg: sim ? sim.fb.avg : "", fbNeg: sim ? sim.fb.neg : "", fbPos: sim ? sim.fb.pos : "", fbNeu: sim ? sim.fb.neu : "" };
    for (const k of MODE_FIELDS[kind]) {
      const input = form.elements[k];
      input.disabled = on;
      input.value = on || state.manual[k] == null ? simVal[k] : state.manual[k];   // manual starts from the simulated figure
    }
    $("#" + kind + "-switch").classList.toggle("on", on);
    $("#" + kind + "-mode").textContent = on ? "Simulated" : "Manual";
    $("#" + kind + "-hint").textContent = !on ? "Shown exactly as typed until you change it."
      : kind === "balance" ? "Follows your sales: money after fees is held until delivery + 7 days, then paid out daily."
      : "Follows your orders: about 0.75% leave feedback, counted over the last 30 days.";
  }
  for (const kind of Object.keys(MODE_FIELDS)) $("#" + kind + "-switch").addEventListener("click", () => { formAuto[kind] = !formAuto[kind]; showMode(kind); });
  function renderDayChips(sel) {
    const box = $("#day-chips"), t = startOfDay(new Date());
    box.textContent = "";
    for (let k = 0; k < 14; k++) {
      const d = addDays(t, -k), key = ymd(d), rec = state.days[key];
      const b = document.createElement("button");
      b.type = "button";
      b.className = "day-chip" + (key === sel ? " active" : "") + (rec && rec.src === "entered" ? " entered" : "");
      b.textContent = k === 0 ? "Today" : k === 1 ? "Yesterday" : ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"][isoDow(d)] + " " + d.getDate();
      b.addEventListener("click", () => fillForm(key));
      box.appendChild(b);
    }
  }
  function readForm() {
    const f = form.elements, g = (n) => num(f[n].value);
    const day = dayInput.value || ymd(new Date());
    const rec = { sales: g("sales"), orders: g("orders") };
    const prev = state.days[day];
    // an entry made today is the total by now; keep the original time if the sales figure is unchanged
    const at = prev && prev.src === "entered" && prev.sales === rec.sales && prev.at ? prev.at : day === ymd(new Date()) && rec.sales != null ? Date.now() : null;
    if (Object.values(rec).some((v) => v != null)) state.days[day] = Object.assign({}, rec, { src: "entered", at });
    else if (state.days[day] && state.days[day].src === "entered") delete state.days[day];
    const np = { d7: g("d7"), d30: g("d30"), month: g("month"), year: g("year"), lastYear: g("lastYear") };
    const changedPeriods = ["d7", "d30", "month", "year", "lastYear"].some((k) => np[k] !== state.periods[k]);
    if (changedPeriods) { state.periods = Object.assign(np, { asOf: day }); }
    state.ordersCard = { pending: g("pending"), undispatched: g("undispatched"), dispatched: g("dispatched") };
    state.misc = { messages: g("messages"), ipi: g("ipi"), deal: g("deal"), voucher: g("voucher") };
    state.auto = Object.assign({}, formAuto);
    for (const kind of Object.keys(MODE_FIELDS)) if (!formAuto[kind]) for (const k of MODE_FIELDS[kind]) state.manual[k] = g(k);
    // days after an overwritten day are re-simulated from the new trend
    for (const k of Object.keys(state.days)) if (k > day && state.days[k].src === "sim") delete state.days[k];
  }
  function checkConsistency() {
    const f = form.elements, g = (n) => num(f[n].value);
    const dom = parseYmd(dayInput.value || ymd(new Date())).getDate();
    const order = [["sales", "the day", 1], ["d7", "last 7 days", 7], ["month", "this month", dom], ["d30", "last 30 days", 30], ["year", "this year", 400]];
    order.sort((a, b) => a[2] - b[2]);
    const msgs = []; let prev = null;
    for (const [k, name] of order) {
      const v = g(k); if (v == null) continue;
      if (prev && v < prev.v - 0.005) msgs.push(name + " (" + money(v) + ") is lower than " + prev.name + " (" + money(prev.v) + "); it will be raised to match.");
      if (prev == null || v >= prev.v) prev = { v, name };
    }
    $("#consistency").textContent = msgs.join(" ");
  }
  form.addEventListener("input", checkConsistency);
  dayInput.addEventListener("change", () => fillForm(dayInput.value));
  form.addEventListener("submit", (e) => { e.preventDefault(); readForm(); save(); closeSheets(); render(); });
  $("#setup-cancel").addEventListener("click", closeSheets);
  $("#setup-reset").addEventListener("click", () => {
    if (!confirm("Clear all entered figures and the simulated history?")) return;
    state = JSON.parse(JSON.stringify(DEFAULTS)); save(); fillForm(); render();
  });
  $("#backdrop").addEventListener("click", closeSheets);
  $("#logo").addEventListener("click", () => { fillForm(); openSheet(setup); });

  /* Simulation toggle lives in the Orders card's ALL dropdown */
  const simSheet = $("#sim-sheet");
  $("#orders-dropdown").addEventListener("click", () => openSheet(simSheet));
  $("#sim-switch").addEventListener("click", () => {
    state.sim = !state.sim;
    if (state.sim) state.simSince = ymd(new Date());
    save(); render();
  });
  $("#sim-done").addEventListener("click", closeSheets);
  $("#sim-enter").addEventListener("click", () => { closeSheets(); fillForm(); openSheet(setup); });

  $("#pills").addEventListener("click", (e) => {
    const b = e.target.closest(".pill"); if (!b) return;
    range = b.dataset.range; selectedBar = null;
    render();
  });
  $("#scroll").addEventListener("click", (e) => { if (selectedBar != null && !e.target.closest(".hit")) { selectedBar = null; render(); } });

  /* ------------------------------------------------------------------ */
  const q = new URLSearchParams(location.search);
  if (q.get("range")) range = q.get("range");
  if (q.get("bar")) selectedBar = parseInt(q.get("bar"), 10);
  if (q.get("scroll")) setTimeout(() => { $("#scroll").scrollTop = parseFloat(q.get("scroll")); }, 50);
  if (q.has("bare")) { document.body.classList.add("bare"); document.body.style.display = "block"; phone.style.cssText = "position:absolute;left:0;top:0;margin:0;border-radius:0;box-shadow:none"; }
  if (q.has("demo")) {   // sample figures for previewing; not saved
    state = JSON.parse(JSON.stringify(DEFAULTS));
    const t = ymd(new Date());
    state.days[t] = { sales: 3643.63, orders: 231, src: "entered" };
    state.periods = { d7: 17481.72, d30: 24328.91, month: 21495.62, year: 84472.41, lastYear: null, asOf: t };
    if (q.get("demo") === "sim") {   // as if entered N days ago and simulated since
      const a = ymd(addDays(new Date(), -parseInt(q.get("ago") || "20", 10)));
      state.sim = true; state.periods.asOf = a; state.days = {};
      state.days[a] = { sales: 3643.63, orders: 231, src: "entered" };
    }
    save = function () {};
  }
  tickClock(); render();
  setInterval(() => { tickClock(); render(); }, 60000);
  if (document.fonts && document.fonts.ready) document.fonts.ready.then(render);

  // Launch screen. iOS colours the status-bar strip from the page background once per page load,
  // so the first load of a session is navy (set in <head>) and shows the launch screen, then the page
  // reloads itself white straight into the dashboard. Resuming the app does not reload, so it stays white.
  const splash = $("#splash");
  const SPLASH_MS = q.has("splash") ? parseInt(q.get("splash"), 10) || 0 : 500;
  let launched = false;
  try { launched = !!sessionStorage.getItem("launched"); } catch (e) {}
  function afterSplash() {
    if (q.get("state") === "setup") { fillForm(); openSheet(setup); }
    else if (q.get("state") === "sim") { openSheet(simSheet); }
  }
  if (SPLASH_MS <= 0 || launched) {
    splash.classList.add("off");
    document.documentElement.classList.remove("splashing");
    afterSplash();
  } else {
    setTimeout(() => {
      try { sessionStorage.setItem("launched", "1"); } catch (e) {}
      if (document.documentElement.classList.contains("splashing") && window.innerWidth < 480) {
        location.replace(location.href);           // second load: white strip, no launch screen
      } else {
        splash.classList.add("hide");
        document.documentElement.classList.remove("splashing");
        setTimeout(() => splash.classList.add("off"), 350);
        afterSplash();
      }
    }, SPLASH_MS);
  }
})();
