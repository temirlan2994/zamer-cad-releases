// Сравнение движков стен v1 (полосы + заплатки) и v2 (стена = область) —
// критерий этапа A (docs/walls-v2-architecture.md, 4.4).
//
//   node scripts/compare-walls.mjs [файл.kepler.json ...]
//
// Без аргументов — фикстуры tests/wall-fixtures.mjs, этажи шаблонов и
// tests/fixtures/user-house-2026-11.json. Для каждого этажа: площадь W v1/v2,
// симметрическая разность (растр 10 мм) с разбивкой по зонам, записи
// own/shared (key, from, to, thickness, wallType), сдвинутые проёмы (> 1 мм),
// инварианты a–f для v2, время v2.
//
// Зоны разницы: «c» — клетки v1 внутри чистого контура комнаты (дефект c:
// удлинённый угол заходит в соседа); «e» — клетки, которые v1 покрывает
// заплатками (joint/chamfer) или удлинёнными концами полос (наложения, дефект e);
// «прочее» — всё остальное. Критерий: «прочее» = 0, сдвигов проёмов 0.

import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { deriveWallsV1, deriveWallsV2, openingRect } from '../core/walls.js';
import { roomRects } from '../core/room-shape.js';
import { buildTemplate, TEMPLATES } from '../core/templates.js';
import { deserializeProject, levelProject } from '../core/model.js';

const G = 10;

function bbox(project) {
  let x0 = Infinity; let y0 = Infinity; let x1 = -Infinity; let y1 = -Infinity;
  for (const r of project.rooms) {
    x0 = Math.min(x0, r.x); y0 = Math.min(y0, r.y);
    x1 = Math.max(x1, r.x + r.w); y1 = Math.max(y1, r.y + r.h);
  }
  const pad = 1500;
  x0 = Math.floor((x0 - pad) / G) * G; y0 = Math.floor((y0 - pad) / G) * G;
  return { x0, y0, nx: Math.ceil((x1 + pad - x0) / G), ny: Math.ceil((y1 + pad - y0) / G) };
}

function fillRect(grid, arr, r) {
  const i0 = Math.max(0, Math.ceil((r.x - grid.x0) / G - 0.5));
  const i1 = Math.min(grid.nx - 1, Math.ceil((r.x + r.w - grid.x0) / G - 0.5) - 1);
  const j0 = Math.max(0, Math.ceil((r.y - grid.y0) / G - 0.5));
  const j1 = Math.min(grid.ny - 1, Math.ceil((r.y + r.h - grid.y0) / G - 0.5) - 1);
  for (let j = j0; j <= j1; j += 1) for (let i = i0; i <= i1; i += 1) arr[j * grid.nx + i] = 1;
}

function pieceRects(w) {
  if (w.rects) return w.rects;
  if (w.poly) {
    const xs = w.poly.map((p) => p.x); const ys = w.poly.map((p) => p.y);
    const x = Math.min(...xs); const y = Math.min(...ys);
    return [{ x, y, w: Math.max(...xs) - x, h: Math.max(...ys) - y }];
  }
  return w.band ? [w.band] : [];
}

const recKey = (w) => `${w.key}|${Math.round(w.from)}|${Math.round(w.to)}|${Math.round(w.thickness)}|${w.wallType}`;

