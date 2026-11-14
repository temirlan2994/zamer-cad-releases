// Вкладка «⚠ Замечания» правой панели (на телефоне — кнопка «⚠ N» в углу
// холста) и список замечаний: связность и
// двери, нормы, свет, проходы у мебели, перекрытия, стены и зазоры — всё
// одним списком по группам (core/issues.js). Клик по замечанию — выбрать
// объект, показать его на плане (этаж и режим «План» — при необходимости) и
// на мгновение подсветить. Список считается в store после каждой правки
// (state.issues); открыта панель или нет — не сохраняется.
// Сверху — переключатели групп (хранятся у пользователя, localStorage
// kepler-issues-groups); у замечания — «✕» (скрыть: id в проекте,
// project.settings.dismissedIssues, с отменой); внизу — «Скрытые (N)».

import { DEFAULT_ISSUE_GROUPS, ISSUE_GROUPS } from '../core/issues.js';
import { roomById } from '../core/model.js';
import { trimRoomBy } from '../core/norms.js';
import { planGapMove } from '../core/gaps.js';
import { el, escapeHtml, toast } from './dom.js';
import { focusedGap } from './gaps.js';
import { findWall } from './hit.js';
import { switchLevel } from './levels.js';
import { setEditorMode } from './modes.js';
import { setErgoPref } from './render-ergonomics.js';
import { applyGapFix } from './plan-actions.js';
import { planGapStretch, planGapThicken } from '../core/gap-fix.js';
import { state } from './state.js';
import { mutate, refreshIssues } from './store.js';
import { selectObject } from './tools.js';
import { requestDraw, showPlanRect } from './view.js';
import { splitByWallAction } from './wall-tool.js';

const narrow = () => window.matchMedia?.('(max-width: 640px)').matches;
let flashTimers = [];
let hiddenOpen = false;

// --- Включённые группы замечаний (у пользователя, не в проекте).
const GROUPS_KEY = 'kepler-issues-groups';
let enabledGroups = null;

export function issueGroupsEnabled() {
  if (enabledGroups) return enabledGroups;
  let saved;
  try { saved = JSON.parse(localStorage.getItem(GROUPS_KEY) || 'null'); } catch { saved = null; }
  const known = new Set(ISSUE_GROUPS.map((g) => g.id).filter((id) => id !== 'ergo')); // ergo — по режиму
  enabledGroups = Array.isArray(saved) ? saved.filter((id) => known.has(id)) : [...DEFAULT_ISSUE_GROUPS];
  return enabledGroups;
}

export function setIssueGroupEnabled(id, on) {
  const list = new Set(issueGroupsEnabled());
  if (on) list.add(id); else list.delete(id);
  enabledGroups = ISSUE_GROUPS.map((g) => g.id).filter((g) => list.has(g));
  try { localStorage.setItem(GROUPS_KEY, JSON.stringify(enabledGroups)); } catch { /* хранилище недоступно */ }
  refreshIssues();
}

// --- Скрытые замечания (в проекте, с отменой).
function setDismissed(id, on) {
  mutate(() => {
    const s = state.project.settings || (state.project.settings = {});
    const list = new Set(Array.isArray(s.dismissedIssues) ? s.dismissedIssues : []);
    if (on) list.add(id); else list.delete(id);
    if (list.size) s.dismissedIssues = [...list]; else delete s.dismissedIssues;
  });
}

export function isIssuesOpen() {
  return el('issuesPanel') ? !el('issuesPanel').hidden : false;
}

export function setIssuesOpen(open) {
  const panel = el('issuesPanel');
  if (!panel) return;
  panel.hidden = !open;
  el('issuesBtn')?.setAttribute('aria-expanded', String(open));
  document.body.classList.toggle('issues-open', open);
  syncPropsTabs();
  if (open) renderIssues();
}

// Компьютер: «⚠ Замечания» — третья вкладка правой панели, список — вместо
// её содержимого. Телефон: кнопка и лист — на холсте (правая панель там —
// выдвижная). Узлы переносятся целиком, обработчики остаются.
function placeIssues() {
  const btn = el('issuesBtn');
  const panel = el('issuesPanel');
  const props = el('propsPanel');
  const tabs = props?.querySelector('.props-tabs');
  const wrap = document.querySelector('.canvas-wrap');
  if (!btn || !panel || !tabs || !wrap) return;
  if (narrow()) {
    if (btn.parentElement !== wrap) wrap.insertBefore(btn, wrap.children[1] || null);
    if (panel.parentElement !== wrap) btn.after(panel);
    btn.removeAttribute('role');
  } else {
    if (btn.parentElement !== tabs) tabs.appendChild(btn);
    if (panel.parentElement !== props) props.appendChild(panel);
    btn.setAttribute('role', 'tab');
  }
  syncPropsTabs();
}

