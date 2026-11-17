// Режим «Эргономика» (core/ergonomics.js, рисует ui/render-ergonomics.js):
// кнопка в колонке инструментов (#ergoToolBtn, клавиша E) со счётчиком
// ошибок и замечаний, блок настроек во «Видах» (группы правил, нормальные
// зоны, тепловая карта), блок «Эргономика предмета» в «Свойствах» выбранного
// предмета (находки, «Показать», «Исправить» — сдвиг одним шагом истории).
// Замечания режима — группа «Эргономика» во вкладке «⚠» (core/issues.js).

import { ERGO_GROUPS, roomOfItem, suggestErgoFix } from '../core/ergonomics.js';
import { itemBounds } from '../core/clearance.js';
import { unionRect } from '../core/issues.js';
import { el, escapeHtml, toast } from './dom.js';
import { renderProps } from './props.js';
import { ergoAnalysis, ergoFindings, ergoHooks, ergoOn, ergoPref, setErgoPref } from './render-ergonomics.js';
import { state } from './state.js';
import { mutate, refreshIssues } from './store.js';
import { requestDraw, showPlanRect } from './view.js';

let lastBadge = '';

// Счётчик на кнопке: «3 · 5» (ошибки · замечания); режим выключен — скрыт.
function syncBadge(counts) {
  const badge = el('ergoBadge');
  if (!badge) return;
  const text = counts && ergoOn() ? (counts.error || counts.warn ? `${counts.error}·${counts.warn}` : '✓') : '';
  const cls = !counts ? '' : counts.error ? 'error' : counts.warn ? 'warn' : 'ok';
  const key = `${text}|${cls}`;
  if (key === lastBadge) return;
  lastBadge = key;
  badge.textContent = text;
  badge.hidden = !text;
  badge.className = `tb-badge ${cls}`;
  const btn = el('ergoToolBtn');
  if (btn) {
    btn.dataset.errors = String(counts?.error || 0);
    btn.dataset.warns = String(counts?.warn || 0);
    btn.setAttribute('aria-label', counts && ergoOn()
      ? `Эргономика: ошибок ${counts.error}, замечаний ${counts.warn}` : 'Эргономика');
  }
}

export function syncErgoButton() {
  const btn = el('ergoToolBtn');
  if (!btn) return;
  const on = ergoPref().on;
  btn.classList.toggle('active', on);
  btn.setAttribute('aria-pressed', String(on));
  if (!on) syncBadge(null);
}

export function toggleErgo(on = !ergoPref().on) {
  setErgoPref({ on });
  if (on) {
    const { counts } = ergoAnalysis();
    toast(counts.error || counts.warn
      ? `Эргономика: ошибок ${counts.error}, замечаний ${counts.warn} — красным и жёлтым на плане`
      : 'Эргономика: проходы и зазоры в норме');
  }
}

export function bindErgonomics() {
  ergoHooks.redraw = requestDraw;
  ergoHooks.counts = syncBadge;
  ergoHooks.changed = () => {
    syncErgoButton();
    refreshIssues();
    renderProps();
    requestDraw();
  };
  el('ergoToolBtn')?.addEventListener('click', () => toggleErgo());
  syncErgoButton();
}

// Клавиша E — вкл/выкл (в «Плане»).
export function handleErgoKey(event) {
  if (event.code !== 'KeyE' || event.ctrlKey || event.metaKey || event.altKey || event.shiftKey) return false;
  if (state.modeName && state.modeName !== 'plan') return false;
  toggleErgo();
  return true;
}

// ------------------------------------------------------------ «Виды»: настройки

export function ergoViewBlock() {
  const pref = ergoPref();
  const counts = pref.on ? ergoAnalysis().counts : null;
  const dis = pref.on ? '' : 'disabled';
  return `
    <h3>Эргономика мебели</h3>
    <div class="prop-block" id="viewsErgo">
      <label class="check-row"><input type="checkbox" id="viewsErgoOn" ${pref.on ? 'checked' : ''}><span>Анализ эргономики</span>${counts ? `<em>${counts.error}·${counts.warn}</em>` : ''}</label>
      <div class="views-ls-groups${pref.on ? '' : ' off'}">
        ${ERGO_GROUPS.map((g) => `<label class="check-row"><input type="checkbox" data-ergo-group="${g.id}" ${pref.groups[g.id] ? 'checked' : ''} ${dis}><span>${escapeHtml(g.title)}</span></label>`).join('')}
      </div>
      <label class="check-row"><input type="checkbox" id="viewsErgoOk" ${pref.okZones ? 'checked' : ''} ${dis}><span>Показывать нормальные зоны (зелёным)</span></label>
      <label class="check-row"><input type="checkbox" id="viewsErgoHeat" ${pref.heat ? 'checked' : ''} ${dis}><span>Проходимость (тепловая карта)</span></label>
      <p class="hint">Красным — меньше нормы (ошибка), жёлтым — тесно. Зазоры меряются по зоне пользования: перед шкафом, сбоку кровати, за стулом. Проходимость: красное — уже 600 мм, жёлтое — уже 800. Клавиша <kbd>E</kbd>. На листы и печать не выводится.</p>
    </div>`;
}

