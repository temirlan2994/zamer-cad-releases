// Замечания проекта одним списком (кнопка «⚠» на холсте, ui/issues.js):
// связность и двери, нормы СП 55 и инсоляция, проходы у мебели, перекрытия,
// стены и нестандартные зазоры — по всем этажам. Без DOM: из проекта (и уже
// посчитанных normsReport / стен / зазоров активного этажа) → группы записей
// с целью перехода (что выбрать, какой прямоугольник показать на плане).
//
// Запись: { id, group, severity: 'warn' | 'ok', title, text, mark?, levelId,
//   levelName, target: selection | null, focus: {x,y,w,h} | null (оси дома),
//   actions: [{ kind: 'trim' | 'split' | 'dock-gap', label, ... }] }.
// severity 'ok' — справочная строка (✓ связность, инсоляция по комнатам),
// в число замечаний не входит.

import { itemBounds } from './clearance.js';
import { findNearMissGaps } from './gaps.js';
import { formatDuration } from './insolation.js';
import { isUpperLevel, levelProject, sortedLevels } from './model.js';
import { normsReport } from './norms.js';
import { analyzeConnectivity, suggestAccess } from './rooms.js';
import { deriveWalls } from './walls.js';

export const ISSUE_GROUPS = [
  { id: 'access', title: 'Связность и двери' },
  { id: 'norms', title: 'Нормы и площади' },
  { id: 'light', title: 'Свет и окна' },
  { id: 'furniture', title: 'Проходы у мебели' },
  { id: 'overlap', title: 'Перекрытия' },
  { id: 'walls', title: 'Стены и др.' },
];

// Вид проверки normsReport → группа.
const KIND_GROUP = {
  area: 'norms', width: 'norms', height: 'norms',
  light: 'light',
  furniture: 'furniture',
  overlap: 'overlap',
  bound: 'walls', 'wall-divides': 'walls',
};

const fmtDay = (day) => String(day).split('-').reverse().join('.');
const fmtHours = (h) => String(h).replace('.', ',');

// Габарит нескольких прямоугольников (null — пусто).
export function unionRect(rects) {
  const list = rects.filter((r) => r && Number.isFinite(r.x) && Number.isFinite(r.w));
  if (!list.length) return null;
  const x0 = Math.min(...list.map((r) => r.x));
  const y0 = Math.min(...list.map((r) => r.y));
  const x1 = Math.max(...list.map((r) => r.x + r.w));
  const y1 = Math.max(...list.map((r) => r.y + r.h));
  return { x: x0, y: y0, w: x1 - x0, h: y1 - y0 };
}

const roomRect = (room) => (room ? { x: room.x, y: room.y, w: room.w, h: room.h } : null);

/**
 * project → { count, severity: 'warn' | 'ok', groups: [{ id, title, count, items }] }.
 * opts.norms — готовый normsReport(project) (иначе посчитается);
 * opts.walls, opts.gaps — стены и зазоры активного этажа (иначе посчитаются).
 */
