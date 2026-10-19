'use strict';

// GymProgress — PPL tracker. Everything lives in localStorage on this device and
// is written after every change, so there is no "save workout" step to forget.

const KEY = 'gymprogress.v1';
const ROTATION = ['push', 'pull', 'legs', 'rest'];
const DAY_NAMES = { push: 'Push', pull: 'Pull', legs: 'Legs', rest: 'Rest' };
const DAY_SUBS = { push: 'Chest · Shoulders · Triceps', pull: 'Back · Rear delts · Biceps', legs: 'Quads · Hams · Glutes · Calves' };
const MEASURES = ['Chest', 'Shoulders', 'Waist', 'Hips', 'Arm L', 'Arm R', 'Thigh L', 'Thigh R', 'Calves', 'Neck'];

// `group` is what the weekly-volume chart counts under, so upper and mid chest
// both add to "Chest" — the 10–20 sets/week guideline is per muscle, not per slot.
const slot = (id, muscle, group, min, max) => ({ id, muscle, group, min, max });
const DEFAULT_PROGRAM = {
  push: [
    slot('upper-chest', 'Upper chest', 'Chest', 6, 10),
    slot('mid-chest', 'Mid chest', 'Chest', 6, 10),
    slot('front-delts', 'Front delts', 'Front delts', 6, 10),
    slot('side-delts', 'Side delts', 'Side delts', 10, 15),
    slot('tri-overhead', 'Triceps overhead', 'Triceps', 8, 12),
    slot('tri-pushdown', 'Triceps pushdown', 'Triceps', 10, 15),
  ],
  pull: [
    slot('lats', 'Lats (vertical pull)', 'Lats', 6, 10),
    slot('upper-back', 'Upper back (rows)', 'Upper back', 6, 10),
    slot('rear-delts', 'Rear delts', 'Rear delts', 12, 20),
    slot('biceps', 'Biceps', 'Biceps', 8, 12),
    slot('brachialis', 'Brachialis / forearms', 'Forearms', 10, 15),
  ],
  legs: [
    slot('quads', 'Quads', 'Quads', 6, 10),
    slot('hamstrings', 'Hamstrings', 'Hamstrings', 8, 12),
    slot('glutes', 'Glutes', 'Glutes', 8, 12),
    slot('calves', 'Calves', 'Calves', 10, 15),
    slot('abs', 'Abs', 'Abs', 10, 15),
  ],
};

// ---------- state ----------
function freshState() {
  return {
    v: 1,
    settings: { unit: 'kg', inc: 2.5 },
    program: JSON.parse(JSON.stringify(DEFAULT_PROGRAM)),
    slotNames: {},          // slot id -> last exercise name typed for it
    sessions: [],           // { id, date, day, items: [...] }
    body: [],               // { date, weight, m: { Waist: 84, ... } }
    ui: { current: null, folded: {}, installHint: true, progressEx: null, measure: 'Waist', settingsDay: 'push' },
  };
}

function load() {
  try {
    const s = JSON.parse(localStorage.getItem(KEY));
    if (s && s.v === 1) return Object.assign(freshState(), s, { ui: Object.assign(freshState().ui, s.ui) });
  } catch (e) { /* fall through to a fresh state */ }
  return freshState();
}
let S = load();
function save() {
  try { localStorage.setItem(KEY, JSON.stringify(S)); }
  catch (e) { alert('Could not save — storage is full or blocked. Download a backup in Settings.'); }
}

// Ask the browser not to evict our storage. Installed home-screen apps on iOS
// are exempt from Safari's 7-day cleanup; this covers the other browsers.
if (navigator.storage && navigator.storage.persist) navigator.storage.persist().catch(() => {});

// ---------- helpers ----------
const $ = (s, el = document) => el.querySelector(s);
const $$ = (s, el = document) => [...el.querySelectorAll(s)];
const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const num = s => { const n = parseFloat(String(s ?? '').replace(',', '.')); return isFinite(n) ? n : null; };
const fmt = n => n == null ? '' : (Math.round(n * 100) / 100).toString();
const pad = n => String(n).padStart(2, '0');
const iso = d => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
const dateOf = s => { const [y, m, d] = s.split('-').map(Number); return new Date(y, m - 1, d); };
const daysBetween = (a, b) => Math.round((dateOf(b) - dateOf(a)) / 864e5);
const short = s => dateOf(s).toLocaleDateString('en-GB', { day: 'numeric', month: 'short' });
const norm = s => String(s || '').trim().toLowerCase();
const e1rm = (w, r) => w * (1 + r / 30);   // Epley
const unit = () => S.settings.unit;
// `?date=YYYY-MM-DD` pins "today" — used by the test script, harmless otherwise.
const TODAY = new URLSearchParams(location.search).get('date') || iso(new Date());

// A set counts as logged once reps are typed. An empty weight means "same as
// last time", which is the placeholder captured in `wp` when the row was drawn.
const setW = s => num(s.w) ?? num(s.wp);
const isLogged = s => num(s.r) != null;
const loggedSets = item => item.sets.filter(isLogged).map(s => ({ r: num(s.r), w: setW(s) ?? 0 }));
const sessionHasData = ses => ses.items.some(it => it.sets.some(isLogged));

