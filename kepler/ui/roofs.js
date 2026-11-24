// Крыши-плиты (core/roofs.js) в редакторе: команды (накрыть помещение —
// крыша со стартовой формой по нему, править, удалить), инструмент «Крыша»
// (K): на плане этажа открывает «План крыши» (ui/roof-plan.js — там крыши
// чертятся, двигаются и правятся), в 3D — ui/roof3d.js; «Свойства» крыши с
// карточками типов края и парапета. С помещениями крыша не связана: у неё
// свой контур (roof.outline).
//
// Выбор крыши — state.selection = { type: 'roof', id }.
// Инструмент — state.tool = { kind: 'roof', hover: { levelId, roomId } | null, draw?: { a, b } }.

import {
  EDGE_HEIGHT, EDGE_TYPES, OVERHANG_MAX, PARAPET_HEIGHT, PARAPET_THICK, PARAPET_TYPES, ROOF_MATERIALS, ROOF_PRESETS,
  ROOF_SIDES, ROOF_THICK, SIDE_TITLES, applyRoofPreset, canHaveLinkedRoof, setLinkedRoofEnabled, baseEdge, overhangLabel, patchRoof, rectsOutline,
  mergeTouchingRoofs, roofBaseRects, roofFromRooms, roofOverRoom, roofSnapLines, roofStats, roomsBaseRects, sideAxis, snapOverhang,
} from '../core/roofs.js';
import { massBox } from '../core/masses.js';
import { isShaft } from '../core/catalog.js';
import { sortedLevels } from '../core/model.js';
import { escapeHtml, toast } from './dom.js';
import { gridStep } from './snap.js';
import { state } from './state.js';
import { mutate } from './store.js';
import { renderProps } from './props.js';
import { cancelTool, selectObject, setTool } from './tools.js';
import { is3dOpen, set3dRoofVisibility } from './view3d.js';
import { bindEnvelopeSettings, linkedRoofSettingsHtml } from './envelope-settings.js';
import { isRoofPlan, openRoofPlanView, roomRoofCoverage, roofById, roofs, selectedRoof, visibleRoofById } from './plan-roofs.js';

export const ROOF_DRAW_HINT = 'Ручная крыша: протяните прямоугольник, кликните по помещению подложки — форма по нему (дальше без связи), клик мимо помещений или Alt+клик — контур по точкам · Shift — без привязки · Esc — выйти';
const HINT_3D = 'Ручная крыша: клик по помещению — крыша по его форме · Shift+клик — добавить форму помещения к выбранной крыше · клик по крыше — выбрать · Esc — выйти';

export { roofById, roofs, selectedRoof, visibleRoofById };
export const isRoofTool = () => state.tool?.kind === 'roof';

export const setRoofs = (list) => {
  if (list.length) state.project.roofs = list; else delete state.project.roofs;
};

// ---------------------------------------------------------------- команды

export function updateRoof(id, fn) {
  const r = roofById(id);
  if (!r) return null;
  let next = null;
  mutate(() => {
    next = fn(r);
    if (next) setRoofs(roofs().map((x) => (x.id === id ? next : x)));
    else setRoofs(roofs().filter((x) => x.id !== id));
  });
  return next;
}

// ---------------------------------------------------------------- слияние

// Итог последнего слияния для подсказки (takeMergeNote — забрать и сбросить).
let mergeNote = '';
const noteOf = (m) => (m ? ` · соединена с касающимися (${m.merged.length})${m.filled ? ', двор внутри залит' : ''}` : '');
export function takeMergeNote() {
  const t = mergeNote;
  mergeNote = '';
  return t;
}

// Внутри правки (mutate или до pushHistory): крыша id поглощает касающиеся
// крыши своего этажа и высоты (core/roofs.js mergeTouchingRoofs). force —
// ручное «Соединить» (флаг autoMerge не важен). → итог слияния или null.
export function mergeRoofInPlace(id, { force = false } = {}) {
  const m = mergeTouchingRoofs(roofs(), id, { force });
  if (m) setRoofs(m.list);
  mergeNote = noteOf(m);
  return m;
}

