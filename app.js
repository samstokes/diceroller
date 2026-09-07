'use strict';

// A dice roller. Everything is local: no network, no storage beyond this device.

const PRESETS = [4, 6, 8, 10, 12, 20, 100];
const MAX_DICE = 200;          // per roll, across all terms
const MAX_SIDES = 1000;
const HISTORY_MAX = 12;
const HISTORY_KEY = 'dice:history';

const el = (id) => document.getElementById(id);

let count = 1;      // dice per tap on the grid
let mod = 0;        // flat modifier added to a grid roll
let lastRoll = null; // the parsed terms of the last roll, for "roll again"
let history = [];

// --- rolling ---------------------------------------------------------------

// Rejection sampling, so every face is equally likely (a plain % is biased).
function rollDie(sides) {
  const range = 4294967296; // 2^32
  const limit = range - (range % sides);
  const buf = new Uint32Array(1);
  let v;
  do { crypto.getRandomValues(buf); v = buf[0]; } while (v >= limit);
  return (v % sides) + 1;
}

function rollTerms(terms) {
  const groups = [];
  let total = 0;

  for (const term of terms) {
    if (term.kind === 'dice') {
      const values = [];
      for (let i = 0; i < term.count; i++) values.push(rollDie(term.sides));
      total += term.sign * values.reduce((a, b) => a + b, 0);
      groups.push({ kind: 'dice', sign: term.sign, sides: term.sides, values });
    } else {
      total += term.sign * term.value;
      groups.push({ kind: 'const', sign: term.sign, value: term.value });
    }
  }

  return { terms, groups, total, label: formatTerms(terms) };
}

function formatTerms(terms) {
  return terms.map((t, i) => {
    const body = t.kind === 'dice' ? `${t.count}d${t.sides}` : String(t.value);
    if (i === 0) return (t.sign < 0 ? '−' : '') + body;
    return (t.sign < 0 ? ' − ' : ' + ') + body;
  }).join('');
}

// --- expression parsing ----------------------------------------------------

// Dice terms and whole numbers joined by + and -: "3d6 + 6", "d20-1", "2d8 + 1d4 + 3".
function parseExpression(source) {
  let rest = String(source).trim();
  if (!rest) throw new Error('Type something like 3d6 + 6');

  const terms = [];
  let dice = 0;
  let expectSign = false;

  while (rest) {
    rest = rest.replace(/^\s+/, '');
    if (!rest) break;

    let sign = 1;
    const signMatch = /^([+\-−–])\s*/.exec(rest);
    if (signMatch) {
      sign = /[-−–]/.test(signMatch[1]) ? -1 : 1;
      rest = rest.slice(signMatch[0].length);
    } else if (expectSign) {
      throw new Error(`Expected + or − before "${rest}"`);
    }

    const diceMatch = /^(\d*)\s*[dD]\s*(\d+)/.exec(rest);
    if (diceMatch) {
      const n = diceMatch[1] === '' ? 1 : parseInt(diceMatch[1], 10);
      const sides = parseInt(diceMatch[2], 10);
      if (n < 1) throw new Error('Need at least one die');
      if (sides < 2) throw new Error('A die needs at least 2 sides');
      if (sides > MAX_SIDES) throw new Error(`${sides} sides is more than I can draw (max ${MAX_SIDES})`);
      dice += n;
      if (dice > MAX_DICE) throw new Error(`That's over ${MAX_DICE} dice`);
      terms.push({ kind: 'dice', sign, count: n, sides });
      rest = rest.slice(diceMatch[0].length);
    } else {
      const numMatch = /^(\d+)/.exec(rest);
      if (!numMatch) throw new Error(`Don't understand "${rest}"`);
      terms.push({ kind: 'const', sign, value: parseInt(numMatch[1], 10) });
      rest = rest.slice(numMatch[0].length);
    }

    expectSign = true;
  }

  if (!terms.length) throw new Error('Type something like 3d6 + 6');
  return terms;
}

// --- rendering -------------------------------------------------------------

function dieChip(value, sides, klass) {
  const chip = document.createElement('div');
  chip.className = 'die' + (klass ? ' ' + klass : '');
  chip.append(String(value));
  const label = document.createElement('span');
  label.className = 'sides';
  label.textContent = 'd' + sides;
  chip.append(label);
  return chip;
}

function renderRoll(roll) {
  el('placeholder').hidden = true;
  el('error').hidden = true;
  el('output').hidden = false;

  el('total').textContent = String(roll.total);
  el('exprLabel').textContent = roll.label;

  const dice = el('dice');
  dice.textContent = '';

  for (const group of roll.groups) {
    if (group.kind === 'dice') {
      for (const value of group.values) {
        let klass = '';
        if (group.values.length > 0 && group.sides > 1) {
          if (value === group.sides) klass = 'is-max';
          else if (value === 1) klass = 'is-min';
        }
        dice.append(dieChip(group.sign < 0 ? -value : value, group.sides, klass));
      }
    } else if (group.value !== 0) {
      const chip = document.createElement('div');
      chip.className = 'die mod';
      chip.textContent = (group.sign < 0 ? '−' : '+') + group.value;
      dice.append(chip);
    }
  }

  // Restart the pop-in animation on each roll.
  const result = el('result');
  result.classList.remove('animate');
  void result.offsetWidth;
  result.classList.add('animate');
}

