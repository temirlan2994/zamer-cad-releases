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
// в число замечаний не входит. Группы включает/выключает пользователь
// (opts.enabled), отдельные замечания он скрывает в проекте
// (project.settings.dismissedIssues — id записей).

import { itemBounds } from './clearance.js';
import { findNearMissGaps } from './gaps.js';
import { formatDuration } from './insolation.js';
import { isUpperLevel, levelProject, sortedLevels } from './model.js';
import { normsReport } from './norms.js';
import { analyzeConnectivity, suggestAccess } from './rooms.js';
import { orphanOpenings } from './opening-spacing.js';
import { deriveWalls, openingRect, projectAdjacencies } from './walls.js';

// Группы замечаний. on — включена по умолчанию (переключатели в панели «⚠»
// хранятся у пользователя, ui/issues.js): шумные справочные проверки по
// нормам выключены, геометрия и мебель — включены.
export const ISSUE_GROUPS = [
  { id: 'access', title: 'Доступность и двери', short: 'Двери', on: false },
  { id: 'norms', title: 'Нормы площадей и размеров', short: 'Нормы', on: false },
  { id: 'light', title: 'Свет и окна', short: 'Свет', on: false },
  { id: 'insolation', title: 'Инсоляция', short: 'Инсоляция', on: false },
  // Тяжёлая проверка проходов живёт в отдельном виде «Эргономика».
  { id: 'furniture', title: 'Проходы у мебели', short: 'Мебель', on: false },
  { id: 'geometry', title: 'Геометрия', short: 'Геометрия', on: true },
  // Эргономика мебели (core/ergonomics.js): включена, пока включён режим
  // «Эргономика» (ui/ergonomics.js) — записи приходят в opts.ergo.
  { id: 'ergo', title: 'Эргономика мебели', short: 'Эргономика', on: false },
];
export const DEFAULT_ISSUE_GROUPS = ISSUE_GROUPS.filter((g) => g.on).map((g) => g.id);

// Вид проверки normsReport → группа.
const KIND_GROUP = {
  area: 'norms', width: 'norms', height: 'norms',
  light: 'light',
  furniture: 'furniture',
  overlap: 'geometry',
  bound: 'geometry', 'wall-divides': 'geometry',
};

// Ключ пары помещений (порядок не важен).
export const pairKey = (a, b) => [a, b].sort().join('|');

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

const polyBox = (pts) => {
  const xs = pts.map((p) => p.x); const ys = pts.map((p) => p.y);
  return { x: Math.min(...xs), y: Math.min(...ys), w: Math.max(...xs) - Math.min(...xs), h: Math.max(...ys) - Math.min(...ys) };
};
const roomRect = (room) => (room ? { x: room.x, y: room.y, w: room.w, h: room.h } : null);

// Скрытые пользователем замечания проекта (project.settings.dismissedIssues).
export function dismissedIssueIds(project) {
  const list = project?.settings?.dismissedIssues;
  return new Set(Array.isArray(list) ? list.filter((x) => typeof x === 'string' && x) : []);
}

/**
 * project → { count, severity, groups, summary, hidden, enabledCount, total }.
 *   groups — включённые группы с записями: [{ id, title, count, items }];
 *   summary — все группы по порядку: [{ id, title, short, enabled, computed, count }]
 *     (выключенная группа не рассчитывается: computed=false, count=0);
 *   hidden — скрытые предупреждения (project.settings.dismissedIssues), все группы;
 *   count — предупреждения включённых групп без скрытых (бейдж кнопки).
 * opts.enabled — id включённых групп (по умолчанию — все);
 * opts.norms — готовый normsReport(project) (иначе посчитается);
 * opts.walls, opts.gaps — стены и зазоры активного этажа (иначе посчитаются);
 * opts.ergo — находки эргономики активного этажа (core/ergonomics.js).
 * id записей стабильны между пересчётами (по комнатам, парам, предметам) —
 * по ним запоминается «Скрыть».
 */