// Новая крыша в проект (одна запись истории, вместе с автослиянием) и выбор.
export function addRoof(roof) {
  if (!roof) return null;
  let out = roof;
  mutate(() => {
    setRoofs([...roofs(), roof]);
    out = mergeRoofInPlace(roof.id)?.roof || roof;
  });
  if (is3dOpen()) set3dRoofVisibility(true);
  selectObject({ type: 'roof', id: out.id });
  return out;
}

// «Соединить с касающимися» (вручную, флаги autoMerge не важны).
export function mergeRoofNow(id) {
  if (!roofById(id)) return null;
  if (!mergeTouchingRoofs(roofs(), id, { force: true })) {
    toast('Касающихся крыш того же этажа и высоты нет', true);
    return null;
  }
  let m = null;
  mutate(() => { m = mergeRoofInPlace(id, { force: true }); });
  selectObject({ type: 'roof', id });
  toast(`«${m.roof.name}»${takeMergeNote()} · Ctrl+Z — вернуть`);
  return m;
}

export function deleteRoof(id) {
  const roof = visibleRoofById(id);
  if (!roof) return;
  const removed = mutate(() => {
    if (roof.roofSource === 'linked') setLinkedRoofEnabled(state.project, roof.levelId, roof.roomIds, false);
    else setRoofs(roofs().filter((r) => r.id !== id));
  });
  if (!removed) return;
  if (state.selection?.type === 'roof' && state.selection.id === id) selectObject(null);
  toast(`«${roof.name}» удалена · Ctrl+Z — вернуть`);
}

// Клик по помещению (инструмент в 3D, «Свойства» помещения): помещение под
// крышей — выбрать её; Shift (add) и выбранная крыша этого этажа — добавить
// форму помещения к её контуру; иначе новая крыша со стартовой формой по
// помещению. Связи с помещением нет. → крыша.
export function roofClickRoom(levelId, roomId, { add = false } = {}) {
  const room = (state.project.levels || []).find((l) => l.id === levelId)?.rooms?.find((r) => r.id === roomId);
  if (!room) return null;
  if (isShaft(room)) { toast('Шахту крышей не накрыть', true); return null; }
  const sel = add ? selectedRoof() : null;
  const own = roofOverRoom(state.project, levelId, room);
  if (own && (!sel || own.id === sel.id)) {
    if (sel) { toast(`«${room.name}» уже под «${own.name}»`); return own; }
    selectObject({ type: 'roof', id: own.id });
    return own;
  }
  if (sel && sel.levelId === levelId) {
    const outline = rectsOutline([...roofBaseRects(state.project, sel), ...roomsBaseRects(state.project, levelId, [roomId])]);
    const next = updateRoof(sel.id, (r) => ({ ...r, outline }));
    selectObject({ type: 'roof', id: sel.id });
    toast(`Форма «${room.name}» добавлена к «${sel.name}»`);
    return next;
  }
  const roof = addRoof(roofFromRooms(state.project, levelId, [roomId], {}, roofs()));
  const note = takeMergeNote();
  if (roof) toast(note ? `${roof.name}: форма «${room.name}»${note}` : `${roof.name} по форме «${room.name}» · дальше крыша сама по себе: «План крыши» — двигать и менять форму`);
  return roof;
}

function linkedRoomMode(room) {
  return canHaveLinkedRoof(room) && state.project?.envelope?.roofMode !== 'manual';
}

function focusRoof(roof) {
  if (!roof) return null;
  if (!is3dOpen()) showRoofPlan(roof.id);
  else {
    set3dRoofVisibility(true);
    selectObject({ type: 'roof', id: roof.id });
  }
  return roof;
}

export function coverSelectedRoom() {
  const sel = state.selection;
  if (sel?.type !== 'room') return null;
  const room = state.project.rooms.find((r) => r.id === sel.id);
  if (!room) return null;
  const levelId = state.project.activeLevel;
  const linkedMode = linkedRoomMode(room);
  if (linkedMode && room.linkedRoof === false) {
    if (!mutate(() => setLinkedRoofEnabled(state.project, levelId, [room.id], true))) return null;
  }
  const { linked, manual } = roomRoofCoverage(room);
  if (linked || manual) return focusRoof(linked || manual);
  if (linkedMode || room.parentId) { toast('Крыша появится там, где помещение открыто сверху'); return null; }
  return focusRoof(roofClickRoom(levelId, sel.id));
}