function sessionsDesc() {
  return S.sessions.slice().sort((a, b) => b.date.localeCompare(a.date));
}

// Most recent earlier performance of an exercise (matched by name, so renaming
// to something new starts a fresh history and switching back finds the old one).
function lastPerformance(name, excludeId) {
  const n = norm(name);
  if (!n) return null;
  for (const ses of sessionsDesc()) {
    if (ses.id === excludeId) continue;
    for (const it of ses.items) {
      if (norm(it.name) !== n) continue;
      const sets = loggedSets(it);
      if (sets.length) return { date: ses.date, sets, note: (it.note || '').trim() };
    }
  }
  return null;
}

function suggestion(last, min, max) {
  if (!last) return null;
  const top = Math.max(...last.sets.map(s => s.w));
  const atTop = last.sets.filter(s => s.w === top);
  if (atTop.every(s => s.r >= max)) {
    return `${fmt(top + S.settings.inc)} ${unit()} × ${min}+`;
  }
  return last.sets.map(s => Math.min(s.r + 1, max)).join(' / ');
}

function describeSets(sets) {
  const ws = [...new Set(sets.map(s => s.w))];
  if (ws.length === 1) return `${sets.map(s => s.r).join(' / ')} @ ${fmt(ws[0])} ${unit()}`;
  return sets.map(s => `${s.r}@${fmt(s.w)}`).join(', ');
}

// Rotation: the day after your last workout. Rest slots are used up by calendar
// days that passed with no training; training slots are not, so a missed gym
// day doesn't skip a workout.
function upNext() {
  const past = sessionsDesc().filter(s => s.date < TODAY && sessionHasData(s));
  if (!past.length) return { day: 'push', last: null };
  const last = past[0];
  let pos = ROTATION.indexOf(last.day) + 1;
  let free = daysBetween(last.date, TODAY) - 1;
  while (ROTATION[pos % 4] === 'rest' && free > 0) { pos++; free--; }
  return { day: ROTATION[pos % 4], last };
}
function lastDateOf(day) {
  const s = sessionsDesc().find(x => x.day === day && sessionHasData(x));
  return s ? s.date : null;
}
function nextTraining(day) {
  let i = ROTATION.indexOf(day);
  do { i = (i + 1) % 4; } while (ROTATION[i] === 'rest');
  return ROTATION[i];
}

// ---------- session ----------
function getSession(date, day, create) {
  const id = `${date}|${day}`;
  let ses = S.sessions.find(s => s.id === id);
  if (!ses && create) {
    ses = { id, date, day, items: S.program[day].map(sl => newItem(sl, id)) };
    S.sessions.push(ses);
  }
  return ses;
}
function newItem(sl, sesId) {
  const name = sl ? (S.slotNames[sl.id] || '') : '';
  const last = lastPerformance(name, sesId);
  const n = last ? last.sets.length : 3;
  return {
    slot: sl ? sl.id : null,
    muscle: sl ? sl.muscle : 'Extra',
    group: sl ? sl.group : null,
    min: sl ? sl.min : 8, max: sl ? sl.max : 12,
    name, note: '',
    sets: Array.from({ length: n }, () => ({ r: '', w: '' })),
  };
}
function currentSession() {
  const c = S.ui.current;
  if (!c || c.date !== TODAY) return null;
  return getSession(c.date, c.day, true);
}

// ---------- Today ----------
function renderToday() {
  const el = $('#v-today');
  const ses = currentSession();
  const nx = upNext();
  const picked = !!ses;
  document.body.classList.toggle('picked', picked);

  let html = '';
  if (S.ui.installHint && !isStandalone()) {
    html += `<div class="install"><button data-act="hide-install" aria-label="Dismiss">×</button>
      <b>Install on your iPhone:</b> open this page in Safari, tap <b>Share</b> → <b>Add to Home Screen</b>.
      It then opens full-screen, works offline, and iOS keeps your data.</div>`;
  }
  html += '<div class="days">';
  for (const d of ['push', 'pull', 'legs']) {
    const ld = lastDateOf(d);
    const isNext = nx.day === d || (nx.day === 'rest' && nextTraining('legs') === d);
    const active = ses && ses.day === d;
    html += `<button class="day ${isNext ? 'next' : ''} ${active ? 'active' : ''}" data-act="pick" data-day="${d}">
      <span><b>${DAY_NAMES[d]}</b><small>${DAY_SUBS[d]}</small></span>
      <span class="when">${isNext ? '<span class="badge">Up next</span>' : ''}<small>${ld ? 'last ' + short(ld) : 'not yet'}</small></span>
    </button>`;
  }
  html += '</div>';
  let rot = 'Push → Pull → Legs → Rest';
  if (nx.last) {
    const ago = daysBetween(nx.last.date, TODAY);
    rot += ` · last: ${DAY_NAMES[nx.last.day]} ${ago === 1 ? 'yesterday' : ago + ' days ago'}`;
  }
  html += `<div class="rotation">${rot}</div>`;
  if (!picked && nx.day === 'rest') {
    html += `<div class="rest-note"><b>Rotation says rest today.</b> Recover, eat, sleep — or pick a day above if you're training anyway. Log your bodyweight under ☰ → Body.</div>`;
  }

  if (ses) {
    html += `<section id="program">
      <div class="summary"><h2>${DAY_NAMES[ses.day]} day</h2><span id="count"></span></div>
      <div class="bar"><i id="progress"></i></div>
      <div id="cards">${ses.items.map((it, i) => cardHTML(ses, it, i)).join('')}</div>
      <button class="add-ex" data-act="add-ex">+ Add exercise to today</button>
      <div class="hint">Grey numbers = last time. Leave weight empty to repeat it; type reps to log the set.<br>The circle fills once every set has reps — tap it to fold the card.</div>
    </section>`;
  }
  el.innerHTML = html;
  if (ses) refreshProgress(ses);
  $$('textarea.note', el).forEach(autosize);
}

