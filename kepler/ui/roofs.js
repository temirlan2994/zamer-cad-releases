// Крыши-плиты (core/roofs.js) в редакторе: команды (накрыть помещение,
// добавить помещение, править, удалить), инструмент «Крыша» (K) на плане
// (в 3D — ui/roof3d.js), ручки выноса на плане и «Свойства» крыши с
// карточками типов края и парапета.
//
// Выбор крыши — state.selection = { type: 'roof', id }.
// Инструмент — state.tool = { kind: 'roof', hover: roomId | null, addTo?: roofId }.

import {
  EDGE_HEIGHT, EDGE_TYPES, OVERHANG_MAX, PARAPET_HEIGHT, PARAPET_THICK, PARAPET_TYPES, ROOF_MATERIALS, ROOF_PRESETS,
  ROOF_SIDES, ROOF_THICK, SIDE_TITLES, addRoomToRoof, applyRoofPreset, baseEdge, createRoof, dragOverhang,
  overhangLabel, patchRoof, removeRoomFromRoof, roofOfRoom, roofRects, roofSnapLines, roofStats, sideAxis, snapOverhang,
} from '../core/roofs.js';
import { massBox } from '../core/masses.js';
import { isShaft } from '../core/catalog.js';
import { escapeHtml, toast } from './dom.js';
import { hitRoom } from './hit.js';
import { gridStep } from './snap.js';
import { state } from './state.js';
import { afterChange, mutate, pushHistory, refreshDerived, restoreFrom, snapshot } from './store.js';
import { renderProps } from './props.js';
import { cancelTool, selectObject, setHint, setTool } from './tools.js';
import { requestDraw } from './view.js';
import { drawnRoofHandles, roofById, roofs, selectedRoof } from './plan-roofs.js';

export const ROOF_TIP = 'Крыша · клик по помещению — накрыть крышей; тянуть точки — вынос · K';
const HINT = 'Крыша: клик по помещению — накрыть · Shift+клик — добавить помещение к выбранной крыше · клик по накрытому — выбрать · Esc — выйти';
const HINT_ADD = 'Крыша: клик по помещению — добавить к крыше · Esc — готово';

export { roofById, roofs, selectedRoof };
export const isRoofTool = () => state.tool?.kind === 'roof';