// Открыть «План крыши» и выбрать крышу (id) — если есть.
export function showRoofPlan(id = null) {
  openRoofPlanView();
  if (id && visibleRoofById(id)) selectObject({ type: 'roof', id });
  renderProps();
}

// Этаж для новой крыши на «Плане крыши»: верхний.
export function topLevelId() {
  const list = sortedLevels(state.project);
  return list.length ? list[list.length - 1].id : state.project.activeLevel;
}

// ---------------------------------------------------------------- инструмент

// В 3D — инструмент сцены (ui/roof3d.js); на плане этажа — открыть «План
// крыши» и включить там черчение крыши.
export function startRoofTool() {
  if (is3dOpen()) {
    setTool({ kind: 'roof', hover: null }, HINT_3D);
    document.dispatchEvent(new CustomEvent('kepler:roof-tool'));
    return;
  }
  if (!isRoofPlan()) openRoofPlanView();
  setTool({ kind: 'roof', hover: null }, ROOF_DRAW_HINT);
  document.dispatchEvent(new CustomEvent('kepler:roof-tool'));
}

export function toggleRoofTool() {
  if (!isRoofTool()) { startRoofTool(); return; }
  cancelTool();
  document.dispatchEvent(new CustomEvent('kepler:roof-tool'));
}

// Привязка выноса (ручки выноса на «Плане крыши» и в 3D).
export function roofSnapper(roof, event, scale) {
  if (event?.shiftKey) return null;
  const lines = roofSnapLines(state.project, roof.id, massBox);
  const tol = 12 / scale;
  const step = gridStep();
  return (side, raw) => snapOverhang(raw, {
    side, base: baseEdge(state.project, roof, side), lines: sideAxis(side) === 'x' ? lines.xs : lines.ys, tol, step,
  });
}

// ---------------------------------------------------------------- «Свойства»

// Эскизы разреза края плиты и парапета (SVG 64×40): плита — серая полоса.
const SLAB = '<rect x="4" y="18" width="44" height="7" fill="currentColor" opacity=".35"/>';
const EDGE_SVG = {
  plain: `${SLAB}<path d="M48 18v7" stroke="currentColor" stroke-width="1.6"/>`,
  fascia: `${SLAB}<rect x="48" y="15" width="4" height="15" fill="currentColor"/>`,
  cornice: `${SLAB}<path d="M48 18h5v4h-5" fill="currentColor"/><rect x="48" y="18" width="5" height="4" fill="currentColor"/>`,
  drip: `${SLAB}<path d="M44 25h4v4z" fill="currentColor"/>`,
};
const PARAPET_SVG = {
  none: SLAB,
  wall: `${SLAB}<rect x="42" y="6" width="6" height="12" fill="currentColor"/>`,
  glass: `${SLAB}<rect x="44" y="5" width="2" height="13" fill="#5b94dd" opacity=".7"/><rect x="42" y="16" width="6" height="2" fill="currentColor"/>`,
  rail: `${SLAB}<path d="M44 18V6M38 6h10M38 10h10M38 14h10" stroke="currentColor" stroke-width="1.4" fill="none"/>`,
  stepped: `${SLAB}<rect x="42" y="6" width="6" height="12" fill="currentColor"/><rect x="36" y="12" width="6" height="6" fill="currentColor" opacity=".7"/>`,
};
const svg = (body) => `<svg viewBox="0 0 56 34" width="56" height="34" aria-hidden="true">${body}</svg>`;

const cards = (name, list, cur, art) => `<div class="roof-cards" role="radiogroup" data-roof-cards="${name}">
  ${list.map((t) => `<button type="button" role="radio" class="roof-card${t.id === cur ? ' active' : ''}" aria-checked="${t.id === cur}" data-roof-${name}="${t.id}" title="${escapeHtml(t.hint || t.title)}">${svg(art[t.id])}<span>${escapeHtml(t.title)}</span></button>`).join('')}
</div>`;