function cardHTML(ses, it, i) {
  const last = lastPerformance(it.name, ses.id);
  const sug = suggestion(last, it.min, it.max);
  const rows = it.sets.map((s, k) => {
    const l = last ? (last.sets[k] || last.sets[last.sets.length - 1]) : null;
    s.wp = l ? l.w : '';      // remember what an empty weight means for this row
    return `<div class="n">${k + 1}</div>
      <div class="field"><input inputmode="numeric" data-k="${k}" data-f="r" placeholder="${l ? l.r : '–'}" value="${esc(s.r)}"></div>
      <div class="field"><input inputmode="decimal" data-k="${k}" data-f="w" placeholder="${l ? fmt(l.w) : '–'}" value="${esc(s.w)}"><span class="unit">${unit()}</span></div>
      <button class="del" data-act="del-set" data-k="${k}" aria-label="Remove set">×</button>`;
  }).join('');
  const lastTxt = last
    ? `<span class="was">Last ${short(last.date)}: ${describeSets(last.sets)}</span><span class="goal">→ Next: ${sug}</span>`
    : `<span class="was">${it.name.trim() ? 'First time — no history yet' : 'Type the exercise you\'re doing'}</span>`;
  const folded = S.ui.folded[ses.id + '|' + i];
  return `<article class="ex ${folded ? 'folded' : ''}" data-i="${i}">
    <div class="ex-head">
      <div style="flex:1;min-width:0">
        <div class="ex-label"><b>Exercise ${i + 1}</b> · ${esc(it.muscle)} · ${it.min}–${it.max} reps${it.slot ? '' : `<button class="rm-ex" data-act="rm-ex">remove</button>`}</div>
        <input class="ex-name" data-f="name" value="${esc(it.name)}" placeholder="Type your exercise…" autocomplete="off" autocapitalize="words">
        <div class="folded-sum"></div>
      </div>
      <button class="check" data-act="fold" aria-label="Fold">✓</button>
    </div>
    <div class="body">
      <div class="last">${lastTxt}</div>
      <div class="sets"><div class="h">Set</div><div class="h">Reps</div><div class="h">Weight</div><div></div>${rows}</div>
      <button class="add-set" data-act="add-set">+ Set</button>
      ${last && last.note ? `<div class="prev-note">Last note: <b>${esc(last.note)}</b></div>` : ''}
      <textarea class="note" data-f="note" rows="1" placeholder="Note for next time…">${esc(it.note)}</textarea>
    </div>
  </article>`;
}

// Updates done-state, orange "beat" marks and the progress bar without
// re-rendering, so the input being typed into keeps focus and the keyboard.
function refreshProgress(ses) {
  let done = 0;
  $$('#cards .ex').forEach(card => {
    const i = +card.dataset.i, it = ses.items[i];
    const last = lastPerformance(it.name, ses.id);
    it.sets.forEach((s, k) => {
      const l = last ? (last.sets[k] || last.sets[last.sets.length - 1]) : null;
      const r = num(s.r), w = setW(s), tw = num(s.w);
      const rIn = $(`input[data-k="${k}"][data-f="r"]`, card), wIn = $(`input[data-k="${k}"][data-f="w"]`, card);
      if (rIn) rIn.classList.toggle('beat', !!l && r != null && (w ?? 0) >= l.w && r > l.r);
      if (wIn) wIn.classList.toggle('beat', !!l && tw != null && tw > l.w);
    });
    const isDone = it.sets.length > 0 && it.sets.every(isLogged);
    card.classList.toggle('done', isDone);
    if (!isDone) { card.classList.remove('folded'); delete S.ui.folded[ses.id + '|' + i]; }
    if (isDone) {
      done++;
      $('.folded-sum', card).textContent = describeSets(loggedSets(it));
    }
  });
  const total = ses.items.length;
  $('#count').textContent = `${done} / ${total} done`;
  $('#progress').style.width = total ? (100 * done / total) + '%' : '0';
}

