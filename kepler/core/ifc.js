// Экспорт IFC4 (ISO 10303-21, «STEP») — открытый BIM-формат: Revit,
// ArchiCAD, Renga, BIMcollab, любые IFC-просмотрщики. Чистый модуль.
//
// Состав: проект → участок → здание (с настоящим поворотом относительно
// съёмки и направлением на север) → этажи на своих отметках. На этаже:
// стены (полосы плана, выдавленные на высоту этажа) с проёмами
// (IfcOpeningElement вычитается из стены, в него вставлены IfcDoor /
// IfcWindow), помещения (IfcSpace на высоту потолка), колонны и свободные
// стены. Мебель не выгружается — её проще расставить заново семействами.
//
// Оси IFC: X вправо, Y вверх, Z вверх, миллиметры. План Kepler — Y вниз,
// поэтому y меняет знак, а поворот по часовой становится поворотом против.
// GlobalId устойчивые: выводятся из id элемента — повторный экспорт того же
// проекта сохраняет идентичность элементов.

import { FURNITURE, isRoundItem, isStructural } from './catalog.js';
import { KITCHEN_PARTS, SOFA_MODULES, isFixedSizeComp, partsInHouse } from './composite.js';
import { KITCHEN_PART_HEIGHT } from './kitchen.js';
import { levelProject, roomCeiling, sortedLevels } from './model.js';
import { roomSchedule } from './schedule.js';
import { deriveWalls, openingRect } from './walls.js';

const GUID_CHARS = '0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz_$';

// 128-битный хеш строки (cyrb128) → сжатый GUID IFC из 22 символов.
export function ifcGuid(key) {
  let h1 = 1779033703;
  let h2 = 3144134277;
  let h3 = 1013904242;
  let h4 = 2773480762;
  for (let i = 0; i < key.length; i += 1) {
    const k = key.charCodeAt(i);
    h1 = h2 ^ Math.imul(h1 ^ k, 597399067);
    h2 = h3 ^ Math.imul(h2 ^ k, 2869860233);
    h3 = h4 ^ Math.imul(h3 ^ k, 951274213);
    h4 = h1 ^ Math.imul(h4 ^ k, 2716044179);
  }
  h1 = Math.imul(h3 ^ (h1 >>> 18), 597399067);
  h2 = Math.imul(h4 ^ (h2 >>> 22), 2869860233);
  h3 = Math.imul(h1 ^ (h3 >>> 17), 951274213);
  h4 = Math.imul(h2 ^ (h4 >>> 19), 2716044179);
  let n = 0n;
  for (const h of [h1 ^ h2 ^ h3 ^ h4, h2 ^ h1, h3 ^ h1, h4 ^ h1]) n = (n << 32n) | BigInt(h >>> 0);
  let s = '';
  for (let i = 0; i < 22; i += 1) {
    s = GUID_CHARS[Number(n & 63n)] + s;
    n >>= 6n;
  }
  return s; // 22·6 = 132 бита: старшие 4 нулевые — первый символ 0…3, как положено
}

// Строка STEP: кавычки и обратная косая удваиваются, не-ASCII — \X2\…\X0\.
export function stepString(text) {
  let out = '';
  let wide = '';
  const flush = () => { if (wide) { out += `\\X2\\${wide}\\X0\\`; wide = ''; } };
  for (const ch of String(text ?? '')) {
    const cp = ch.codePointAt(0);
    if (cp >= 32 && cp <= 126) {
      flush();
      out += ch === "'" ? "''" : ch === '\\' ? '\\\\' : ch;
    } else if (cp > 0xffff) {
      const v = cp - 0x10000;
      wide += ((0xd800 + (v >> 10)).toString(16) + (0xdc00 + (v & 0x3ff)).toString(16)).toUpperCase().padStart(8, '0');
    } else {
      wide += cp.toString(16).toUpperCase().padStart(4, '0');
    }
  }
  flush();
  return `'${out}'`;
}

// Вещественное число STEP: всегда с точкой.
const real = (v) => {
  const s = Number(v).toFixed(4).replace(/0+$/, '').replace(/\.$/, '.');
  return s === '-0.' ? '0.' : s;
};