const setRoofs = (list) => {
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

export function deleteRoof(id) {
  const r = roofById(id);
  if (!r) return;
  mutate(() => setRoofs(roofs().filter((x) => x.id !== id)));
  if (state.selection?.type === 'roof' && state.selection.id === id) selectObject(null);
  toast(`«${r.name}» удалена · Ctrl+Z — вернуть`);
}

// Клик по помещению (инструмент, плашка, «Свойства»): накрытое — выбрать его
// крышу; Shift (add) и выбранная крыша этого этажа — добавить помещение к
// ней; иначе новая крыша над помещением. → крыша.
export function roofClickRoom(levelId, roomId, { add = false, addTo = null } = {}) {
  const room = (state.project.levels || []).find((l) => l.id === levelId)?.rooms?.find((r) => r.id === roomId);
  if (!room) return null;
  if (isShaft(room)) { toast('Шахту крышей не накрыть', true); return null; }
  const own = roofOfRoom(state.project, levelId, roomId);
  if (own) {
    if (addTo && own.id === addTo) { toast(`«${room.name}» уже под «${own.name}»`); return own; }
    selectObject({ type: 'roof', id: own.id });
    return own;
  }
  const target = roofById(addTo) || (add ? selectedRoof() : null);
  if (target && target.levelId === levelId) {
    const next = updateRoof(target.id, (r) => addRoomToRoof(r, roomId));
    selectObject({ type: 'roof', id: target.id });
    toast(`«${room.name}» добавлена к «${target.name}»`);
    return next;
  }
  const roof = createRoof({ levelId, roomIds: [roomId] }, roofs());
  mutate(() => setRoofs([...roofs(), roof]));
  selectObject({ type: 'roof', id: roof.id });
  toast(`${roof.name} над «${room.name}» · тяните точки — вынос, «Свойства» — тип края и парапета`);
  return roof;
}

// «Накрыть крышей» для выбранного помещения активного этажа.
export function coverSelectedRoom() {
  const sel = state.selection;
  if (sel?.type !== 'room') return null;
  return roofClickRoom(state.project.activeLevel, sel.id);
}

// ---------------------------------------------------------------- инструмент

export function startRoofTool({ addTo = null } = {}) {
  if (state.modeName !== 'plan') { toast('Крыши создаются в режиме «План» и в 3D', true); return; }
  setTool({ kind: 'roof', hover: null, addTo }, addTo ? HINT_ADD : HINT);
  document.dispatchEvent(new CustomEvent('kepler:roof-tool'));
}

export function toggleRoofTool() {
  if (!isRoofTool()) { startRoofTool(); return; }
  cancelTool();
  document.dispatchEvent(new CustomEvent('kepler:roof-tool'));
}

export function roofPlanHover(plan) {
  const t = state.tool;
  if (t?.kind !== 'roof') return;
  const room = hitRoom(plan);
  const next = room && !isShaft(room) ? room.id : null;
  if (next !== t.hover) { t.hover = next; requestDraw(); }
}

export function roofPlanClick(plan, mods = {}) {
  const t = state.tool;
  if (t?.kind !== 'roof') return;
  const room = hitRoom(plan);
  if (!room) {
    const roof = roofZoneHit(plan);
    if (roof) selectObject({ type: 'roof', id: roof.id });
    return;
  }
  roofClickRoom(state.project.activeLevel, room.id, { add: Boolean(mods.shiftKey), addTo: t.addTo });
  if (state.tool?.kind === 'roof') { state.tool.hover = room.id; setHint(t.addTo ? HINT_ADD : HINT); }
  renderProps();
  requestDraw();
}

// ---------------------------------------------------------------- план: зона и ручки

// Крыша активного этажа, в зоне выноса которой (вне помещений) лежит точка.
export function roofZoneHit(plan) {
  const lv = state.project?.activeLevel;
  const tol = 6 / (state.view?.scale || 1);
  for (const r of [...roofs()].reverse()) {
    if (r.levelId !== lv) continue;
    if (roofRects(state.project, r).some((b) => plan.x >= b.x0 - tol && plan.x <= b.x1 + tol && plan.y >= b.y0 - tol && plan.y <= b.y1 + tol)) return r;
  }
  return null;
}

export function roofPointerDown(event, screen, plan) {
  const roof = selectedRoof();
  const handleCache = drawnRoofHandles();
  if (!roof || !handleCache.length) return null;
  const r = event?.pointerType === 'touch' || event?.pointerType === 'pen' ? 20 : 10;
  let best = null; let bd = r;
  for (const h of handleCache) {
    const d = Math.hypot(h.s.x - screen.x, h.s.y - screen.y);
    if (d <= bd) { bd = d; best = h; }
  }
  if (!best) return null;
  return {
    kind: 'roof-handle', id: roof.id, handle: best.id, sides: best.sides, start: structuredClone(roof),
    plan0: { x: plan.x, y: plan.y }, before: snapshot(), moved: false,
  };
}

export function roofSnapper(roof, event, scale) {
  if (event?.shiftKey) return null;
  const lines = roofSnapLines(state.project, roof.id, massBox);
  const tol = 12 / scale;
  const step = gridStep();
  return (side, raw) => snapOverhang(raw, {
    side, base: baseEdge(state.project, roof, side), lines: sideAxis(side) === 'x' ? lines.xs : lines.ys, tol, step,
  });
}

export function roofDragMove(drag, plan, event) {
  const start = drag.start;
  const snap = roofSnapper(start, event, state.view.scale) || ((s, raw) => ({ value: Math.round(raw), label: null }));
  const { roof, labels } = dragOverhang(start, drag.sides, plan.x - drag.plan0.x, plan.y - drag.plan0.y, snap);
  setRoofs(roofs().map((x) => (x.id === drag.id ? roof : x)));
  drag.moved = JSON.stringify(roof.overhang) !== JSON.stringify(start.overhang);
  const val = drag.sides.map((s) => roof.overhang[s]);
  state.roofLabel = { x: plan.x, y: plan.y, text: `вынос ${val.join(' / ')} мм${labels.length ? ` · ${labels[0]}` : ''}` };
  requestDraw();
}

export function roofDragEnd(drag) {
  state.roofLabel = null;
  if (!drag.moved) { requestDraw(); return; }
  refreshDerived();
  pushHistory(drag.before);
  afterChange();
}

export function roofDragCancel(drag) {
  state.roofLabel = null;
  if (drag.moved) restoreFrom(drag.before);
  selectObject({ type: 'roof', id: drag.id });
  requestDraw();
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

export function renderRoofProps(panel, roof) {
  const st = roofStats(state.project, roof);
  const level = (state.project.levels || []).find((l) => l.id === roof.levelId);
  const rooms = (level?.rooms || []).filter((r) => !isShaft(r) && !r.parentId);
  const oh = roof.overhang;
  const same = ROOF_SIDES.every((s) => oh[s] === oh.n);
  const p = roof.parapet;
  panel.innerHTML = `
    <h2>Крыша</h2>
    <p class="subtitle">Плоская плита над «${escapeHtml(level?.name || '')}» · ${escapeHtml(overhangLabel(roof))} мм</p>
    <div class="prop-block" id="roofProps">
      <label class="prop-field"><span>Название</span>
        <input id="roofName" type="text" maxlength="60" value="${escapeHtml(roof.name)}"></label>
      <div class="roof-presets">
        ${ROOF_PRESETS.map((x) => `<button type="button" data-roof-preset="${x.id}" title="${escapeHtml(x.hint)}">${escapeHtml(x.title)}</button>`).join('')}
      </div>
      <h3>Край плиты</h3>
      ${cards('edge', EDGE_TYPES, roof.edge.type, EDGE_SVG)}
      <h3>Парапет</h3>
      ${cards('parapet', PARAPET_TYPES, p.type, PARAPET_SVG)}
      <h3>Размеры</h3>
      <div class="prop-grid">
        ${numField('roofOhAll', 'Вынос, мм', same ? oh.n : Math.max(...Object.values(oh)), { max: OVERHANG_MAX })}
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
      <h3>Помещения</h3>
      <div class="roof-rooms">
        ${rooms.map((r) => `<label class="check-row"><input type="checkbox" data-roof-room="${r.id}" ${roof.roomIds.includes(r.id) ? 'checked' : ''}><span>${escapeHtml(r.name)}</span></label>`).join('')}
      </div>
      <button type="button" id="roofAddRoom">+ Добавить помещение (клик на плане)</button>
      <div class="prop-row"><span>Площадь плиты</span><strong id="roofArea">${st.area.toFixed(1)} м²</strong></div>
      <div class="prop-row"><span>Отметка верха</span><strong>${(st.z1 / 1000).toFixed(3)}</strong></div>
      <button type="button" id="roofDelete" class="danger">Удалить крышу</button>
      <p class="hint">Точки по сторонам и углам — вынос (на плане и в 3D; Shift — без привязки), в 3D синяя стрелка — высота. Двойной клик по точке в 3D — число. Shift+клик инструментом «Крыша» (K) — добавить помещение.</p>
    </div>`;
  const id = roof.id;
  const upd = (patch) => updateRoof(id, (r) => patchRoof(r, patch));
  panel.querySelector('#roofName').addEventListener('change', (e) => {
    const name = String(e.target.value).trim().slice(0, 60);
    if (!name) { e.target.value = roof.name; return; }
    upd({ name });
  });
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
  panel.querySelectorAll('[data-roof-room]').forEach((c) => c.addEventListener('change', () => {
    const rid = c.dataset.roofRoom;
    if (c.checked) {
      const other = roofOfRoom(state.project, roof.levelId, rid);
      if (other && other.id !== id) updateRoof(other.id, (r) => removeRoomFromRoof(r, rid));
      updateRoof(id, (r) => addRoomToRoof(r, rid));
    } else {
      const next = updateRoof(id, (r) => removeRoomFromRoof(r, rid));
      if (!next) { selectObject(null); toast('Последнее помещение снято — крыша удалена · Ctrl+Z — вернуть'); }
    }
  }));
  panel.querySelector('#roofAddRoom').addEventListener('click', () => startRoofTool({ addTo: id }));
  panel.querySelector('#roofDelete').addEventListener('click', () => deleteRoof(id));
}

// Блок «Крыша» в «Свойствах» помещения.
export function roomRoofHtml(room) {
  const own = roofOfRoom(state.project, state.project.activeLevel, room.id);
  return `<div class="prop-actions"><button type="button" id="roomRoofBtn" data-room="${room.id}">${own ? `Крыша: «${escapeHtml(own.name)}» — выбрать` : 'Накрыть крышей'}</button></div>`;
}

export function bindRoomRoof(panel) {
  panel.querySelector('#roomRoofBtn')?.addEventListener('click', (e) => {
    roofClickRoom(state.project.activeLevel, e.currentTarget.dataset.room);
  });
}