function rerenderCard(ses, i) {
  const old = $(`#cards .ex[data-i="${i}"]`);
  old.outerHTML = cardHTML(ses, ses.items[i], i);
  refreshProgress(ses);
  $$('textarea.note', $(`#cards .ex[data-i="${i}"]`)).forEach(autosize);
}

function onTodayClick(e) {
  const b = e.target.closest('[data-act]');
  if (!b) return;
  const act = b.dataset.act;
  if (act === 'hide-install') { S.ui.installHint = false; save(); return renderToday(); }
  if (act === 'pick') {
    S.ui.current = { date: TODAY, day: b.dataset.day };
    getSession(TODAY, b.dataset.day, true);
    save(); renderToday(); window.scrollTo(0, 0); return;
  }
  const ses = currentSession();
  if (!ses) return;
  if (act === 'add-ex') {
    ses.items.push(newItem(null, ses.id)); save(); renderToday();
    const cards = $$('#cards .ex'); const name = $('.ex-name', cards[cards.length - 1]);
    name.scrollIntoView({ block: 'center' }); name.focus();
    return;
  }
  const card = b.closest('.ex');
  if (!card) return;
  const i = +card.dataset.i, it = ses.items[i];
  if (act === 'add-set') { it.sets.push({ r: '', w: '' }); save(); rerenderCard(ses, i); }
  else if (act === 'del-set') { it.sets.splice(+b.dataset.k, 1); save(); rerenderCard(ses, i); }
  else if (act === 'rm-ex') {
    if (!confirm('Remove this exercise from today?')) return;
    ses.items.splice(i, 1); S.ui.folded = {}; save(); renderToday();
  }
  else if (act === 'fold' && card.classList.contains('done')) {
    const k = ses.id + '|' + i;
    if (S.ui.folded[k]) delete S.ui.folded[k]; else S.ui.folded[k] = 1;
    card.classList.toggle('folded', !!S.ui.folded[k]); save();
  }
}

function onTodayInput(e) {
  const f = e.target.dataset.f;
  const card = e.target.closest('.ex');
  const ses = currentSession();
  if (!f || !card || !ses) return;
  const it = ses.items[+card.dataset.i];
  if (f === 'r' || f === 'w') it.sets[+e.target.dataset.k][f] = e.target.value.trim();
  else if (f === 'note') { it.note = e.target.value; autosize(e.target); }
  else if (f === 'name') it.name = e.target.value;
  save();
  if (f === 'r' || f === 'w') refreshProgress(ses);
}

// Renaming changes which history applies, so redraw the card once the name is
// committed (on blur), not per keystroke — that would drop the keyboard.
function onTodayChange(e) {
  if (e.target.dataset.f !== 'name') return;
  const card = e.target.closest('.ex'), ses = currentSession();
  if (!card || !ses) return;
  const i = +card.dataset.i, it = ses.items[i];
  it.name = e.target.value.trim();
  if (it.slot && it.name) S.slotNames[it.slot] = it.name;
  // Nothing typed yet: match the set count to this exercise's history.
  if (!it.sets.some(s => s.r !== '' || s.w !== '')) {
    const last = lastPerformance(it.name, ses.id);
    it.sets = Array.from({ length: last ? last.sets.length : 3 }, () => ({ r: '', w: '' }));
  }
  save(); rerenderCard(ses, i);
}

function autosize(t) { t.style.height = 'auto'; t.style.height = t.scrollHeight + 'px'; }
const isStandalone = () => navigator.standalone === true || matchMedia('(display-mode: standalone)').matches;

// ---------- charts (inline SVG, no library) ----------
function lineChart(series, { h = 170, labels = [] } = {}) {
  const W = 340, H = h, L = 34, R = 10, T = 10, B = 20;
  const ys = series.flatMap(s => s.pts.map(p => p[1]));
  const xs = series.flatMap(s => s.pts.map(p => p[0]));
  let lo = Math.min(...ys), hi = Math.max(...ys);
  const p = (hi - lo) * 0.08 || 1; lo -= p; hi += p;
  const x0 = Math.min(...xs), x1 = Math.max(...xs);
  const x = v => L + (W - L - R) * (x1 === x0 ? 0.5 : (v - x0) / (x1 - x0));
  const y = v => T + (H - T - B) * (1 - (v - lo) / (hi - lo));
  let g = '';
  for (let k = 0; k <= 3; k++) {
    const v = lo + (hi - lo) * k / 3;
    g += `<line x1="${L}" x2="${W - R}" y1="${y(v)}" y2="${y(v)}" stroke="var(--line)"/>` +
         `<text x="${L - 6}" y="${y(v) + 3}" text-anchor="end">${v.toFixed(hi - lo < 10 ? 1 : 0)}</text>`;
  }
  labels.forEach(([v, t]) => {
    const anchor = v === x0 ? 'start' : v === x1 ? 'end' : 'middle';
    g += `<text x="${x(v)}" y="${H - 4}" text-anchor="${anchor}">${t}</text>`;
  });
  series.forEach(s => {
    const d = s.pts.map((q, i) => `${i ? 'L' : 'M'}${x(q[0]).toFixed(1)},${y(q[1]).toFixed(1)}`).join('');
    g += `<path d="${d}" fill="none" stroke="${s.color}" stroke-width="${s.w || 2.5}" stroke-linejoin="round" stroke-linecap="round"/>`;
    if (s.dots) s.pts.forEach(q => g += `<circle cx="${x(q[0])}" cy="${y(q[1])}" r="3.2" fill="${s.color}"/>`);
  });
  return `<svg class="chart" viewBox="0 0 ${W} ${H}" role="img">${g}</svg>`;
}
// First / middle / last date labels for a time axis measured in days.
function dateLabels(dates) {
  const base = dates[0];
  const pick = dates.length > 2 ? [dates[0], dates[Math.floor(dates.length / 2)], dates[dates.length - 1]] : [...new Set(dates)];
  return [...new Set(pick)].map(d => [daysBetween(base, d), short(d)]);
}

