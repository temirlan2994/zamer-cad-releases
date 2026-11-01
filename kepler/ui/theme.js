// Тема оформления: светлая / тёмная / системная.

import { toast } from './dom.js';
import { requestDraw } from './view.js';

const THEME_KEY = 'kepler-theme';

// --- Тема: система (по умолчанию) → светлая → тёмная ---
function prefersDark() {
  return window.matchMedia?.('(prefers-color-scheme: dark)').matches ?? false;
}

function applyTheme(mode) {
  const root = document.documentElement;
  if (mode === 'light' || mode === 'dark') root.dataset.theme = mode;
  else delete root.dataset.theme;
  const btn = document.getElementById('themeBtn');
  if (btn) {
    const effectiveDark = mode === 'dark' || (mode === 'system' && prefersDark());
    btn.textContent = effectiveDark ? '☾' : '☀';
    btn.title = `Тема: ${mode === 'system' ? 'как в системе' : mode === 'light' ? 'светлая' : 'тёмная'} — нажмите, чтобы сменить`;
  }
}

export function loadTheme() {
  let mode = 'system';
  try { mode = localStorage.getItem(THEME_KEY) || 'system'; } catch { /* нет доступа */ }
  applyTheme(mode);
  return mode;
}

export function cycleTheme() {
  let current = 'system';
  try { current = localStorage.getItem(THEME_KEY) || 'system'; } catch { /* нет */ }
  const next = current === 'system' ? 'light' : current === 'light' ? 'dark' : 'system';
  try { localStorage.setItem(THEME_KEY, next); } catch { /* нет */ }
  applyTheme(next);
  requestDraw();
  toast(`Тема: ${next === 'system' ? 'как в системе' : next === 'light' ? 'светлая' : 'тёмная'}`);
}

export function bindTheme() {
  window.matchMedia('(prefers-color-scheme: dark)').addEventListener?.('change', () => {
    let mode = 'system';
    try { mode = localStorage.getItem(THEME_KEY) || 'system'; } catch { /* нет */ }
    if (mode === 'system') applyTheme('system');
    requestDraw();
  });
}