const numField = (id, label, value, { step = 50, min = 0, max = '' } = {}) => `
  <label class="prop-field"><span>${label}</span>
    <input id="${id}" type="number" step="${step}" min="${min}" ${max !== '' ? `max="${max}"` : ''} inputmode="numeric" value="${Math.round(value)}"></label>`;

function renderLinkedRoofProps(panel, roof) {
  const level = state.project.levels.find((l) => l.id === roof.levelId);
  const roomNames = level.rooms.filter((r) => roof.roomIds.includes(r.id)).map((r) => r.name);
  const label = roomNames.length === 1 ? escapeHtml(roomNames[0]) : `Помещений под крышей · ${roomNames.length}`;
  panel.innerHTML = `<h2>Связанная крыша</h2>
    <p class="subtitle">${escapeHtml(level.name)} · ${label}</p>
    <div class="prop-block" id="roofProps">
      <div class="prop-row"><span>Площадь в плане</span><strong>${(roof.planArea / 1e6).toFixed(1)} м²</strong></div>
      <p class="hint">Контур повторяет помещения. Там, где надстроен этаж, нижняя крыша обрезается.</p>
      ${is3dOpen() ? '<button type="button" id="roofHideLayer">Скрыть крыши в 3D</button>' : ''}
      <button type="button" id="roofDelete" class="danger">Удалить крышу</button>
    </div>
    <div class="prop-block"><h3>Для всех связанных крыш</h3>${linkedRoofSettingsHtml(state.project)}</div>`;
  bindEnvelopeSettings(panel, state.project);
  panel.querySelector('#roofHideLayer')?.addEventListener('click', () => set3dRoofVisibility(false));
  panel.querySelector('#roofDelete').addEventListener('click', () => deleteRoof(roof.id));
}