// ---------- Progress ----------
function exerciseHistory(name) {
  const n = norm(name), out = [];
  for (const ses of S.sessions.slice().sort((a, b) => a.date.localeCompare(b.date))) {
    for (const it of ses.items) {
      if (norm(it.name) !== n) continue;
      const sets = loggedSets(it);
      if (sets.length) out.push({ date: ses.date, sets, top: Math.max(...sets.map(s => s.w)), best: Math.max(...sets.map(s => e1rm(s.w, s.r))) });
    }
  }
  return out;
}
function allExercises() {
  const seen = new Map();
  for (const ses of sessionsDesc()) for (const it of ses.items) {
    const n = norm(it.name);
    if (n && !seen.has(n) && loggedSets(it).length) seen.set(n, it.name.trim());
  }
  return [...seen.values()];
}

function renderProgress() {
  const el = $('#v-progress');
  const names = allExercises();
  let html = '';
  if (!names.length) {
    html = `<div class="panel"><h3>No workouts yet</h3><div class="sub">Log a session on the Today screen and your progress shows up here.</div></div>`;
  } else {
    if (!names.some(n => norm(n) === norm(S.ui.progressEx))) S.ui.progressEx = names[0];
    const hist = exerciseHistory(S.ui.progressEx);
    const bestSet = hist.flatMap(h => h.sets).reduce((a, s) => e1rm(s.w, s.r) > e1rm(a.w, a.r) ? s : a);
    const best = Math.max(...hist.map(h => h.best));
    const delta = hist[hist.length - 1].top - hist[0].top;
    html += `<div class="panel">
      <select class="select" id="ex-pick">${names.map(n => `<option ${norm(n) === norm(S.ui.progressEx) ? 'selected' : ''}>${esc(n)}</option>`).join('')}</select>
      <div class="stats">
        <div class="stat"><small>Best set</small><b>${fmt(bestSet.w)} × ${bestSet.r}</b></div>
        <div class="stat"><small>Best est. 1RM</small><b class="up">${best.toFixed(1)}</b></div>
        <div class="stat"><small>Since start</small><b class="${delta > 0 ? 'up' : ''}">${delta > 0 ? '+' : ''}${fmt(delta)} ${unit()}</b></div>
      </div>`;
    if (hist.length >= 2) {
      const dates = hist.map(h => h.date);
      const xs = dates.map(d => daysBetween(dates[0], d));
      html += `<div class="legend"><span><i style="background:var(--accent)"></i>Top-set weight</span><span><i style="background:var(--second)"></i>Est. 1-rep max</span></div>
        ${lineChart([
          { pts: hist.map((h, i) => [xs[i], h.best]), color: 'var(--second)' },
          { pts: hist.map((h, i) => [xs[i], h.top]), color: 'var(--accent)', dots: true },
        ], { labels: dateLabels(dates) })}`;
    } else {
      html += `<div class="empty">One session so far — the chart appears after the second.</div>`;
    }
    html += `</div>`;
    let runBest = 0;
    const rows = hist.map(h => { const pr = h.best > runBest + 1e-9 && runBest > 0; runBest = Math.max(runBest, h.best); return { ...h, pr }; }).reverse();
    html += `<div class="panel"><h3>History</h3><table class="hist">${rows.slice(0, 20).map(h =>
      `<tr><td>${short(h.date)}</td><td class="${h.pr ? 'pr' : ''}">${describeSets(h.sets)}${h.pr ? ' ▲' : ''}</td><td>${h.best.toFixed(1)}</td></tr>`).join('')}</table></div>`;
  }
  html += volumeHTML();
  el.innerHTML = html;
}