export function bindErgoViewBlock(panel, rerender) {
  panel.querySelector('#viewsErgoOn')?.addEventListener('change', (e) => { setErgoPref({ on: e.target.checked }); rerender(); });
  panel.querySelector('#viewsErgoOk')?.addEventListener('change', (e) => { setErgoPref({ okZones: e.target.checked }); });
  panel.querySelector('#viewsErgoHeat')?.addEventListener('change', (e) => { setErgoPref({ heat: e.target.checked }); });
  panel.querySelectorAll('[data-ergo-group]').forEach((box) => box.addEventListener('change', () => {
    setErgoPref({ groups: { [box.dataset.ergoGroup]: box.checked } });
  }));
}

// ------------------------------------------------------------ «Свойства» предмета

const polyRect = (pts) => {
  if (!pts?.length) return null;
  const xs = pts.map((p) => p.x); const ys = pts.map((p) => p.y);
  return { x: Math.min(...xs), y: Math.min(...ys), w: Math.max(...xs) - Math.min(...xs), h: Math.max(...ys) - Math.min(...ys) };
};

// Прямоугольник находки (оси дома): зона, полоса, штриховка и предметы.
export function ergoFocusRect(f, project = state.project) {
  const items = f.itemIds.map((id) => project.items.find((it) => it.id === id)).filter(Boolean);
  return unionRect([
    polyRect(f.zone), polyRect(f.band), ...(f.hatch || []).map(polyRect),
    f.labelAt ? { x: f.labelAt.x - 300, y: f.labelAt.y - 300, w: 600, h: 600 } : null,
    ...items.map(itemBounds),
  ]);
}

function itemFindings(item) {
  return ergoFindings().filter((f) => f.itemIds.includes(item.id));
}

export function ergoItemSection(item) {
  if (!item || !ergoOn() || item.kind === 'stairs') return '';
  const list = itemFindings(item);
  const rows = list.map((f) => {
    let fix = null;
    if (f.rule === 'zone' && f.itemIds[0] === item.id) {
      try { fix = suggestErgoFix(state.project, state.walls, f); } catch { fix = null; }
    }
    return `<li class="ergo-f ${f.severity}" data-ergo-id="${escapeHtml(f.id)}">
        <span class="ergo-mark">${f.severity === 'error' ? '⛔' : '⚠'}</span><span class="ergo-text">${escapeHtml(f.text)}</span>
        <span class="ergo-acts"><button type="button" data-ergo-show="${escapeHtml(f.id)}">Показать</button>${fix ? `<button type="button" data-ergo-fix="${escapeHtml(f.id)}" data-dx="${fix.dx}" data-dy="${fix.dy}" title="Сдвинуть предмет на ${Math.round(Math.hypot(fix.dx, fix.dy))} мм; Ctrl+Z — вернуть">Исправить: ${escapeHtml(fix.text.toLowerCase())}</button>` : ''}</span>
      </li>`;
  }).join('');
  return `
    <h3>Эргономика предмета</h3>
    <div class="prop-block ergo-item" id="ergoItem">
      ${list.length ? `<ul class="ergo-list">${rows}</ul>` : '<p class="empty-hint ergo-ok">✓ Зазоры и проходы у предмета в норме.</p>'}
    </div>`;
}

export function bindErgoItemSection(panel, item) {
  const box = panel.querySelector('#ergoItem');
  if (!box || !item) return;
  box.addEventListener('click', (event) => {
    const show = event.target.closest('[data-ergo-show]');
    if (show) {
      const f = itemFindings(item).find((x) => x.id === show.dataset.ergoShow);
      if (!f) return;
      state.ergoFocus = f.id;
      const r = ergoFocusRect(f);
      if (r) showPlanRect(r, { left: 24 });
      requestDraw();
      return;
    }
    const fixBtn = event.target.closest('[data-ergo-fix]');
    if (fixBtn) {
      const dx = Number(fixBtn.dataset.dx); const dy = Number(fixBtn.dataset.dy);
      if (!Number.isFinite(dx) || !Number.isFinite(dy)) return;
      const live = state.project.items.find((it) => it.id === item.id);
      if (!live || !roomOfItem(state.project, live)) return;
      state.ergoFocus = null;
      mutate(() => { live.x += dx; live.y += dy; });
      toast(`Сдвинуто на ${Math.round(Math.hypot(dx, dy))} мм · Ctrl+Z — вернуть`);
    }
  });
}