function showError(message) {
  el('placeholder').hidden = true;
  el('output').hidden = true;
  el('error').hidden = false;
  el('error').textContent = message;
}

function renderHint() {
  const plural = count === 1 ? 'die' : 'dice';
  if (count === 1 && mod === 0) {
    el('hintText').textContent = 'Tap a die to roll it.';
  } else {
    const modText = mod === 0 ? '' : (mod < 0 ? ' − ' : ' + ') + Math.abs(mod);
    el('hintText').innerHTML = `Tap a die to roll <b></b>`;
    el('hintText').querySelector('b').textContent = `${count}d…${modText}`;
  }
  el('reset').hidden = count === 1 && mod === 0;
  el('countVal').textContent = String(count);
  el('modVal').textContent = (mod >= 0 ? '+' : '−') + Math.abs(mod);
  el('countVal').nextElementSibling.textContent = plural;
}

function renderHistory() {
  const list = el('historyList');
  list.textContent = '';
  el('history').hidden = history.length === 0;

  for (const entry of history) {
    const li = document.createElement('li');
    const total = document.createElement('b');
    total.textContent = String(entry.total);
    const label = document.createElement('span');
    label.textContent = entry.label;
    const rolls = document.createElement('span');
    rolls.className = 'rolls';
    rolls.textContent = entry.values.length ? '(' + entry.values.join(', ') + ')' : '';
    li.append(total, label, rolls);
    list.append(li);
  }
}

// --- history ---------------------------------------------------------------

function loadHistory() {
  try {
    const raw = localStorage.getItem(HISTORY_KEY);
    if (raw) history = JSON.parse(raw).slice(0, HISTORY_MAX);
  } catch { history = []; }
}

function saveHistory() {
  try { localStorage.setItem(HISTORY_KEY, JSON.stringify(history)); } catch { /* private mode */ }
}

function recordRoll(roll) {
  const values = roll.groups
    .filter((g) => g.kind === 'dice')
    .flatMap((g) => g.values);
  history.unshift({ total: roll.total, label: roll.label, values: values.slice(0, 20) });
  history = history.slice(0, HISTORY_MAX);
  saveHistory();
  renderHistory();
}

// --- actions ---------------------------------------------------------------

function performRoll(terms) {
  const roll = rollTerms(terms);
  lastRoll = terms;
  renderRoll(roll);
  recordRoll(roll);
  if (navigator.vibrate) navigator.vibrate(12);
}

function rollPreset(sides) {
  const terms = [{ kind: 'dice', sign: 1, count, sides }];
  if (mod !== 0) terms.push({ kind: 'const', sign: mod < 0 ? -1 : 1, value: Math.abs(mod) });
  performRoll(terms);
}

function rollFromInput() {
  try {
    performRoll(parseExpression(el('exprInput').value));
  } catch (err) {
    showError(err.message);
    lastRoll = null;
  }
}

// --- wiring ----------------------------------------------------------------

const grid = el('grid');
for (const sides of PRESETS) {
  const button = document.createElement('button');
  button.type = 'button';
  button.textContent = 'd' + sides;
  button.addEventListener('click', () => rollPreset(sides));
  grid.append(button);
}

document.querySelectorAll('[data-step]').forEach((button) => {
  button.addEventListener('click', () => {
    const delta = Number(button.dataset.delta);
    if (button.dataset.step === 'count') count = Math.min(MAX_DICE, Math.max(1, count + delta));
    else mod = Math.min(99, Math.max(-99, mod + delta));
    renderHint();
  });
});

el('reset').addEventListener('click', () => { count = 1; mod = 0; renderHint(); });

el('again').addEventListener('click', () => { if (lastRoll) performRoll(lastRoll); });

el('exprForm').addEventListener('submit', (e) => {
  e.preventDefault();
  el('exprInput').blur();
  rollFromInput();
});

el('clearHistory').addEventListener('click', () => {
  history = [];
  saveHistory();
  renderHistory();
});

// --- platform --------------------------------------------------------------

// Android's install prompt: stash the event, show our own button.
let deferredPrompt = null;
window.addEventListener('beforeinstallprompt', (e) => {
  e.preventDefault();
  deferredPrompt = e;
  el('install').hidden = false;
});

el('install').addEventListener('click', () => {
  if (!deferredPrompt) return;
  el('install').hidden = true;
  deferredPrompt.prompt();
  deferredPrompt = null;
});

window.addEventListener('appinstalled', () => { el('install').hidden = true; });

if ('serviceWorker' in navigator) {
  window.addEventListener('load', () => {
    navigator.serviceWorker.register('./sw.js').catch(() => { /* fine without offline */ });
  });
}

// A ?roll= deep link (or a shared "3d6+6") rolls straight away.
const shared = new URLSearchParams(location.search).get('roll')
  || new URLSearchParams(location.search).get('text');
if (shared) {
  el('exprInput').value = shared.trim();
  rollFromInput();
}

loadHistory();
renderHistory();
renderHint();

// Exposed for the headless smoke test.
window.__dice = { parseExpression, rollTerms, rollDie };