function volumeHTML() {
  const counts = new Map();
  for (const day of ['push', 'pull', 'legs']) for (const sl of S.program[day]) if (!counts.has(sl.group)) counts.set(sl.group, 0);
  for (const ses of S.sessions) {
    const ago = daysBetween(ses.date, TODAY);
    if (ago < 0 || ago > 6) continue;
    for (const it of ses.items) {
      const g = it.group || it.name.trim() || it.muscle;
      counts.set(g, (counts.get(g) || 0) + loggedSets(it).length);
    }
  }
  const max = 24;
  return `<div class="panel"><h3>Sets per muscle · last 7 days</h3>
    <div class="sub">Shaded band = 10–20 sets/week, the usual growth range</div>
    ${[...counts].map(([m, n]) => `<div class="vol"><span>${esc(m)}</span>
      <div class="track"><div class="zone" style="left:${10 / max * 100}%;width:${10 / max * 100}%"></div><div class="fill ${n < 10 ? 'low' : ''}" style="width:${Math.min(n, max) / max * 100}%"></div></div>
      <span>${n}</span></div>`).join('')}</div>`;
}

// ---------- Body ----------
function bodySorted() { return S.body.slice().sort((a, b) => a.date.localeCompare(b.date)); }
function lastValue(key) {
  const b = bodySorted().reverse();
  for (const e of b) {
    const v = key === 'weight' ? e.weight : e.m && e.m[key];
    if (v != null) return v;
  }
  return null;
}
function avg7(entries, endDate) {
  const w = entries.filter(e => e.weight != null && daysBetween(e.date, endDate) >= 0 && daysBetween(e.date, endDate) < 7).map(e => e.weight);
  return w.length ? w.reduce((a, b) => a + b) / w.length : null;
}

function renderBody(msg = '') {
  const el = $('#v-body');
  const entries = bodySorted();
  const todayE = entries.find(e => e.date === TODAY) || { m: {} };
  const lw = lastValue('weight');
  let html = `<div class="panel">
    <h3>Today · ${short(TODAY)}</h3>
    <div class="form" style="margin-top:10px">
      <div class="wide"><label>Bodyweight</label><div class="field"><input id="bw" inputmode="decimal" placeholder="${lw != null ? fmt(lw) : '–'}" value="${todayE.weight != null ? fmt(todayE.weight) : ''}"><span class="unit">${unit()}</span></div></div>
    </div>
    <details id="m-details" ${S.ui.measureOpen ? 'open' : ''}>
      <summary>+ Measurements</summary>
      <div class="form">${MEASURES.map(m => {
        const lv = lastValue(m), tv = todayE.m && todayE.m[m];
        return `<div><label>${m}</label><div class="field"><input data-m="${m}" inputmode="decimal" placeholder="${lv != null ? fmt(lv) : '–'}" value="${tv != null ? fmt(tv) : ''}"><span class="unit">cm</span></div></div>`;
      }).join('')}</div>
    </details>
    <button class="btn" data-act="save-body">Save</button>
    <div class="saved">${msg}</div>
  </div>`;

  const ws = entries.filter(e => e.weight != null);
  html += `<div class="panel"><h3>Bodyweight</h3>`;
  if (ws.length) {
    const a = avg7(entries, TODAY) ?? avg7(entries, ws[ws.length - 1].date);
    const back = iso(new Date(dateOf(TODAY) - 30 * 864e5));
    const old = avg7(entries, back);
    const ch = a != null && old != null ? a - old : null;
    html += `<div class="stats">
      <div class="stat"><small>7-day avg</small><b>${a != null ? a.toFixed(1) : '–'}</b></div>
      <div class="stat"><small>vs 30 days ago</small><b>${ch != null ? (ch > 0 ? '+' : '') + ch.toFixed(1) : '–'}</b></div>
      <div class="stat"><small>Weigh-ins</small><b>${ws.length}</b></div>
    </div>`;
    if (ws.length >= 2) {
      const dates = ws.map(e => e.date);
      const xs = dates.map(d => daysBetween(dates[0], d));
      html += `<div class="legend"><span><i style="background:var(--second)"></i>Daily</span><span><i style="background:var(--accent)"></i>7-day average</span></div>
        ${lineChart([
          { pts: ws.map((e, i) => [xs[i], e.weight]), color: 'var(--second)', w: 1.5, dots: true },
          { pts: ws.map((e, i) => [xs[i], avg7(entries, e.date)]), color: 'var(--accent)', w: 3 },
        ], { labels: dateLabels(dates) })}`;
    } else html += `<div class="empty">Weigh in on another day to see the trend.</div>`;
  } else html += `<div class="empty">No weigh-ins yet.</div>`;
  html += `</div>`;

  const withM = MEASURES.filter(m => entries.some(e => e.m && e.m[m] != null));
  html += `<div class="panel"><h3>Measurements</h3>`;
  if (withM.length) {
    if (!withM.includes(S.ui.measure)) S.ui.measure = withM[0];
    const pts = entries.filter(e => e.m && e.m[S.ui.measure] != null);
    html += `<div class="chips">${withM.map(m => `<button class="chip ${m === S.ui.measure ? 'on' : ''}" data-act="measure" data-m="${m}">${m}</button>`).join('')}</div>`;
    if (pts.length >= 2) {
      const dates = pts.map(e => e.date);
      html += lineChart([{ pts: pts.map(e => [daysBetween(dates[0], e.date), e.m[S.ui.measure]]), color: 'var(--accent)', dots: true }], { h: 150, labels: dateLabels(dates) });
    } else html += `<div class="empty">${S.ui.measure}: ${fmt(pts[0].m[S.ui.measure])} cm on ${short(pts[0].date)} — measure again to see a trend.</div>`;
  } else html += `<div class="empty">Open “+ Measurements” above to add your first ones.</div>`;
  html += `</div>`;

  if (entries.length) {
    html += `<div class="panel"><h3>Entries</h3><table class="blist">${entries.slice().reverse().slice(0, 30).map(e => {
      const ms = Object.entries(e.m || {}).map(([k, v]) => `${k} ${fmt(v)}`).join(' · ');
      return `<tr><td>${short(e.date)}</td><td>${e.weight != null ? fmt(e.weight) + ' ' + unit() : ''}${ms ? `<br><small style="color:var(--muted)">${ms}</small>` : ''}</td>
        <td><button data-act="del-body" data-date="${e.date}" aria-label="Delete">×</button></td></tr>`;
    }).join('')}</table></div>`;
  }
  el.innerHTML = html;
}