// Открытые замечания — активная вкладка, «Свойства»/«ТЭП» гаснут.
function syncPropsTabs() {
  const open = isIssuesOpen() && !narrow();
  for (const b of document.querySelectorAll('#propsPanel [data-props-tab]')) {
    const on = !open && b.dataset.propsTab === (state.propsTab || 'props');
    b.classList.toggle('active', on);
    b.setAttribute('aria-selected', String(on));
  }
  const btn = el('issuesBtn');
  if (btn?.closest('.props-tabs')) btn.setAttribute('aria-selected', String(open));
}

const entryById = (id) => (state.issues?.groups || []).flatMap((g) => g.items).find((it) => it.id === id) || null;

function actionHtml(entry, action, i) {
  const attrs = `data-action="${action.kind}" data-issue="${escapeHtml(entry.id)}" data-index="${i}"`;
  if (action.kind === 'dock-gap') {
    // Способы исправить считаются только для выбранной пары (как на плашке над планом).
    const focused = focusedGap();
    if (focused && focused.key === action.key && entry.levelId === state.project.activeLevel) {
      const move = planGapMove(state.project, focused);
      const stretch = planGapStretch(state.project, focused);
      const thick = planGapThicken(state.project, focused);
      const parts = [];
      const add = (fix, label, ok, why) => parts.push(ok
        ? `<button type="button" class="issue-action" ${attrs} data-fix="${fix}">${escapeHtml(label)}</button>`
        : `<span class="issue-why">${escapeHtml(label)} нельзя: ${escapeHtml(why)}.</span>`);
      add('move', move.move ? `Сдвинуть «${move.move.name}» на ${Math.round(move.move.distance)} мм` : 'Сдвинуть', Boolean(move.move), move.reason);
      add('stretch', stretch.move ? `${stretch.move.direction === 'out' ? 'Продлить' : 'Сузить'} сторону «${stretch.move.name}» на ${Math.round(stretch.move.distance)} мм` : 'Растянуть', Boolean(stretch.move), stretch.reason);
      add('thicken', thick.thickness != null ? `Стена ${thick.thickness} мм, комнаты на месте` : 'Сделать стену', thick.thickness != null, thick.reason);
      return parts.join('');
    }
  }
  return `<button type="button" class="issue-action" ${attrs}>${escapeHtml(action.label)}</button>`;
}

function entryHtml(entry) {
  const mark = entry.mark || (entry.severity === 'warn' ? '⚠' : '✓');
  const sel = isTargetSelected(entry.target) ? ' selected' : '';
  const go = entry.target || entry.focus;
  const body = `<span class="issue-mark">${mark}</span><span class="issue-text">${entry.title ? `<b>${escapeHtml(entry.title)}</b> ` : ''}${escapeHtml(entry.text)}${entry.levelName ? ` <em>${escapeHtml(entry.levelName)}</em>` : ''}</span>`;
  const dismiss = entry.severity === 'warn'
    ? `<button type="button" class="issue-dismiss" data-dismiss="${escapeHtml(entry.id)}" title="Не нужно — скрыть замечание" aria-label="Скрыть замечание">✕</button>`
    : '';
  return `<li class="issue ${entry.severity}${sel}" data-issue-id="${escapeHtml(entry.id)}">
      <div class="issue-row">${go ? `<button type="button" class="issue-go" data-goto="${escapeHtml(entry.id)}" title="Показать на плане">${body}</button>` : `<div class="issue-go static">${body}</div>`}${dismiss}</div>
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
  const enabled = new Set(issueGroupsEnabled());
  const summary = issues.summary || ISSUE_GROUPS.map((g) => ({ ...g, enabled: enabled.has(g.id), count: 0 }));
  const hidden = issues.hidden || [];
  const onCount = summary.filter((g) => g.enabled).length;
  const quiet = `Замечаний нет (включено групп: ${onCount} из ${summary.length})`;
  btn.classList.toggle('warn', issues.count > 0);
  btn.classList.toggle('ok', !issues.count);
  const count = el('issuesCount');
  if (count) { count.textContent = String(issues.count); count.hidden = !issues.count; }
  // Без title: подсказка — своя (.ptab-tip), сразу при наведении.
  const label = issues.count ? `Замечания: ${issues.count} — показать список` : `Замечания: нет (включено групп: ${onCount} из ${summary.length})`;
  btn.removeAttribute('title');
  btn.setAttribute('aria-label', label);
  const tip = el('ptabTip-issues');
  if (tip) tip.innerHTML = '<b>Замечания</b>'; // только название (число — значком на кнопке)
  const chips = summary.map((g) => {
    const label = g.enabled ? `${g.short} ${g.count}` : `${g.short} выкл`;
    return `<button type="button" class="issue-chip${g.enabled && g.count ? ' has-warn' : ''}" data-issue-group="${g.id}" aria-pressed="${g.enabled}" title="${escapeHtml(g.title)} — ${g.enabled ? 'выключить' : 'включить'}">${escapeHtml(label)}</button>`;
  }).join('');
  const groups = issues.groups.map((g) => `
    <section class="issue-group" data-group="${g.id}">
      <h4>${escapeHtml(g.title)}${g.count ? ` <span class="badge warn">${g.count}</span>` : ''}</h4>
      <ul>${g.items.map(entryHtml).join('')}</ul>
    </section>`).join('');
  const hiddenList = hidden.map((it) => `<li data-hidden-id="${escapeHtml(it.id)}"><span>${it.title ? `<b>${escapeHtml(it.title)}</b> ` : ''}${escapeHtml(it.text)}</span><button type="button" class="issue-action" data-restore="${escapeHtml(it.id)}">Вернуть</button></li>`).join('');
  const hiddenHtml = hidden.length ? `
      <div class="issues-hidden">
        <button type="button" class="issues-hidden-toggle" data-hidden-toggle aria-expanded="${hiddenOpen}">${hiddenOpen ? '▾' : '▸'} Скрытые (${hidden.length})</button>
        ${hiddenOpen ? `<ul>${hiddenList}</ul>` : ''}
      </div>` : '';
  panel.innerHTML = `
    <div class="issues-head"><strong>Замечания</strong>
      <span class="badge ${issues.count ? 'warn' : 'ok'}">${issues.count ? `замечаний: ${issues.count}` : 'в порядке'}</span>
      <button type="button" class="icon-btn issues-close" data-issues-close title="Закрыть (Esc)" aria-label="Закрыть">✕</button></div>
    <div class="issues-chips" role="group" aria-label="Группы замечаний">${chips}</div>
    <div class="issues-body">${groups}${issues.count ? '' : `<p class="empty-hint issues-quiet">${quiet}.</p>`}${hiddenHtml}
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
    if (!mobile && panel && !panel.hidden && canvas && panel.closest('.canvas-wrap')) {
      left = Math.max(left, panel.getBoundingClientRect().right - canvas.getBoundingClientRect().left + 16);
    }
    showPlanRect(entry.focus, { left });
  }
  flash(entry.focus);
  renderIssues();
}