export function compareWalls(project) {
  const v1 = deriveWallsV1(project);
  const t0 = performance.now();
  const v2 = deriveWallsV2(project);
  const ms = performance.now() - t0;

  const grid = bbox(project);
  const N = grid.nx * grid.ny;
  const a = new Uint8Array(N); const b = new Uint8Array(N);
  const patch = new Uint8Array(N); const inRoom = new Uint8Array(N);
  for (const w of v1) {
    if (w.hidden) continue;
    for (const r of pieceRects(w)) fillRect(grid, a, r);
    if (w.kind === 'joint' || w.kind === 'chamfer') for (const r of pieceRects(w)) fillRect(grid, patch, r);
    else if (w.band) {
      // Удлинение угла: часть полосы за пределами from..to.
      const r = w.band;
      if (w.orient === 'h') {
        if (w.from - r.x > 1) fillRect(grid, patch, { x: r.x, y: r.y, w: w.from - r.x, h: r.h });
        if (r.x + r.w - w.to > 1) fillRect(grid, patch, { x: w.to, y: r.y, w: r.x + r.w - w.to, h: r.h });
      } else {
        if (w.from - r.y > 1) fillRect(grid, patch, { x: r.x, y: r.y, w: r.w, h: w.from - r.y });
        if (r.y + r.h - w.to > 1) fillRect(grid, patch, { x: r.x, y: w.to, w: r.w, h: r.y + r.h - w.to });
      }
    }
  }
  for (const w of v2) if (!w.hidden) for (const r of w.rects) fillRect(grid, b, r);
  for (const room of project.rooms) for (const q of roomRects(room)) fillRect(grid, inRoom, q);

  let areaV1 = 0; let areaV2 = 0; let diffC = 0; let diffE = 0; let diffOther = 0;
  const otherSample = [];
  for (let k = 0; k < N; k += 1) {
    areaV1 += a[k]; areaV2 += b[k];
    if (a[k] === b[k]) continue;
    if (a[k] && inRoom[k]) diffC += 1;
    else if (patch[k]) diffE += 1;
    else {
      diffOther += 1;
      if (otherSample.length < 3) {
        otherSample.push(`${a[k] ? 'v1' : 'v2'} (${grid.x0 + (k % grid.nx) * G + G / 2}, ${grid.y0 + Math.floor(k / grid.nx) * G + G / 2})`);
      }
    }
  }
  const m2 = (cells) => (cells * G * G) / 1e6;

  const set1 = new Set(v1.filter((w) => w.kind === 'own' || w.kind === 'shared').map(recKey));
  const set2 = new Set(v2.map(recKey));
  const onlyV1 = [...set1].filter((k) => !set2.has(k));
  const onlyV2 = [...set2].filter((k) => !set1.has(k));

  const shifted = [];
  for (const o of project.openings || []) {
    const p1 = openingRect(project, o, v1);
    const p2 = openingRect(project, o, v2);
    if (!p1 && !p2) continue;
    if (!p1 || !p2) { shifted.push(`${o.id}: ${p1 ? 'v2 нет' : 'v1 нет'}`); continue; }
    const d = Math.max(Math.abs(p1.rect.x - p2.rect.x), Math.abs(p1.rect.y - p2.rect.y),
      Math.abs(p1.rect.w - p2.rect.w), Math.abs(p1.rect.h - p2.rect.h));
    if (d > 1) shifted.push(`${o.id}: ${d.toFixed(1)} мм`);
  }

  return {
    areaV1: m2(areaV1), areaV2: m2(areaV2),
    diffC: m2(diffC), diffE: m2(diffE), diffOther: m2(diffOther), otherSample,
    records: { v1: set1.size, v2: set2.size, onlyV1, onlyV2 },
    openings: (project.openings || []).length, shifted, ms,
  };
}

export async function compareCases(files = []) {
  const cases = [];
  if (files.length) {
    for (const f of files) {
      const p = deserializeProject(readFileSync(f, 'utf8'));
      for (const lv of p.levels) cases.push([`${f}/${lv.name}`, levelProject(p, lv.id)]);
    }
    return cases;
  }
  const { JOG_FIXTURES, WALL_FIXTURES } = await import('../tests/wall-fixtures.mjs');
  // Сдвиги помещений < 50 мм v2 выравнивает (JOG_TOL), v1 — нет: сравнивать нечего.
  for (const [name, build] of Object.entries(WALL_FIXTURES)) if (!(name in JOG_FIXTURES)) cases.push([name, build()]);
  for (const t of TEMPLATES) {
    const p = buildTemplate(t.id);
    for (const lv of p.levels) cases.push([`шаблон ${t.id}/${lv.name}`, levelProject(p, lv.id)]);
  }
  const user = new URL('../tests/fixtures/user-house-2026-11.json', import.meta.url);
  const p = deserializeProject(readFileSync(user, 'utf8'));
  for (const lv of p.levels) cases.push([`user-house-2026-11/${lv.name}`, levelProject(p, lv.id)]);
  return cases;
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  const { checkWallInvariants } = await import('../tests/wall-invariants-lib.mjs');
  let bad = 0;
  for (const [name, project] of await compareCases(process.argv.slice(2))) {
    const r = compareWalls(project);
    const inv = checkWallInvariants(project, deriveWallsV2(project));
    const failed = Object.entries(inv).filter(([, x]) => !x.ok).map(([k]) => k);
    const ok = r.diffOther < 0.0001 && !r.shifted.length && !failed.length;
    if (!ok) bad += 1;
    console.log(`${ok ? 'OK ' : 'ПЛОХО'} ${name}: W ${r.areaV1.toFixed(3)} → ${r.areaV2.toFixed(3)} м²; ` +
      `разница c ${r.diffC.toFixed(3)}, e ${r.diffE.toFixed(3)}, прочее ${r.diffOther.toFixed(4)} м²; ` +
      `записи ${r.records.v1}/${r.records.v2} (только v1 ${r.records.onlyV1.length}, только v2 ${r.records.onlyV2.length}); ` +
      `проёмы ${r.openings}, сдвиг ${r.shifted.length}; инварианты ${failed.length ? failed.join(',') : 'a–f'}; ${r.ms.toFixed(1)} мс`);
    for (const s of r.otherSample) console.log(`     прочее: ${s}`);
    for (const s of r.shifted) console.log(`     проём: ${s}`);
    for (const s of r.records.onlyV1.slice(0, 3)) console.log(`     только v1: ${s}`);
    for (const s of r.records.onlyV2.slice(0, 3)) console.log(`     только v2: ${s}`);
  }
  process.exitCode = bad ? 1 : 0;
}