function onBodyClick(e) {
  const b = e.target.closest('[data-act]');
  if (!b) return;
  if (b.dataset.act === 'save-body') {
    let entry = S.body.find(x => x.date === TODAY);
    if (!entry) { entry = { date: TODAY, weight: null, m: {} }; S.body.push(entry); }
    const w = num($('#bw').value);
    entry.weight = w;
    entry.m = {};
    $$('input[data-m]').forEach(inp => { const v = num(inp.value); if (v != null) entry.m[inp.dataset.m] = v; });
    if (entry.weight == null && !Object.keys(entry.m).length) S.body = S.body.filter(x => x !== entry);
    save(); renderBody('Saved ✓');
  } else if (b.dataset.act === 'measure') {
    S.ui.measure = b.dataset.m; save(); renderBody();
  } else if (b.dataset.act === 'del-body') {
    if (!confirm(`Delete the entry from ${short(b.dataset.date)}?`)) return;
    S.body = S.body.filter(x => x.date !== b.dataset.date); save(); renderBody();
  }
}

// ---------- Settings ----------
function renderSettings(msg = '') {
  const el = $('#v-settings');
  const d = S.ui.settingsDay;
  el.innerHTML = `<div class="panel">
    <h3>Program</h3>
    <div class="sub">Exercise slots per day — a muscle group and its rep range. You type the actual exercise on the Today screen. Changes apply from the next session you open.</div>
    <div class="chips">${['push', 'pull', 'legs'].map(x => `<button class="chip ${x === d ? 'on' : ''}" data-act="sday" data-day="${x}">${DAY_NAMES[x]}</button>`).join('')}</div>
    ${S.program[d].map((sl, i) => `<div class="slot" data-i="${i}">
      <input class="nm" data-f="muscle" value="${esc(sl.muscle)}">
      <span class="rr"><input data-f="min" inputmode="numeric" value="${sl.min}">–<input data-f="max" inputmode="numeric" value="${sl.max}"></span>
      <span class="mv"><button data-act="up" aria-label="Move up">↑</button><button data-act="down" aria-label="Move down">↓</button></span>
      <button class="x" data-act="rm-slot" aria-label="Remove">×</button>
    </div>`).join('')}
    <button class="add-set" data-act="add-slot">+ Add slot</button>
  </div>
  <div class="panel">
    <h3>Rotation</h3>
    <div class="sub" style="margin:0">Push → Pull → Legs → Rest. “Up next” follows your last logged workout, so a missed day never skips one.</div>
  </div>
  <div class="panel">
    <h3>Units &amp; progression</h3>
    <div class="row"><span>Weight unit</span><div class="seg" style="width:140px">
      <button class="${unit() === 'kg' ? 'on' : ''}" data-act="unit" data-u="kg">kg</button><button class="${unit() === 'lb' ? 'on' : ''}" data-act="unit" data-u="lb">lb</button></div></div>
    <div class="row"><span>Weight jump when you top the rep range</span><input id="inc" inputmode="decimal" value="${fmt(S.settings.inc)}"></div>
  </div>
  <div class="panel">
    <h3>Backup</h3>
    <div class="sub">Your data saves on this phone automatically. A backup file is only a safety net, e.g. when switching phones.</div>
    <button class="btn ghost" data-act="export">Download backup</button>
    <button class="btn ghost" style="margin-top:8px" data-act="import">Restore from backup</button>
    <input type="file" id="import-file" accept="application/json,.json" hidden>
    <div class="saved">${msg}</div>
  </div>`;
}