export function collectIssues(project, opts = {}) {
  const items = [];
  const levels = sortedLevels(project);
  const multi = levels.length > 1;
  const levelName = (id) => (multi ? levels.find((l) => l.id === id)?.name || '' : '');
  const lps = new Map(levels.map((l) => [l.id, levelProject(project, l.id)]));
  const roomOf = (levelId, id) => lps.get(levelId)?.rooms.find((r) => r.id === id) || null;
  const push = (entry) => items.push({ severity: 'warn', title: '', actions: [], target: null, focus: null, ...entry, levelName: levelName(entry.levelId) });

  // --- Связность: вход и доступ к помещениям (по этажам).
  for (const level of levels) {
    const lp = lps.get(level.id);
    if (!lp.rooms.length) continue;
    const active = level.id === project.activeLevel;
    const walls = active && opts.walls ? opts.walls : deriveWalls(lp);
    const analysis = analyzeConnectivity(lp, walls);
    const upper = isUpperLevel(lp, level.id);
    let problems = 0;
    if (!analysis.hasEntrance) {
      problems += 1;
      push({
        id: `access:${level.id}:entrance`, group: 'access', levelId: level.id,
        text: upper
          ? 'Нет лестницы — добавьте помещение «Лестница» над лестницей этажа ниже'
          : 'Нет входной двери — добавьте дверь на наружной стене',
        focus: unionRect(lp.rooms.map(roomRect)),
      });
    }
    for (const roomId of analysis.unreachable) {
      const hint = suggestAccess(lp, roomId, analysis);
      if (!hint) continue;
      problems += 1;
      const room = roomOf(level.id, roomId);
      const other = hint.targetId ? roomOf(level.id, hint.targetId) : null;
      push({
        id: `access:${level.id}:${roomId}`, group: 'access', levelId: level.id,
        text: hint.text,
        target: { type: 'room', id: roomId },
        focus: unionRect([roomRect(room), roomRect(other)]),
      });
    }
    if (!problems) {
      push({
        id: `access:${level.id}:ok`, group: 'access', levelId: level.id, severity: 'ok', mark: '✓',
        text: upper ? 'Все помещения этажа доступны от лестницы' : 'Все помещения доступны от входа',
      });
    }
  }

  // --- Нормы: инсоляция и проверки комнат.
  let norms = opts.norms;
  if (norms === undefined) {
    try { norms = normsReport(project); } catch { norms = null; }
  }
  if (norms) {
    const ins = norms.insolation;
    const verdict = !ins.need
      ? 'жилых комнат нет'
      : `в норме ${ins.met}, нужно ${ins.need} ${ins.ok ? '— выполнено' : '— не хватает'}`;
    push({
      id: 'light:insolation', group: 'light', levelId: project.activeLevel,
      severity: ins.ok ? 'ok' : 'warn', mark: ins.ok ? '✓' : '✗',
      title: '☀ Инсоляция',
      text: `${ins.norm.zone} зона: ${fmtHours(ins.norm.hours)} ч на ${fmtDay(ins.norm.day)}, ${verdict}`,
    });
    // Строки по жилым комнатам — справочные (в число входит общий итог выше).
    for (const r of ins.rooms.filter((q) => q.living)) {
      push({
        id: `light:sun:${r.id}`, group: 'light', levelId: r.levelId, severity: 'ok', mark: r.meets ? '✓' : '✗',
        title: r.name,
        text: r.windows ? `инсоляция ${formatDuration(r.longest)} подряд` : 'инсоляция: нет окон',
        target: { type: 'room', id: r.id },
        focus: roomRect(roomOf(r.levelId, r.id)),
      });
    }
    norms.problems.forEach((p, i) => {
      const levelId = p.room.levelId;
      const room = roomOf(levelId, p.room.id);
      const entry = {
        id: `${p.kind}:${levelId}:${p.room.id}:${i}`, group: KIND_GROUP[p.kind] || 'walls', levelId,
        title: p.room.name, text: p.text,
        target: { type: 'room', id: p.room.id },
        focus: roomRect(room),
        actions: [],
      };
      if (p.kind === 'furniture' && p.itemIds?.length) {
        const list = p.itemIds.map((id) => lps.get(levelId)?.items.find((it) => it.id === id)).filter(Boolean);
        entry.target = p.itemIds.length === 1
          ? { type: 'item', id: p.itemIds[0] }
          : { type: 'multi', roomIds: [], itemIds: [...p.itemIds] };
        entry.focus = unionRect(list.map(itemBounds)) || entry.focus;
      }
      if (p.kind === 'overlap') {
        entry.target = { type: 'multi', roomIds: [p.otherId, p.room.id], itemIds: [] };
        entry.focus = unionRect(p.rects || []) || entry.focus;
      }
      if (p.kind === 'wall-divides' && p.wallId) {
        entry.target = { type: 'wall', key: `m|${p.wallId}`, roomId: p.room.id };
      }
      if (p.trim) entry.actions.push({ kind: 'trim', label: p.trim.label, roomId: p.trim.roomId, byId: p.trim.byId });
      if (p.split) entry.actions.push({ kind: 'split', label: p.split.label, roomId: p.split.roomId, wallId: p.split.wallId });
      push(entry);
    });
  }

  // --- Нестандартные зазоры между комнатами (стыковка не сработала).
  for (const level of levels) {
    const lp = lps.get(level.id);
    if (lp.rooms.length < 2) continue;
    const gaps = level.id === project.activeLevel && opts.gaps ? opts.gaps : findNearMissGaps(lp, { move: false });
    for (const gap of gaps) {
      push({
        id: `gap:${level.id}:${gap.key}`, group: 'walls', levelId: level.id,
        text: `Нестандартный зазор ${Math.round(gap.gap)} мм между «${gap.aName}» и «${gap.bName}» — стыковка не сработала`,
        target: { type: 'multi', roomIds: [gap.a, gap.b], itemIds: [] },
        gapKey: gap.key,
        focus: unionRect([roomRect(roomOf(level.id, gap.a)), roomRect(roomOf(level.id, gap.b))]),
        actions: [{ kind: 'dock-gap', label: 'Пристыковать', key: gap.key }],
      });
    }
  }

  const groups = ISSUE_GROUPS.map((g) => {
    const list = items.filter((it) => it.group === g.id);
    return { ...g, items: list, count: list.filter((it) => it.severity === 'warn').length };
  }).filter((g) => g.items.length);
  const count = groups.reduce((s, g) => s + g.count, 0);
  return { count, severity: count ? 'warn' : 'ok', groups };
}