export function renderRoofProps(panel, roof) {
  if (roof.roofSource === 'linked') { renderLinkedRoofProps(panel, roof); return; }
  const st = roofStats(state.project, roof);
  const level = (state.project.levels || []).find((l) => l.id === roof.levelId);
  const levels = sortedLevels(state.project);
  const oh = roof.overhang;
  const same = ROOF_SIDES.every((s) => oh[s] === oh.n);
  const p = roof.parapet;
  const xs = roof.outline.map((q) => q.x); const ys = roof.outline.map((q) => q.y);
  const gw = Math.max(...xs) - Math.min(...xs); const gh = Math.max(...ys) - Math.min(...ys);
  panel.innerHTML = `
    <h2>Крыша</h2>
    <p class="subtitle">Плоская плита над «${escapeHtml(level?.name || '')}» · ${escapeHtml(overhangLabel(roof))} мм</p>
    <div class="prop-block" id="roofProps">
      ${isRoofPlan() ? '' : '<button type="button" id="roofOpenPlan">Открыть «План крыши» — двигать и менять форму</button>'}
      <label class="prop-field"><span>Название</span>
        <input id="roofName" type="text" maxlength="60" value="${escapeHtml(roof.name)}"></label>
      <label class="prop-field"><span>Над этажом</span>
        <select id="roofLevel">${levels.map((l) => `<option value="${escapeHtml(l.id)}"${l.id === roof.levelId ? ' selected' : ''}>${escapeHtml(l.name)}</option>`).join('')}</select></label>
      <div class="roof-presets">
        ${ROOF_PRESETS.map((x) => `<button type="button" data-roof-preset="${x.id}" title="${escapeHtml(x.hint)}">${escapeHtml(x.title)}</button>`).join('')}
      </div>
      <h3>Край плиты</h3>
      ${cards('edge', EDGE_TYPES, roof.edge.type, EDGE_SVG)}
      <h3>Парапет</h3>
      ${cards('parapet', PARAPET_TYPES, p.type, PARAPET_SVG)}
      <h3>Размеры</h3>
      <div class="prop-grid">
        ${numField('roofOhAll', 'Вынос от контура, мм', same ? oh.n : Math.max(...Object.values(oh)), { max: OVERHANG_MAX })}
        ${numField('roofThick', 'Толщина плиты', roof.thickness, { min: ROOF_THICK.min, max: ROOF_THICK.max })}
        ${ROOF_SIDES.map((s) => numField(`roofOh-${s}`, `Вынос: ${SIDE_TITLES[s]}`, oh[s], { max: OVERHANG_MAX })).join('')}
        ${roof.edge.type !== 'plain' ? numField('roofEdgeH', roof.edge.type === 'fascia' ? 'Высота фасции' : 'Высота края', roof.edge.height, { min: EDGE_HEIGHT.min, max: EDGE_HEIGHT.max }) : ''}
        ${numField('roofDz', 'Поднять, мм', roof.dz, { min: -10000 })}
        ${p.type !== 'none' ? `${numField('roofParH', 'Высота парапета', p.height, { min: PARAPET_HEIGHT.min, max: PARAPET_HEIGHT.max })}
        ${p.type === 'wall' || p.type === 'stepped' ? numField('roofParT', 'Толщина парапета', p.thickness, { step: 10, min: PARAPET_THICK.min, max: PARAPET_THICK.max }) : ''}
        ${numField('roofParInset', 'Отступ от края', p.inset)}` : ''}
      </div>
      ${p.type !== 'none' ? `<div class="roof-sides"><span>Стороны парапета</span>
        ${ROOF_SIDES.map((s) => `<label class="check-row"><input type="checkbox" data-roof-side="${s}" ${p.sides[s] ? 'checked' : ''}><span>${SIDE_TITLES[s]}</span></label>`).join('')}</div>` : ''}
      <h3>Материал</h3>
      <div class="roof-materials" role="radiogroup">
        ${ROOF_MATERIALS.map((m) => `<button type="button" role="radio" aria-checked="${m.id === roof.material}" class="roof-swatch${m.id === roof.material ? ' active' : ''}" data-roof-material="${m.id}" title="${m.title}"><i style="background:${m.color}"></i><span>${m.title}</span></button>`).join('')}
      </div>
      <label class="check-row"><input type="checkbox" id="roofAutoMerge" ${roof.autoMerge === false ? '' : 'checked'}><span>Автоматически соединять с соседними</span></label>
      <button type="button" id="roofMergeNow">Соединить с касающимися</button>
      <div class="prop-row"><span>Контур</span><strong id="roofOutlineInfo">${roof.outline.length} вершин · ${(gw / 1000).toFixed(2)} × ${(gh / 1000).toFixed(2)} м</strong></div>
      <div class="prop-row"><span>Площадь плиты</span><strong id="roofArea">${st.area.toFixed(1)} м²</strong></div>
      <div class="prop-row"><span>Отметка верха</span><strong>${(st.z1 / 1000).toFixed(3)}</strong></div>
      <button type="button" id="roofDelete" class="danger">Удалить крышу</button>
      <p class="hint">«План крыши»: тяните крышу — перенос; квадраты — вершины, кружки на рёбрах — рёбра (Г, П-формы); двойной клик по ребру — новая вершина, по вершине — удалить; синие точки — вынос. Shift — без привязки. В 3D — вынос и синяя стрелка высоты.</p>
    </div>`;
  const id = roof.id;
  const upd = (patch) => updateRoof(id, (r) => patchRoof(r, patch));
  panel.querySelector('#roofOpenPlan')?.addEventListener('click', () => showRoofPlan(id));
  panel.querySelector('#roofName').addEventListener('change', (e) => {
    const name = String(e.target.value).trim().slice(0, 60);
    if (!name) { e.target.value = roof.name; return; }
    upd({ name });
  });
  panel.querySelector('#roofLevel').addEventListener('change', (e) => upd({ levelId: e.target.value }));
  panel.querySelectorAll('[data-roof-preset]').forEach((b) => b.addEventListener('click', () => updateRoof(id, (r) => applyRoofPreset(r, b.dataset.roofPreset))));
  panel.querySelectorAll('[data-roof-edge]').forEach((b) => b.addEventListener('click', () => upd({ edge: { type: b.dataset.roofEdge } })));
  panel.querySelectorAll('[data-roof-parapet]').forEach((b) => b.addEventListener('click', () => upd({ parapet: { type: b.dataset.roofParapet } })));
  panel.querySelectorAll('[data-roof-material]').forEach((b) => b.addEventListener('click', () => upd({ material: b.dataset.roofMaterial })));
  panel.querySelectorAll('[data-roof-side]').forEach((c) => c.addEventListener('change', () => upd({ parapet: { sides: { [c.dataset.roofSide]: c.checked } } })));
  const bindNum = (sel, make) => panel.querySelector(sel)?.addEventListener('change', (e) => {
    const v = Number(String(e.target.value).replace(',', '.'));
    if (!Number.isFinite(v)) { renderProps(); return; }
    upd(make(v));
  });
  bindNum('#roofOhAll', (v) => ({ overhang: Object.fromEntries(ROOF_SIDES.map((s) => [s, v])) }));
  for (const s of ROOF_SIDES) bindNum(`#roofOh-${s}`, (v) => ({ overhang: { [s]: v } }));
  bindNum('#roofThick', (v) => ({ thickness: v }));
  bindNum('#roofEdgeH', (v) => ({ edge: { height: v } }));
  bindNum('#roofDz', (v) => ({ dz: v }));
  bindNum('#roofParH', (v) => ({ parapet: { height: v } }));
  bindNum('#roofParT', (v) => ({ parapet: { thickness: v } }));
  bindNum('#roofParInset', (v) => ({ parapet: { inset: v } }));
  panel.querySelector('#roofAutoMerge').addEventListener('change', (e) => {
    const on = e.target.checked;
    mutate(() => {
      setRoofs(roofs().map((r) => {
        if (r.id !== id) return r;
        const next = { ...r, autoMerge: false };
        if (on) delete next.autoMerge;
        return next;
      }));
      if (on) mergeRoofInPlace(id);
    });
    const note = takeMergeNote();
    if (note) toast(`«${roofById(id)?.name || ''}»${note} · Ctrl+Z — вернуть`);
    renderProps();
  });
  panel.querySelector('#roofMergeNow').addEventListener('click', () => { mergeRoofNow(id); renderProps(); });
  panel.querySelector('#roofDelete').addEventListener('click', () => deleteRoof(id));
}