function onSettingsClick(e) {
  const b = e.target.closest('[data-act]');
  if (!b) return;
  const act = b.dataset.act, list = S.program[S.ui.settingsDay];
  const i = b.closest('.slot') ? +b.closest('.slot').dataset.i : -1;
  if (act === 'sday') S.ui.settingsDay = b.dataset.day;
  else if (act === 'up' && i > 0) [list[i - 1], list[i]] = [list[i], list[i - 1]];
  else if (act === 'down' && i < list.length - 1) [list[i + 1], list[i]] = [list[i], list[i + 1]];
  else if (act === 'rm-slot') { if (!confirm(`Remove “${list[i].muscle}” from ${DAY_NAMES[S.ui.settingsDay]}? Logged history stays.`)) return; list.splice(i, 1); }
  else if (act === 'add-slot') list.push(slot('s' + Date.now().toString(36), 'New slot', 'New slot', 8, 12));
  else if (act === 'unit') S.settings.unit = b.dataset.u;
  else if (act === 'export') return exportData();
  else if (act === 'import') return $('#import-file').click();
  else return;
  save(); renderSettings();
}
function onSettingsChange(e) {
  const t = e.target;
  if (t.id === 'inc') { const v = num(t.value); if (v != null && v > 0) S.settings.inc = v; save(); return; }
  if (t.id === 'import-file') return importData(t.files[0]);
  const row = t.closest('.slot');
  if (!row) return;
  const sl = S.program[S.ui.settingsDay][+row.dataset.i];
  if (t.dataset.f === 'muscle') {
    const v = t.value.trim() || sl.muscle;
    if (sl.group === sl.muscle) sl.group = v;   // custom slots count under their own name
    sl.muscle = v;
  } else {
    const v = Math.round(num(t.value));
    if (v > 0) sl[t.dataset.f] = v;
    if (sl.min > sl.max) [sl.min, sl.max] = [sl.max, sl.min];
  }
  save(); renderSettings();
}

function exportData() {
  const blob = new Blob([JSON.stringify(S, null, 1)], { type: 'application/json' });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = `gymprogress-backup-${TODAY}.json`;
  document.body.appendChild(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(a.href), 1000);
}
function importData(file) {
  if (!file) return;
  const r = new FileReader();
  r.onload = () => {
    try {
      const s = JSON.parse(r.result);
      if (!s || s.v !== 1 || !Array.isArray(s.sessions)) throw new Error('not a GymProgress backup');
      if (!confirm(`Replace all data on this phone with the backup (${s.sessions.length} sessions, ${s.body.length} body entries)?`)) return;
      S = Object.assign(freshState(), s, { ui: Object.assign(freshState().ui, s.ui) });
      save(); renderSettings('Backup restored ✓');
    } catch (err) { renderSettings('Could not read that file: ' + err.message); }
  };
  r.readAsText(file);
}

// ---------- navigation ----------
const VIEWS = { today: renderToday, progress: renderProgress, body: renderBody, settings: renderSettings };
function show(v) {
  if (!VIEWS[v]) v = 'today';
  for (const k in VIEWS) $('#v-' + k).hidden = k !== v;
  $$('.menu a').forEach(a => a.classList.toggle('cur', a.dataset.v === v));
  $('#title').textContent = v === 'today' ? 'Today' : v[0].toUpperCase() + v.slice(1);
  document.body.classList.toggle('picked', v === 'today' && !!currentSession());
  document.body.classList.remove('menu-open');
  VIEWS[v]();
  window.scrollTo(0, 0);
  if (location.hash.slice(1) !== v) history.replaceState(null, '', location.pathname + location.search + '#' + v);
}

$('#date').textContent = dateOf(TODAY).toLocaleDateString('en-GB', { weekday: 'long', day: 'numeric', month: 'short' });
$('#burger').addEventListener('click', () => document.body.classList.add('menu-open'));
$('#scrim').addEventListener('click', () => document.body.classList.remove('menu-open'));
$('#menu-close').addEventListener('click', () => document.body.classList.remove('menu-open'));
$$('.menu a').forEach(a => a.addEventListener('click', e => { e.preventDefault(); show(a.dataset.v); }));

const vt = $('#v-today');
vt.addEventListener('click', onTodayClick);
vt.addEventListener('input', onTodayInput);
vt.addEventListener('change', onTodayChange);
$('#v-progress').addEventListener('change', e => { if (e.target.id === 'ex-pick') { S.ui.progressEx = e.target.value; save(); renderProgress(); } });
$('#v-body').addEventListener('click', onBodyClick);
$('#v-body').addEventListener('toggle', e => { if (e.target.id === 'm-details') { S.ui.measureOpen = e.target.open; save(); } }, true);
$('#v-settings').addEventListener('click', onSettingsClick);
$('#v-settings').addEventListener('change', onSettingsChange);

// Coming back to the app on a new day (it may have stayed open overnight)
// should land on that day's picker, not yesterday's workout.
document.addEventListener('visibilitychange', () => {
  if (document.visibilityState === 'visible' && !new URLSearchParams(location.search).get('date') && iso(new Date()) !== TODAY) location.reload();
});

show(location.hash.slice(1) || 'today');

if ('serviceWorker' in navigator && location.protocol.startsWith('http')) {
  navigator.serviceWorker.register('sw.js').catch(() => {});
}
