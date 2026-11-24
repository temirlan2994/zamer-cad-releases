// «Разобрать на стены» (v7): блок превращается в обычные ручные стены той же
// геометрии + «семя» помещения с его именем/типом и тем же id. Помещения,
// площади и тела стен после разбора те же (тест tests/v7-derive.test.mjs).

import { buffer, difference, interiorPoint, opening, transformPoint } from '../geom/poly.js';
import { EAT_SLIVER } from './carve.js';
import { derive } from './derive.js';
import { activeLevel7, blockById, blockEdges, blockHasWalls, createWall, makeId, pairGap } from './model.js';

const clone = (x) => JSON.parse(JSON.stringify(x));

// Polygon в осях дома → shape блока (в его локальных осях).
function setBlockGeom(block, poly) {
  const inv = (p) => transformPoint({ x: p.x - block.x, y: p.y - block.y }, { rotation: -(Number(block.rotation) || 0) });
  const [outer, ...holes] = poly.map((ring) => ring.map(inv));
  block.shape = { kind: 'poly', pts: outer };
  if (holes.length) block.shape.holes = holes;
}

function edgePoint(block, host) {
  const e = blockEdges(block)[host.edge];
  if (!e) return null;
  const len = Math.hypot(e.b.x - e.a.x, e.b.y - e.a.y) || 1;
  return { x: e.a.x + ((e.b.x - e.a.x) / len) * host.offset, y: e.a.y + ((e.b.y - e.a.y) / len) * host.offset };
}

// Проёмы блока после смены формы — на то же место (ребро ищется заново).
function rehostOpenings(level, old, block) {
  for (const o of level.openings) {
    if (o.host?.blockId !== block.id) continue;
    const P = edgePoint(old, o.host);
    if (!P) continue;
    for (const e of blockEdges(block)) {
      const len = Math.hypot(e.b.x - e.a.x, e.b.y - e.a.y);
      if (len < 1) continue;
      const s = ((P.x - e.a.x) * (e.b.x - e.a.x) + (P.y - e.a.y) * (e.b.y - e.a.y)) / len;
      const d = Math.abs(((P.x - e.a.x) * (e.b.y - e.a.y) - (P.y - e.a.y) * (e.b.x - e.a.x)) / len);
      if (d <= 1 && s >= -0.5 && s <= len + 0.5) { o.host = { ...o.host, edge: e.index, offset: Math.round(s * 2) / 2 }; break; }
    }
  }
}

// Блоки, которые разбираемый блок ел (вложенный — родителя, верхний —
// нижних), получают его вырез в номинальную форму: иначе после разбора
// они снова стали бы целыми и залезли под новые стены. Это единственное
// место, где номинальная форма меняется не руками пользователя, — и это
// явная операция «разобрать», а не побочный эффект жеста.
function bakeCuts(level, settings, res, X) {
  for (const L of level.blocks) {
    if (L.id === X.id) continue;
    const c = res.carved[L.id];
    if (!c?.eaten || !c.by.includes(X.id)) continue;
    const gap = pairGap(level, settings, L, X);
    let geom = opening(difference(c.nominal, buffer(res.carved[X.id].nominal, gap)), EAT_SLIVER / 2 - 0.5);
    if (geom.length !== 1) geom = c.shape;
    if (geom.length !== 1) continue;
    const old = clone(L);
    setBlockGeom(L, geom[0]);
    rehostOpenings(level, old, L);
  }
}

export function explodeBlock(project, blockId, { levelId } = {}) {
  const level = activeLevel7(project, levelId);
  const block = blockById(level, blockId);
  if (!block) return { ok: false, reason: 'Блок не найден' };
  if (!blockHasWalls(block)) return { ok: false, reason: 'У открытой площадки нет стен для разбора' };
  const res = derive(project, { levelId: level.id, cache: false });
  const mine = res.walls.filter((w) => w.source === 'block' && (w.blockId === blockId || w.pair?.includes(blockId)));
  const idMap = new Map();
  for (const w of mine) {
    const wall = createWall(w.a, w.b, {
      thickness: w.thickness, justify: w.justify, wallType: w.kind === 'exterior' ? 'exterior' : 'partition', hidden: w.hidden,
    });
    wall.id = makeId('wall');
    idMap.set(w.id, wall.id);
    level.walls.push(wall);
  }
  // Проёмы на рёбрах блока → на новых стенах (та же точка).
  const resolved = new Map(res.openings.map((o) => [o.id, o]));
  level.openings = level.openings.flatMap((o) => {
    if (o.host?.blockId !== blockId) return [o];
    const r = resolved.get(o.id);
    const wallId = r && idMap.get(r.wallId);
    if (wallId) return [{ ...o, host: { wallId, t: r.t } }];
    // Проём на стене соседа (ручной или общей не этого блока) — остаётся на ней.
    const other = r && res.walls.find((w) => w.id === r.wallId && w.source === 'wall');
    return other ? [{ ...o, host: { wallId: other.id, t: r.t } }] : [];
  });
  bakeCuts(level, project.settings, res, block);
  const p = interiorPoint(res.carved[blockId].shape) || { x: block.x, y: block.y };
  level.seeds = [...(level.seeds || []), { id: block.id, x: p.x, y: p.y, name: block.name, type: block.type }];
  for (const b of level.blocks) if (b.parentId === blockId) b.parentId = null;
  for (const it of level.items) if (it.blockId === blockId) it.blockId = null;
  for (const k of Object.keys(level.pairs || {})) if (k.split('|').includes(blockId)) delete level.pairs[k];
  level.blocks = level.blocks.filter((b) => b.id !== blockId);
  return { ok: true, walls: [...idMap.values()] };
}
