// Разрезы участка на листе A3 (без DOM): какие разрезы выносить, масштаб
// каждого — самый крупный стандартный, при котором SVG влезает в поле листа
// по ширине (и по высоте), раскладка столбиком на один или несколько листов.

import { sectionProfile } from '../core/landscape-section.js';
import { SECTION_SCALES, sectionSvg, sectionSvgSize } from './landscape-section-svg.js';

export const SECTION_GAP = 4; // мм между разрезами на листе

// Самый крупный масштаб из SECTION_SCALES, при котором разрез влезает в поле.
export function sheetSectionScale(profile, areaW, areaH) {
  return SECTION_SCALES.find((d) => {
    const s = sectionSvgSize(profile, d);
    return s.width <= areaW && s.height <= areaH;
  }) ?? SECTION_SCALES[SECTION_SCALES.length - 1];
}

// Отбор: pref { on, off: [id…] } — выключатель и исключённые разрезы.
export function pickSheetSections(sections, pref) {
  if (!pref?.on) return [];
  const off = new Set(pref.off || []);
  return (sections || []).filter((s) => !off.has(s.id));
}

// Разрезы → элементы листа { id, name, den, width, height, svg }. Если все
// разрезы помещаются на один лист в общем масштабе не мельче вдвое против
// своего — общий масштаб (один лист, разрезы сравнимы); иначе у каждого свой.
export function sheetSectionItems(project, sections, { areaW, areaH, style = 'drawing', gap = SECTION_GAP }) {
  const pairs = sections.map((sec) => ({ sec, prof: sectionProfile(project, sec, sec.side, { depth: sec.depth }) })).filter((q) => q.prof);
  if (!pairs.length) return [];
  const profs = pairs.map((q) => q.prof);
  const own = profs.map((prof) => sheetSectionScale(prof, areaW, areaH));
  const worst = Math.max(...own);
  const common = profs.length > 1 ? SECTION_SCALES.find((d) => d >= worst && d <= worst * 2
    && profs.every((prof) => sectionSvgSize(prof, d).width <= areaW)
    && profs.reduce((h, prof) => h + sectionSvgSize(prof, d).height, 0) + gap * (profs.length - 1) <= areaH) : null;
  return profs.map((prof, i) => {
    const den = common || own[i];
    const { width, height } = sectionSvgSize(prof, den);
    return { id: pairs[i].sec.id, name: pairs[i].sec.name, den, width, height, svg: sectionSvg(prof, { style, scale: den }) };
  });
}

// Раскладка столбиком: [[{ item, x, y }…] — лист…]; x — по центру поля.
export function packSectionSheets(items, { x0, y0, areaW, areaH, gap = SECTION_GAP }) {
  const pages = [];
  let cur = [];
  let used = 0;
  for (const item of items) {
    const need = item.height + (cur.length ? gap : 0);
    if (cur.length && used + need > areaH) { pages.push(cur); cur = []; used = 0; }
    const y = y0 + used + (cur.length ? gap : 0);
    cur.push({ item, x: x0 + Math.max(0, (areaW - item.width) / 2), y });
    used += item.height + (cur.length > 1 ? gap : 0);
  }
  if (cur.length) pages.push(cur);
  return pages;
}

// SVG в пикселях листа (dpi), чтобы растр не размывался при печати.
export function svgAtDpi(svg, item, pxPerMm) {
  return svg.replace(/^<svg([^>]*?) width="[^"]+" height="[^"]+"/, (_, pre) => `<svg${pre} width="${Math.round(item.width * pxPerMm)}" height="${Math.round(item.height * pxPerMm)}"`);
}