// Высота бруска мебели в IFC по категории каталога, мм.
const CAT_HEIGHT = {
  chairs: 900, tables: 750, beds: 500, seating: 850, storage: 2000, kitchen: 900, appliance: 900, bath: 600,
  office: 750, kids: 800, hall: 1000, decor: 400, gym: 1000, outdoor: 800, misc: 800,
};
const SOFA_PART_HEIGHT = { seat: 850, corner: 850, chaise: 850, arm: 650, ottoman: 450 };
const furnitureHeight = (kind) => CAT_HEIGHT[FURNITURE[kind]?.cat] || 800;

// IfcFurnitureTypeEnum (IFC4) по виду предмета.
function furnitureType(kind) {
  const cat = FURNITURE[kind]?.cat;
  if (kind.startsWith('sofa') || kind === 'loveseat') return '.SOFA.';
  if (cat === 'chairs' || cat === 'seating') return '.CHAIR.';
  if (cat === 'tables') return '.TABLE.';
  if (cat === 'beds') return '.BED.';
  if (/desk/.test(kind)) return '.DESK.';
  if (kind === 'filing-cabinet') return '.FILECABINET.';
  if (/shelf|bookcase/.test(kind)) return '.SHELF.';
  return '.NOTDEFINED.';
}

export function buildIfc(project, { timestamp = new Date() } = {}) {
  const lines = [];
  let next = 1;
  const add = (body) => { const id = next; next += 1; lines.push(`#${id}=${body};`); return `#${id}`; };
  const list = (refs) => `(${refs.join(',')})`;
  const pt = (x, y, z) => add(`IFCCARTESIANPOINT((${real(x)},${real(y)}${z === undefined ? '' : `,${real(z)}`}))`);
  const dir = (x, y, z) => add(`IFCDIRECTION((${real(x)},${real(y)}${z === undefined ? '' : `,${real(z)}`}))`);
  const pid = project.name || 'kepler';
  const guid = (key) => stepString(ifcGuid(`${pid}|${key}`));

  // --- Владелец, контекст, единицы
  const person = add("IFCPERSON($,$,'',$,$,$,$,$)");
  const org = add("IFCORGANIZATION($,'Kepler Plan',$,$,$)");
  const owner = add(`IFCOWNERHISTORY(${add(`IFCPERSONANDORGANIZATION(${person},${org},$)`)},${add(`IFCAPPLICATION(${org},'1.0','Kepler Plan','KeplerPlan')`)},$,.NOCHANGE.,$,$,$,${Math.floor(timestamp.getTime() / 1000)})`);
  const origin = pt(0, 0, 0);
  const zUp = dir(0, 0, 1);
  const xDir = dir(1, 0, 0);
  const world = add(`IFCAXIS2PLACEMENT3D(${origin},${zUp},${xDir})`);
  const nRad = ((project.site?.north || 0) * Math.PI) / 180;
  const north = dir(Math.sin(nRad), Math.cos(nRad)); // север в осях IFC (Y вверх)
  const context = add(`IFCGEOMETRICREPRESENTATIONCONTEXT($,'Model',3,1.E-05,${world},${north})`);
  const body = add(`IFCGEOMETRICREPRESENTATIONSUBCONTEXT('Body','Model',*,*,*,*,${context},$,.MODEL_VIEW.,$)`);
  const units = add(`IFCUNITASSIGNMENT(${list([
    add('IFCSIUNIT(*,.LENGTHUNIT.,.MILLI.,.METRE.)'),
    add('IFCSIUNIT(*,.AREAUNIT.,$,.SQUARE_METRE.)'),
    add('IFCSIUNIT(*,.VOLUMEUNIT.,$,.CUBIC_METRE.)'),
    add('IFCSIUNIT(*,.PLANEANGLEUNIT.,$,.RADIAN.)'),
  ])})`);

  // --- Пространственная структура: проект → участок → здание → этажи
  const proj = add(`IFCPROJECT(${guid('project')},${owner},${stepString(project.name)},$,$,$,$,${list([context])},${units})`);
  const sitePlacement = add(`IFCLOCALPLACEMENT($,${world})`);
  const dms = (deg) => {
    const sign = deg < 0 ? -1 : 1;
    let a = Math.abs(deg);
    const d = Math.floor(a); a = (a - d) * 60;
    const m = Math.floor(a); a = (a - m) * 60;
    const sec = Math.floor(a);
    const micro = Math.round((a - sec) * 1e6);
    return `(${sign * d},${sign * m},${sign * sec},${sign * micro})`;
  };
  const loc = project.site?.location;
  const site = add(`IFCSITE(${guid('site')},${owner},${stepString('Участок')},$,$,${sitePlacement},$,$,.ELEMENT.,${loc ? dms(loc.lat) : '$'},${loc ? dms(loc.lon) : '$'},$,$,$)`);
  // Здание: начало координат дома и его поворот (по часовой на плане → против в IFC).
  const b = project.building || { rotation: 0, origin: { x: 0, y: 0 } };
  const th = ((b.rotation || 0) * Math.PI) / 180;
  const buildingAxes = add(`IFCAXIS2PLACEMENT3D(${pt(b.origin.x, -b.origin.y, 0)},${zUp},${dir(Math.cos(th), -Math.sin(th), 0)})`);
  const buildingPlacement = add(`IFCLOCALPLACEMENT(${sitePlacement},${buildingAxes})`);
  const building = add(`IFCBUILDING(${guid('building')},${owner},${stepString(project.name)},$,$,${buildingPlacement},$,$,.ELEMENT.,$,$,$)`);
  add(`IFCRELAGGREGATES(${guid('rel-project-site')},${owner},$,$,${proj},${list([site])})`);
  add(`IFCRELAGGREGATES(${guid('rel-site-building')},${owner},$,$,${site},${list([building])})`);

  const solid = (profile, z0, depth) => add(`IFCEXTRUDEDAREASOLID(${profile},${add(`IFCAXIS2PLACEMENT3D(${pt(0, 0, z0)},$,$)`)},${zUp},${real(depth)})`);
  const rectProfile = (cx, cy, w, h, angle = 0) => add(`IFCRECTANGLEPROFILEDEF(.AREA.,$,${add(`IFCAXIS2PLACEMENT2D(${pt(cx, cy)},${dir(Math.cos(angle), Math.sin(angle))})`)},${real(w)},${real(h)})`);
  const circleProfile = (cx, cy, r) => add(`IFCCIRCLEPROFILEDEF(.AREA.,$,${add(`IFCAXIS2PLACEMENT2D(${pt(cx, cy)},$)`)},${real(r)})`);
  const shape = (item) => add(`IFCPRODUCTDEFINITIONSHAPE($,$,${list([add(`IFCSHAPEREPRESENTATION(${body},'Body','SweptSolid',${list([item])})`)])})`);

  const storeys = [];
  const counts = { walls: 0, doors: 0, windows: 0, spaces: 0, columns: 0, furniture: 0, furnitureParts: 0 };
  const schedule = roomSchedule(project);
  for (const level of sortedLevels(project)) {
    const lp = levelProject(project, level.id);
    const placement = add(`IFCLOCALPLACEMENT(${buildingPlacement},${add(`IFCAXIS2PLACEMENT3D(${pt(0, 0, level.elevation)},$,$)`)})`);
    const storey = add(`IFCBUILDINGSTOREY(${guid(`storey-${level.id}`)},${owner},${stepString(level.name)},$,$,${placement},$,$,.ELEMENT.,${real(level.elevation)})`);
    storeys.push(storey);
    const contained = [];
    const spaces = [];

    // Стены: каждая полоса плана — прямоугольник, выдавленный на высоту этажа.
    const walls = deriveWalls(lp);
    const wallRef = new Map();
    walls.forEach((w, i) => {
      const band = w.band;
      if (band.w < 1 || band.h < 1) return;
      const profile = rectProfile(band.x + band.w / 2, -(band.y + band.h / 2), band.w, band.h);
      const name = w.kind === 'shared' ? 'Перегородка общая' : w.kind === 'own' ? 'Стена' : 'Стена (стык)';
      const ref = add(`IFCWALL(${guid(`wall-${level.id}-${w.key}-${i}`)},${owner},${stepString(name)},$,$,${placement},${shape(solid(profile, 0, level.height))},$,.STANDARD.)`);
      wallRef.set(w, ref);
      contained.push(ref);
      counts.walls += 1;
    });

    // Проёмы: вычитание из стены + дверь/окно в проёме.
    for (const o of lp.openings) {
      const placed = openingRect(lp, o, walls);
      if (!placed || !wallRef.has(placed.wall)) continue;
      const r = placed.rect;
      const horiz = placed.wall.orient === 'h';
      const bottom = o.kind === 'door' ? 0 : Math.max(0, o.sill ?? 900);
      const height = Math.min(level.height - bottom - 50, o.height ?? (o.kind === 'door' ? 2100 : 1500));
      const cx = r.x + r.w / 2;
      const cy = -(r.y + r.h / 2);
      // Проём чуть толще стены — режет насквозь.
      const cut = rectProfile(cx, cy, horiz ? r.w : r.w + 20, horiz ? r.h + 20 : r.h);
      const opening = add(`IFCOPENINGELEMENT(${guid(`opening-${o.id}`)},${owner},${stepString(o.kind === 'door' ? 'Проём двери' : 'Проём окна')},$,$,${placement},${shape(solid(cut, bottom, height))},$,.OPENING.)`);
      add(`IFCRELVOIDSELEMENT(${guid(`void-${o.id}`)},${owner},$,$,${wallRef.get(placed.wall)},${opening})`);
      // Полотно двери / стекло окна — тонкая плита посередине стены.
      const panel = rectProfile(cx, cy, horiz ? r.w : 50, horiz ? 50 : r.h);
      let filler;
      if (o.kind === 'door') {
        const op = { double: '.DOUBLE_DOOR_SINGLE_SWING.', sliding: '.SLIDING_TO_LEFT.', none: '.NOTDEFINED.' }[o.type]
          || (o.hingeStart ? '.SINGLE_SWING_LEFT.' : '.SINGLE_SWING_RIGHT.');
        filler = add(`IFCDOOR(${guid(`door-${o.id}`)},${owner},${stepString('Дверь')},$,$,${placement},${shape(solid(panel, bottom, height))},$,${real(height)},${real(o.width)},.DOOR.,${op},$)`);
        counts.doors += 1;
      } else {
        filler = add(`IFCWINDOW(${guid(`window-${o.id}`)},${owner},${stepString(o.type === 'panoramic' ? 'Окно панорамное' : 'Окно')},$,$,${placement},${shape(solid(panel, bottom, height))},$,${real(height)},${real(o.width)},.WINDOW.,.SINGLE_PANEL.,$)`);
        counts.windows += 1;
      }
      add(`IFCRELFILLSELEMENT(${guid(`fill-${o.id}`)},${owner},$,$,${opening},${filler})`);
      contained.push(filler);
    }

    // Помещения: внутренний прямоугольник на высоту потолка; номер — из экспликации.
    const numbers = new Map((schedule.find((s) => s.level.id === level.id)?.rows || []).map((row) => [row.id, row.number]));
    for (const room of lp.rooms) {
      const profile = rectProfile(room.x + room.w / 2, -(room.y + room.h / 2), room.w, room.h);
      const sp = add(`IFCSPACE(${guid(`space-${room.id}`)},${owner},${stepString(numbers.get(room.id) || room.name)},$,$,${placement},${shape(solid(profile, 0, roomCeiling(room, level)))},${stepString(room.name)},.ELEMENT.,.SPACE.,$)`);
      spaces.push(sp);
      counts.spaces += 1;
    }

    // Колонны и свободные стены.
    for (const item of lp.items) {
      if (!isStructural(item.kind)) continue;
      const angle = -((item.rotation || 0) * Math.PI) / 180;
      const profile = isRoundItem(item.kind)
        ? circleProfile(item.x, -item.y, item.w / 2)
        : rectProfile(item.x, -item.y, item.w, item.h, angle);
      const geom = shape(solid(profile, 0, level.height));
      const ref = item.kind === 'wall-free'
        ? add(`IFCWALL(${guid(`freewall-${item.id}`)},${owner},${stepString('Стена')},$,$,${placement},${geom},$,.STANDARD.)`)
        : add(`IFCCOLUMN(${guid(`column-${item.id}`)},${owner},${stepString('Колонна')},$,$,${placement},${geom},$,.COLUMN.)`);
      if (item.kind === 'wall-free') counts.walls += 1; else counts.columns += 1;
      contained.push(ref);
    }

    // Мебель: IfcFurniture с габаритным телом (брусок на высоту по виду).
    // Составная — родитель + части (стулья стола, модули дивана) отдельными
    // IfcFurniture через IfcRelAggregates; в этаж входит только родитель.
    // У дивана-конструктора своего тела нет — он весь из модулей.
    for (const item of lp.items) {
      if (isStructural(item.kind)) continue;
      const box = (kind, x, y, w, h, rotDeg, height, z0 = 0) => {
        const angle = -((rotDeg || 0) * Math.PI) / 180;
        const profile = isRoundItem(kind) || /round/.test(kind) // круглый стол, ковёр
          ? add(`IFCELLIPSEPROFILEDEF(.AREA.,$,${add(`IFCAXIS2PLACEMENT2D(${pt(x, -y)},${dir(Math.cos(angle), Math.sin(angle))})`)},${real(w / 2)},${real(h / 2)})`)
          : rectProfile(x, -y, w, h, angle);
        return shape(solid(profile, z0, height));
      };
      const geom = isFixedSizeComp(item) ? '$' : box(item.kind, item.x, item.y, item.w, item.h, item.rotation, furnitureHeight(item.kind));
      const parent = add(`IFCFURNITURE(${guid(`furniture-${item.id}`)},${owner},${stepString(FURNITURE[item.kind]?.title || item.kind)},$,${stepString(item.kind)},${placement},${geom},$,${furnitureType(item.kind)})`);
      contained.push(parent);
      counts.furniture += 1;
      const parts = partsInHouse(item).map((p, i) => {
        const module = p.kind.startsWith('sofa:') ? p.kind.slice(5) : null;
        const kpart = p.kind.startsWith('kitchen:') ? p.kind.slice(8) : null;
        const title = module ? `Диван: ${SOFA_MODULES[module]?.title || module}`
          : kpart ? `Кухня: ${KITCHEN_PARTS[kpart] || kpart}` : (FURNITURE[p.kind]?.title || p.kind);
        const height = module ? SOFA_PART_HEIGHT[module] || 850 : kpart ? KITCHEN_PART_HEIGHT[kpart] || 900 : furnitureHeight(p.kind);
        // Верхний ряд кухни висит: шкафы 1400–2100, вытяжка 1700–2100 мм.
        const z0 = p.layer === 'upper' ? 2100 - height : 0;
        counts.furnitureParts += 1;
        return add(`IFCFURNITURE(${guid(`furniture-${item.id}-part-${i}`)},${owner},${stepString(title)},$,${stepString(p.kind)},${placement},${box(p.kind, p.x, p.y, p.w, p.h, p.rotation, height, z0)},$,${module ? '.SOFA.' : furnitureType(p.kind)})`);
      });
      if (parts.length) add(`IFCRELAGGREGATES(${guid(`furniture-parts-${item.id}`)},${owner},$,$,${parent},${list(parts)})`);
    }

    if (contained.length) add(`IFCRELCONTAINEDINSPATIALSTRUCTURE(${guid(`contains-${level.id}`)},${owner},$,$,${list(contained)},${storey})`);
    if (spaces.length) add(`IFCRELAGGREGATES(${guid(`spaces-${level.id}`)},${owner},$,$,${storey},${list(spaces)})`);
  }
  add(`IFCRELAGGREGATES(${guid('rel-building-storeys')},${owner},$,$,${building},${list(storeys)})`);

  const stamp = timestamp.toISOString().slice(0, 19);
  const text = [
    'ISO-10303-21;',
    'HEADER;',
    "FILE_DESCRIPTION(('ViewDefinition [ReferenceView_V1.2]'),'2;1');",
    `FILE_NAME(${stepString(`${project.name || 'kepler'}.ifc`)},'${stamp}',(''),('Kepler Plan'),'Kepler Plan','Kepler Plan','');`,
    "FILE_SCHEMA(('IFC4'));",
    'ENDSEC;',
    'DATA;',
    ...lines,
    'ENDSEC;',
    'END-ISO-10303-21;',
    '',
  ].join('\n');
  return { text, counts };
}