export function collectIssues(project, opts = {}) {
  const items = [];
  // Выключенные группы не должны замедлять черчение. Раньше фильтр применялся
  // только после полного расчёта, поэтому скрытая «Доступность» давала O(n³)
  // на плане без дверей. Без opts.enabled сохраняется полный отчёт для
  // экспорта, тестов и явно открытой общей аналитики.
  const enabled = new Set(opts.enabled ? [...opts.enabled] : ISSUE_GROUPS.map((g) => g.id));
  const on = (id) => enabled.has(id);
  const levels = sortedLevels(project);
  const multi = levels.length > 1;
  const levelName = (id) => (multi ? levels.find((l) => l.id === id)?.name || '' : '');
  const lps = new Map(levels.map((l) => [l.id, levelProject(project, l.id)]));
  const roomOf = (levelId, id) => lps.get(levelId)?.rooms.find((r) => r.id === id) || null;
  const seen = new Map();
  const push = (entry) => {
    // Совпавший id (два одинаковых замечания) — с порядковым суффиксом.
    const n = seen.get(entry.id) || 0;
    seen.set(entry.id, n + 1);
    const id = n ? `${entry.id}#${n + 1}` : entry.id;
    items.push({ severity: 'warn', title: '', actions: [], target: null, focus: null, ...entry, id, levelName: levelName(entry.levelId) });
  };

  // --- Связность: вход и доступ к помещениям (по этажам).
  // Соседства считаются один раз на этаж и переиспользуются всеми группами
  // недоступных помещений. Раньше suggestAccess выводил их заново для каждой
  // комнаты: n подсказок × n² пар помещений.
  for (const level of on('access') ? levels : []) {
    const lp = lps.get(level.id);
    if (!lp.rooms.length) continue;
    const active = level.id === project.activeLevel;
    const walls = active && opts.walls ? opts.walls : deriveWalls(lp);
    const adjacencies = projectAdjacencies(lp);
    const analysis = analyzeConnectivity(lp, walls, adjacencies);
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
    // Одна подсказка на связную группу недоступных помещений.
    const covered = new Set();
    for (const roomId of analysis.unreachable) {
      if (covered.has(roomId)) continue;
      const hint = suggestAccess(lp, roomId, analysis, adjacencies);
      if (!hint) continue;
      for (const id of hint.members || [roomId]) covered.add(id);
      problems += 1;
      const own = hint.roomId || roomId;
      const room = roomOf(level.id, own);
      const other = hint.targetId ? roomOf(level.id, hint.targetId) : null;
      push({
        id: hint.targetId ? `access:${level.id}:${pairKey(own, hint.targetId)}` : `access:${level.id}:${own}`,
        group: 'access', levelId: level.id,
        text: hint.text,
        target: { type: 'room', id: own },
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
  const normGroupsOn = ['norms', 'light', 'insolation', 'furniture', 'geometry'].some(on);
  let norms = normGroupsOn ? opts.norms : null;
  if (normGroupsOn && norms === undefined) {
    try { norms = normsReport(project); } catch { norms = null; }
  }
  if (norms) {
    const ins = norms.insolation;
    // Инсоляция — только жилые комнаты; без участка (граница, норма) итог
    // справочный: стороны света и окружение не заданы.
    const known = ins.siteKnown !== false;
    if (on('insolation') && ins.need) {
      const warn = !ins.ok && known;
      push({
        id: 'insolation:house', group: 'insolation', levelId: project.activeLevel,
        severity: warn ? 'warn' : 'ok', mark: ins.ok ? '✓' : (known ? '✗' : 'ℹ'),
        title: '☀ Инсоляция',
        text: `${ins.norm.zone} зона: ${fmtHours(ins.norm.hours)} ч на ${fmtDay(ins.norm.day)}, в норме ${ins.met}, нужно ${ins.need} ${ins.ok ? '— выполнено' : '— не хватает'}${known ? '' : ' (участок не задан — оценка ориентировочная)'}`,
      });
    }
    // Строки по жилым комнатам — справочные (в число входит общий итог выше).
    for (const r of on('insolation') ? ins.rooms.filter((q) => q.living) : []) {
      push({
        id: `insolation:sun:${r.id}`, group: 'insolation', levelId: r.levelId, severity: 'ok', mark: r.meets ? '✓' : '✗',
        title: r.name,
        text: r.windows ? `инсоляция ${formatDuration(r.longest)} подряд` : 'инсоляция: нет окон',
        target: { type: 'room', id: r.id },
        focus: roomRect(roomOf(r.levelId, r.id)),
      });
    }
    for (const p of norms.problems) {
      const problemGroup = KIND_GROUP[p.kind] || 'geometry';
      if (!on(problemGroup)) continue;
      const levelId = p.room.levelId;
      const room = roomOf(levelId, p.room.id);
      const entry = {
        id: problemId(p, levelId), group: problemGroup, levelId,
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
    }
  }

  // --- Нестандартные зазоры между комнатами (стыковка не сработала).
  for (const level of on('geometry') ? levels : []) {
    const lp = lps.get(level.id);
    if (lp.rooms.length < 2) continue;
    const gaps = level.id === project.activeLevel && opts.gaps ? opts.gaps : findNearMissGaps(lp, { move: false });
    for (const gap of gaps) {
      push({
        id: `gap:${level.id}:${gap.key}`, group: 'geometry', levelId: level.id,
        text: `Нестандартный зазор ${Math.round(gap.gap)} мм между «${gap.aName}» и «${gap.bName}» — стыковка не сработала`,
        target: { type: 'multi', roomIds: [gap.a, gap.b], itemIds: [] },
        gapKey: gap.key,
        focus: unionRect([roomRect(roomOf(level.id, gap.a)), roomRect(roomOf(level.id, gap.b))]),
        actions: [{ kind: 'dock-gap', label: 'Пристыковать', key: gap.key }],
      });
    }
  }

  // --- Проёмы: окно в общей стене (межкомнатное — света снаружи нет) и
  // проёмы-«сироты» без стены (хранятся в проекте, вернутся со стеной).
  for (const level of on('geometry') ? levels : []) {
    const lp = lps.get(level.id);
    if (!lp.openings?.length && !lp.rooms.some((r) => r.eatBase?.openings?.length)) continue;
    const walls = level.id === project.activeLevel && opts.walls ? opts.walls : deriveWalls(lp);
    for (const o of lp.openings || []) {
      if (o.kind !== 'window' || o.orphan) continue;
      const placed = openingRect(lp, o, walls);
      if (!placed || placed.wall.kind !== 'shared') continue;
      const room = roomOf(level.id, o.roomId);
      push({
        id: `opening:${level.id}:shared:${o.id}`, group: 'geometry', levelId: level.id,
        title: room?.name || '',
        text: 'Окно в общей стене — нет света снаружи',
        target: { type: 'opening', id: o.id },
        focus: placed.rect,
      });
    }
    for (const { opening, room, under } of orphanOpenings(lp)) {
      const what = opening.kind === 'door' ? 'дверь' : opening.kind === 'window' ? 'окно' : opening.kind;
      push({
        id: `opening:${level.id}:orphan:${opening.id}`, group: 'geometry', levelId: level.id,
        title: room?.name || '',
        text: under
          ? `Проём «${what}» под соседней комнатой — вернётся, если её сдвинуть`
          : `Проём «${what}» потерял стену — верните комнату или перенесите проём`,
        target: room ? { type: 'room', id: room.id } : null,
        focus: roomRect(room),
      });
    }
  }

  // --- Эргономика мебели (режим «Эргономика»): ошибки и замечания активного
  // этажа; переход — к первому предмету находки.
  for (const f of on('ergo') ? opts.ergo || [] : []) {
    if (f.severity !== 'error' && f.severity !== 'warn') continue;
    const lp = lps.get(project.activeLevel);
    const room = roomOf(project.activeLevel, f.roomId);
    const list = f.itemIds.map((id) => lp?.items.find((it) => it.id === id)).filter(Boolean);
    push({
      id: f.id, group: 'ergo', levelId: project.activeLevel, mark: f.severity === 'error' ? '⛔' : '⚠',
      title: room?.name || '', text: f.text,
      target: f.itemIds.length ? { type: 'item', id: f.itemIds[0] } : (room ? { type: 'room', id: room.id } : null),
      focus: unionRect([...list.map(itemBounds), ...(f.zone ? [polyBox(f.zone)] : [])]) || roomRect(room),
      ergo: f.severity,
    });
  }

  // --- Фильтры: включённые группы и скрытые замечания (только
  // предупреждения: справочные строки ✓ не скрываются и не считаются).
  const dismissed = dismissedIssueIds(project);
  const hidden = [];
  for (const it of items) {
    it.dismissed = it.severity === 'warn' && dismissed.has(it.id);
    if (it.dismissed) hidden.push(it);
  }
  const live = items.filter((it) => !it.dismissed);
  const summary = ISSUE_GROUPS.map((g) => ({
    id: g.id, title: g.title, short: g.short, enabled: enabled.has(g.id),
    computed: enabled.has(g.id),
    count: live.filter((it) => it.group === g.id && it.severity === 'warn').length,
  }));
  const groups = ISSUE_GROUPS.filter((g) => enabled.has(g.id)).map((g) => {
    const list = live.filter((it) => it.group === g.id);
    return { id: g.id, title: g.title, items: list, count: list.filter((it) => it.severity === 'warn').length };
  }).filter((g) => g.items.length);
  const count = groups.reduce((s, g) => s + g.count, 0);
  return {
    count, severity: count ? 'warn' : 'ok', groups, summary, hidden,
    enabledCount: summary.filter((g) => g.enabled).length, total: ISSUE_GROUPS.length,
  };
}

// Стабильный id замечания нормы: вид, этаж, комната и что именно (предметы,
// стена, пара комнат) — без порядкового номера в списке.
function problemId(p, levelId) {
  const room = p.room.id;
  if (p.kind === 'overlap') return `overlap:${levelId}:${pairKey(p.otherId, room)}`;
  if (p.kind === 'wall-divides') return `wall-divides:${levelId}:${room}:${p.wallId || ''}`;
  if (p.kind === 'furniture') return `furniture:${levelId}:${room}:${p.sub || ''}:${[...(p.itemIds || [])].sort().join(',')}`;
  if (['area', 'width', 'height', 'light'].includes(p.kind)) return `${p.kind}:${levelId}:${room}`;
  return `${p.kind}:${levelId}:${room}:${p.text}`;
}
