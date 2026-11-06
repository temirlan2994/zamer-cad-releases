// Кнопка «⚠ N» в левом верхнем углу холста и панель замечаний: связность и
// двери, нормы, свет, проходы у мебели, перекрытия, стены и зазоры — всё
// одним списком по группам (core/issues.js). Клик по замечанию — выбрать
// объект, показать его на плане (этаж и режим «План» — при необходимости) и
// на мгновение подсветить. Список считается в store после каждой правки
// (state.issues); открыта панель или нет — не сохраняется.

import { roomById } from '../core/model.js';
import { trimRoomBy } from '../core/norms.js';
import { planGapMove } from '../core/gaps.js';
import { el, escapeHtml, toast } from './dom.js';
import { focusedGap } from './gaps.js';
import { findWall } from './hit.js';
import { switchLevel } from './levels.js';
import { setEditorMode } from './modes.js';
import { dockGapPair } from './plan-actions.js';
import { state } from './state.js';
import { mutate } from './store.js';
import { selectObject } from './tools.js';
import { requestDraw, showPlanRect } from './view.js';
import { splitByWallAction } from './wall-tool.js';

const narrow = () => window.matchMedia?.('(max-width: 640px)').matches;
let flashTimers = [];

export function isIssuesOpen() {
  return el('issuesPanel') ? !el('issuesPanel').hidden : false;
}

export function setIssuesOpen(open) {
  const panel = el('issuesPanel');
  if (!panel) return;
  panel.hidden = !open;
  el('issuesBtn')?.setAttribute('aria-expanded', String(open));
  document.body.classList.toggle('issues-open', open);
  if (open) renderIssues();
}

const entryById = (id) => (state.issues?.groups || []).flatMap((g) => g.items).find((it) => it.id === id) || null;

function actionHtml(entry, action, i) {
  let label = action.label;
  if (action.kind === 'dock-gap') {
    // Сдвиг считается только для выбранной пары (как раньше на плашке).
    const focused = focusedGap();
    if (focused && focused.key === action.key && entry.levelId === state.project.activeLevel) {
      const plan = planGapMove(state.project, focused);
      label = plan.move
        ? `Пристыковать (сдвинуть «${plan.move.name}» на ${Math.round(plan.move.distance)} мм)`
        : 'Пристыковать сдвигом нельзя';
      if (!plan.move) return `<span class="issue-why">Пристыковать сдвигом нельзя: ${escapeHtml(plan.reason)}. Поправьте положение вручную.</span>`;
    }
  }
  return `<button type="button" class="issue-action" data-action="${action.kind}" data-issue="${escapeHtml(entry.id)}" data-index="${i}">${escapeHtml(label)}</button>`;
}

function entryHtml(entry) {
  const mark = entry.mark || (entry.severity === 'warn' ? '⚠' : '✓');
  const sel = isTargetSelected(entry.target) ? ' selected' : '';
  const go = entry.target || entry.focus;
  const body = `<span class="issue-mark">${mark}</span><span class="issue-text">${entry.title ? `<b>${escapeHtml(entry.title)}</b> ` : ''}${escapeHtml(entry.text)}${entry.levelName ? ` <em>${escapeHtml(entry.levelName)}</em>` : ''}</span>`;
  return `<li class="issue ${entry.severity}${sel}" data-issue-id="${escapeHtml(entry.id)}">
      ${go ? `<button type="button" class="issue-go" data-goto="${escapeHtml(entry.id)}" title="Показать на плане">${body}</button>` : `<div class="issue-go static">${body}</div>`}
      ${entry.actions.length ? `<div class="issue-actions">${entry.actions.map((a, i) => actionHtml(entry, a, i)).join('')}</div>` : ''}
    </li>`;
}

function isTargetSelected(target) {
  const sel = state.selection;
  if (!target || !sel || sel.type !== target.type) return false;
  if (target.type === 'multi') return JSON.stringify([...(sel.roomIds || [])].sort()) === JSON.stringify([...target.roomIds].sort()) && (sel.itemIds || []).length === target.itemIds.length;
  if (target.type === 'wall') return sel.key === target.key;
  return sel.id === target.id;
}

