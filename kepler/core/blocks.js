// Реестр «блоков мебели» — готовых предметов фиксированного размера w×h
// (стул, табурет…), которые составная мебель (core/composite.js) расставляет
// как свои части. Блок НЕ растягивается: его размер задан один раз.
// Чистый модуль без DOM.
//
// Встроенные блоки — предметы каталога из группы (сейчас: категория «Стулья»),
// рисуются теми же глифами, что и обычная мебель (glyph = kind каталога).
// Позже сюда же добавляются блоки из DXF пользователя:
//   registerBlock({ id: 'dxf:Стул-1', title, group: 'chair', w, h, lines })
// lines — отрезки [[x1, y1, x2, y2], …] в мм в осях блока: центр в (0, 0),
// ось Y вниз; «лицо» (сиденье) смотрит в +Y, спинка — в −Y.

import { FURNITURE } from './catalog.js';

// Группы блоков → категории каталога, из которых берутся встроенные.
const BUILTIN_GROUPS = {
  chair: 'chairs',
};

const custom = new Map(); // id → блок пользователя

const validLines = (lines) => Array.isArray(lines)
  && lines.every((l) => Array.isArray(l) && l.length === 4 && l.every(Number.isFinite));

function builtin(id) {
  const fd = FURNITURE[id];
  if (!fd || fd.structural) return null;
  const group = Object.keys(BUILTIN_GROUPS).find((g) => BUILTIN_GROUPS[g] === fd.cat) || null;
  return { id, title: fd.title, group, w: fd.w, h: fd.h, glyph: id, source: 'catalog' };
}

// Блок по id (свой из DXF или предмет каталога); null — нет такого.
export function furnitureBlock(id) {
  return custom.get(id) || builtin(id);
}

// Все блоки группы: сначала встроенные, потом пользователя.
export function blocksByGroup(group) {
  const cat = BUILTIN_GROUPS[group];
  const own = cat ? Object.keys(FURNITURE).filter((k) => FURNITURE[k].cat === cat).map(builtin) : [];
  return [...own, ...[...custom.values()].filter((b) => b.group === group)];
}

// Добавляет блок пользователя (например, из DXF). Возвращает блок.
export function registerBlock(def) {
  const w = Number(def?.w);
  const h = Number(def?.h);
  if (!def?.id || typeof def.id !== 'string') throw new Error('У блока нет id');
  if (!(w > 0 && h > 0)) throw new Error(`Блок «${def.id}»: размер должен быть больше нуля`);
  if (def.lines != null && !validLines(def.lines)) throw new Error(`Блок «${def.id}»: неверные линии`);
  const block = {
    id: def.id,
    title: String(def.title || def.id),
    group: def.group || 'chair',
    w,
    h,
    glyph: def.glyph || null,
    lines: def.lines || null,
    source: def.source || 'dxf',
  };
  custom.set(block.id, block);
  return block;
}

export function unregisterBlock(id) {
  return custom.delete(id);
}