// Блок «Крыша» в «Свойствах» помещения: крыша над ним (по геометрии) —
// выбрать на «Плане крыши», иначе — новая крыша по форме помещения.
export function roomRoofHtml(room) {
  const { linked, manual } = roomRoofCoverage(room);
  if (room.parentId) {
    return linked || manual ? '<div class="prop-actions"><button type="button" id="roomRoofBtn">Выбрать крышу над помещением</button></div>' : '';
  }
  if (!linkedRoomMode(room)) {
    const title = manual ? `Выбрать «${escapeHtml(manual.name)}»` : 'Накрыть крышей';
    return `<div class="prop-actions"><button type="button" id="roomRoofBtn">${title}</button></div>`;
  }
  const disabled = room.linkedRoof === false;
  const label = disabled ? 'Восстановить связанную крышу' : linked ? 'Выбрать связанную крышу'
    : manual ? `Выбрать «${escapeHtml(manual.name)}»` : '';
  return `<div class="prop-block"><h3>Крыша помещения</h3>
    ${label ? `<button type="button" id="roomRoofBtn">${label}</button>` : '<p class="hint">Помещение накрыто верхним этажом.</p>'}
    ${!disabled ? `<button type="button" id="roomRoofRemove">${linked ? 'Убрать над этим помещением' : 'Отключить автокрышу комнаты'}</button>` : ''}
    ${linked || disabled || !manual ? `<details><summary>Ручной контур</summary><button type="button" id="roomManualRoof">${manual ? 'Выбрать ручную крышу' : 'Создать крышу по форме комнаты'}</button></details>` : ''}
  </div>`;
}

export function bindRoomRoof(panel) {
  panel.querySelector('#roomRoofBtn')?.addEventListener('click', coverSelectedRoom);
  panel.querySelector('#roomRoofRemove')?.addEventListener('click', () => {
    const id = state.selection?.id;
    if (state.selection?.type === 'room') mutate(() => setLinkedRoofEnabled(state.project, state.project.activeLevel, [id], false));
  });
  panel.querySelector('#roomManualRoof')?.addEventListener('click', () => {
    if (state.selection?.type !== 'room') return;
    const room = state.project.rooms.find((r) => r.id === state.selection.id);
    if (room) focusRoof(roomRoofCoverage(room).manual || roofClickRoom(state.project.activeLevel, room.id));
  });
}