// Кнопка и (если открыта) панель. Дёшево: только DOM из state.issues.
export function renderIssues() {
  const btn = el('issuesBtn');
  const panel = el('issuesPanel');
  if (!btn || !panel) return;
  const issues = state.issues || { count: 0, severity: 'ok', groups: [] };
  btn.classList.toggle('warn', issues.count > 0);
  btn.classList.toggle('ok', !issues.count);
  const count = el('issuesCount');
  if (count) { count.textContent = String(issues.count); count.hidden = !issues.count; }
  btn.title = issues.count ? `Замечания: ${issues.count} — показать список` : 'Замечаний нет — нормы и связность в порядке';
  btn.setAttribute('aria-label', btn.title);
  const groups = issues.groups.map((g) => `
    <section class="issue-group" data-group="${g.id}">
      <h4>${escapeHtml(g.title)}${g.count ? ` <span class="badge warn">${g.count}</span>` : ''}</h4>
      <ul>${g.items.map(entryHtml).join('')}</ul>
    </section>`).join('');
  panel.innerHTML = `
    <div class="issues-head"><strong>Замечания</strong>
      <span class="badge ${issues.count ? 'warn' : 'ok'}">${issues.count ? `замечаний: ${issues.count}` : 'в порядке'}</span>
      <button type="button" class="icon-btn issues-close" data-issues-close title="Закрыть (Esc)" aria-label="Закрыть">✕</button></div>
    <div class="issues-body">${groups || '<p class="empty-hint">Замечаний нет.</p>'}
      <p class="empty-hint">Ориентир: СанПиН 1.2.3685-21 (инсоляция), СП 55.13330 (дома одноквартирные). Подсказка для концепции, не экспертиза.</p>
    </div>`;
}

// Пересчёт после правки (store.afterChange) — сама сборка в core/issues.js.
export function setIssues(issues) {
  state.issues = issues;
  renderIssues();
}

function flash(rect) {
  for (const t of flashTimers) clearTimeout(t);
  flashTimers = [];
  if (!rect) return;
  const levelId = state.project.activeLevel;
  const set = (on) => { state.flash = on ? { rects: [rect], levelId } : null; requestDraw(); };
  set(true);
  flashTimers.push(setTimeout(() => set(false), 260), setTimeout(() => set(true), 480), setTimeout(() => set(false), 1100));
}

// Перейти к замечанию: режим «План», этаж, выбор, вид, подсветка.
export function goToIssue(entry) {
  if (!entry) return;
  if (state.modeName !== 'plan') setEditorMode('plan');
  if (entry.levelId && entry.levelId !== state.project.activeLevel) switchLevel(entry.levelId);
  const t = entry.target;
  if (t) {
    if (t.type === 'multi' && entry.gapKey) {
      state.gapFocus = entry.gapKey;
      selectObject({ type: 'multi', roomIds: [...t.roomIds], itemIds: [] });
    } else if (t.type === 'wall') {
      const wall = findWall(t.key);
      selectObject(wall ? { type: 'wall', key: wall.key } : { type: 'room', id: t.roomId });
    } else if (t.type === 'multi') {
      selectObject({ type: 'multi', roomIds: [...t.roomIds], itemIds: [...t.itemIds] });
    } else {
      selectObject({ type: t.type, id: t.id });
    }
  }
  const mobile = narrow();
  if (mobile) setIssuesOpen(false);
  if (entry.focus) {
    // Открытая панель на компьютере закрывает левый верх холста — объект
    // ставим правее неё.
    let left = 24;
    const panel = el('issuesPanel');
    const canvas = el('canvas');
    if (!mobile && panel && !panel.hidden && canvas) {
      left = Math.max(left, panel.getBoundingClientRect().right - canvas.getBoundingClientRect().left + 16);
    }
    showPlanRect(entry.focus, { left });
  }
  flash(entry.focus);
  renderIssues();
}

function runAction(entry, action) {
  if (entry.levelId && entry.levelId !== state.project.activeLevel) switchLevel(entry.levelId);
  if (action.kind === 'trim') {
    const room = roomById(state.project, action.roomId);
    const by = roomById(state.project, action.byId);
    if (!room || !by) return;
    let done = false;
    mutate(() => { done = trimRoomBy(room, by); });
    if (!done) toast('Обрезать не получилось: останется несколько частей или слишком мало');
  } else if (action.kind === 'split') {
    splitByWallAction(action.roomId, action.wallId);
  } else if (action.kind === 'dock-gap') {
    const gap = (state.gaps || []).find((g) => g.key === action.key);
    if (gap) dockGapPair(gap);
  }
}

export function bindIssues() {
  const btn = el('issuesBtn');
  const panel = el('issuesPanel');
  if (!btn || !panel) return;
  btn.addEventListener('click', (event) => {
    event.stopPropagation();
    setIssuesOpen(panel.hidden);
  });
  panel.addEventListener('click', (event) => {
    // Клики внутри — не «клик вне» (после правки список перерисовывается и
    // цель клика уже не в документе).
    event.stopPropagation();
    if (event.target.closest('[data-issues-close]')) { setIssuesOpen(false); return; }
    const act = event.target.closest('[data-action]');
    if (act) {
      const entry = entryById(act.dataset.issue);
      const action = entry?.actions[Number(act.dataset.index)];
      if (entry && action) runAction(entry, action);
      return;
    }
    const go = event.target.closest('[data-goto]');
    if (go) goToIssue(entryById(go.dataset.goto));
  });
  document.addEventListener('click', (event) => {
    if (!panel.hidden && !panel.contains(event.target) && !btn.contains(event.target)) setIssuesOpen(false);
  });
  document.addEventListener('keydown', (event) => {
    if (event.key === 'Escape' && !panel.hidden) {
      event.stopPropagation();
      setIssuesOpen(false);
    }
  }, true);
  renderIssues();
}