function runAction(entry, action, fix = 'move') {
  if (entry.levelId && entry.levelId !== state.project.activeLevel) switchLevel(entry.levelId);
  if (action.kind === 'trim') {
    const room = roomById(state.project, action.roomId);
    const by = roomById(state.project, action.byId);
    if (!room || !by) return;
    let done = false;
    mutate(() => { done = trimRoomBy(room, by, state.project); });
    if (!done) toast('Обрезать не получилось: останется несколько частей или слишком мало');
  } else if (action.kind === 'split') {
    splitByWallAction(action.roomId, action.wallId);
  } else if (action.kind === 'dock-gap') {
    const gap = (state.gaps || []).find((g) => g.key === action.key);
    if (gap) applyGapFix(gap, fix);
  }
}

export function bindIssues() {
  const btn = el('issuesBtn');
  const panel = el('issuesPanel');
  if (!btn || !panel) return;
  placeIssues();
  window.matchMedia?.('(max-width: 640px)').addEventListener?.('change', placeIssues);
  btn.addEventListener('click', (event) => {
    event.stopPropagation();
    setIssuesOpen(panel.hidden);
  });
  panel.addEventListener('click', (event) => {
    // Клики внутри — не «клик вне» (после правки список перерисовывается и
    // цель клика уже не в документе).
    event.stopPropagation();
    if (event.target.closest('[data-issues-close]')) { setIssuesOpen(false); return; }
    const chip = event.target.closest('[data-issue-group]');
    if (chip) {
      const on = chip.getAttribute('aria-pressed') !== 'true';
      // «Эргономика» — это режим (ui/ergonomics.js): чип включает/выключает его.
      if (chip.dataset.issueGroup === 'ergo') setErgoPref({ on });
      else setIssueGroupEnabled(chip.dataset.issueGroup, on);
      return;
    }
    const dismiss = event.target.closest('[data-dismiss]');
    if (dismiss) { setDismissed(dismiss.dataset.dismiss, true); return; }
    const restore = event.target.closest('[data-restore]');
    if (restore) { setDismissed(restore.dataset.restore, false); return; }
    if (event.target.closest('[data-hidden-toggle]')) { hiddenOpen = !hiddenOpen; renderIssues(); return; }
    const act = event.target.closest('[data-action]');
    if (act) {
      const entry = entryById(act.dataset.issue);
      const action = entry?.actions[Number(act.dataset.index)];
      if (entry && action) runAction(entry, action, act.dataset.fix);
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
