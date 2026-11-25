// Оконно-дверной блок хранится одним проёмом. Для плана, 3D и расчётов
// получаем отдельные створки с тем же id: перенос и Undo относятся ко всему блоку.
export const GLAZED_OPENING_TYPES = {
  'glazed-swing': 'Распашная',
  'glazed-double': 'Остекление с двумя распашными дверями',
  'glazed-sliding': 'Раздвижная',
  'balcony-swing': 'Балконная дверь',
  'balcony-sliding': 'Балконный блок · раздвижная дверь',
};
export const isGlazedAssembly = (opening) => Boolean(GLAZED_OPENING_TYPES[opening?.type]) && !opening.assemblyPart;
export const isGlazing = (opening) => opening?.kind === 'window' || Boolean(opening?.glazed);
export function glazedOpeningMinWidth(opening) {
  const spec = glazedAssemblySpec(opening);
  if (!spec) return 300;
  const doorMin = spec.doorType === 'single' ? 600 : 1200;
  const count = Number(spec.leftWindow) + Number(spec.rightWindow);
  return count ? Math.max(doorMin, spec.doorWidth) + count * (300 + spec.gap) : doorMin;
}

export function glazedAssemblySpec(opening) {
  if (!isGlazedAssembly(opening)) return null;
  const width = Math.max(300, Number(opening.width) || 2200);
  const height = Math.max(300, Number(opening.height) || 2300);
  const balcony = opening.type.startsWith('balcony-');
  const sliding = opening.type.endsWith('sliding');
  const double = opening.type === 'glazed-double';
  const assembly = opening.assembly || {};
  const gap = balcony && width >= 700 ? 100 : 0;
  const requested = Number(opening.assembly?.doorWidth) || (sliding || double ? (balcony ? 1800 : width) : 900);
  const explicit = typeof assembly.leftWindow === 'boolean' || typeof assembly.rightWindow === 'boolean';
  const legacyWindow = balcony ? width >= 700 : width - requested >= 300;
  let leftWindow = explicit ? assembly.leftWindow === true : legacyWindow && assembly.doorSide === 'end';
  let rightWindow = explicit ? assembly.rightWindow === true : legacyWindow && !leftWindow;
  // Узкий импортированный блок не должен породить створки за своим габаритом.
  if (width < 300 + (Number(leftWindow) + Number(rightWindow)) * (300 + gap)) {
    leftWindow = false; rightWindow = false;
  }
  const count = Number(leftWindow) + Number(rightWindow);
  const doorWidth = count ? Math.min(width - count * (300 + gap), Math.max(300, requested)) : width;
  const available = width - doorWidth - count * gap;
  const leftWeight = Math.max(300, Number(assembly.leftWidth) || 600);
  const rightWeight = Math.max(300, Number(assembly.rightWidth) || 600);
  const leftWidth = leftWindow ? rightWindow
    ? Math.max(300, Math.min(available - 300, available * leftWeight / (leftWeight + rightWeight))) : available : 0;
  const rightWidth = rightWindow ? available - leftWidth : 0;
  const windowSill = balcony ? Math.max(0, Number.isFinite(Number(assembly.windowSill)) ? Number(assembly.windowSill) : 900) : 0;
  const doorHeight = Math.max(300, Number(assembly.doorHeight) || height);
  const leftHeight = Math.max(300, Number(assembly.leftHeight) || height - windowSill);
  const rightHeight = Math.max(300, Number(assembly.rightHeight) || height - windowSill);
  return {
    width, height, balcony, gap, doorWidth, doorHeight, leftWindow, rightWindow, leftWidth, rightWidth, leftHeight, rightHeight,
    doorType: sliding ? 'sliding' : double ? 'double' : 'single',
    doorSide: leftWindow && !rightWindow ? 'end' : 'start',
    windowSill,
  };
}

function assemblyConfig(opening, spec) {
  return { ...opening.assembly, doorWidth: spec.doorWidth, doorHeight: spec.doorHeight,
    leftWindow: spec.leftWindow, rightWindow: spec.rightWindow,
    leftWidth: spec.leftWidth || Number(opening.assembly?.leftWidth) || spec.rightWidth || Number(opening.assembly?.rightWidth) || 600,
    rightWidth: spec.rightWidth || Number(opening.assembly?.rightWidth) || spec.leftWidth || Number(opening.assembly?.leftWidth) || 600,
    leftHeight: spec.leftHeight, rightHeight: spec.rightHeight, windowSill: spec.windowSill,
  };
}

function assemblyUpdate(assembly, spec) {
  const gap = spec.balcony ? 100 : 0;
  return {
    width: assembly.doorWidth + (assembly.leftWindow ? assembly.leftWidth + gap : 0)
      + (assembly.rightWindow ? assembly.rightWidth + gap : 0),
    height: Math.max(assembly.doorHeight, assembly.leftWindow ? assembly.windowSill + assembly.leftHeight : 0,
      assembly.rightWindow ? assembly.windowSill + assembly.rightHeight : 0),
    sill: 0, heightMode: 'custom', assembly,
  };
}

export function setGlazedType(opening, type) {
  const spec = glazedAssemblySpec(opening);
  if (!spec || !GLAZED_OPENING_TYPES[type]) return null;
  const assembly = assemblyConfig(opening, spec);
  const balcony = type.startsWith('balcony-');
  if (!balcony) assembly.windowSill = 0;
  return { type, ...assemblyUpdate(assembly, { balcony }) };
}

// Размеры каждой части независимы. Общий габарит следует за их суммой.
export function setGlazedPartSize(opening, part, dimension, value) {
  const spec = glazedAssemblySpec(opening);
  const number = Number(value);
  if (!spec || !Number.isFinite(number)) return null;
  const assembly = assemblyConfig(opening, spec);
  if (part === 'windows' && dimension === 'sill') assembly.windowSill = Math.max(0, number);
  else if (['door', 'left', 'right'].includes(part) && ['width', 'height'].includes(dimension)) {
    assembly[`${part}${dimension[0].toUpperCase()}${dimension.slice(1)}`] = Math.max(300, number);
  } else return null;
  return assemblyUpdate(assembly, spec);
}

// Рамка всего блока растягивает окна. Размеры двери фиксируются до расчёта,
// в том числе у старых блоков без явно сохранённого doorWidth/doorHeight.
export function resizeGlazedOpening(opening, size) {
  const spec = glazedAssemblySpec(opening);
  if (!spec) return null;
  const assembly = assemblyConfig(opening, spec);
  const count = Number(spec.leftWindow) + Number(spec.rightWindow);
  if (Number.isFinite(Number(size.width))) {
    const width = Math.max(glazedOpeningMinWidth(opening), Number(size.width));
    if (!count) assembly.doorWidth = width;
    else {
      const free = width - spec.doorWidth - count * spec.gap;
      assembly.leftWidth = spec.leftWindow ? spec.rightWindow
        ? Math.max(300, Math.min(free - 300, free * spec.leftWidth / (spec.leftWidth + spec.rightWidth))) : free : assembly.leftWidth;
      if (spec.rightWindow) assembly.rightWidth = free - (spec.leftWindow ? assembly.leftWidth : 0);
    }
  }
  if (Number.isFinite(Number(size.height))) {
    const height = Math.max(300, Number(size.height));
    if (!count) assembly.doorHeight = height;
    else {
      if (spec.leftWindow) assembly.leftHeight = Math.max(300, height - spec.windowSill);
      if (spec.rightWindow) assembly.rightHeight = Math.max(300, height - spec.windowSill);
    }
  }
  return assemblyUpdate(assembly, spec);
}

// Включение секции меняет общий размер блока, сохраняя дверь и второе окно.
// Выключенная секция помнит свою ширину для следующего включения.
export function setGlazedWindow(opening, side, enabled, requestedWidth = null) {
  const spec = glazedAssemblySpec(opening);
  if (!spec || !['left', 'right'].includes(side)) return null;
  const assembly = assemblyConfig(opening, spec);
  assembly[`${side}Window`] = Boolean(enabled);
  if (requestedWidth != null && Number.isFinite(Number(requestedWidth))) assembly[`${side}Width`] = Math.max(300, Number(requestedWidth));
  return assemblyUpdate(assembly, spec);
}

export function glazedOpeningParts(opening) {
  const spec = glazedAssemblySpec(opening);
  if (!spec) return [opening];
  const { width, doorWidth, doorHeight, gap, leftWidth, rightWidth, leftHeight, rightHeight, windowSill } = spec;
  const part = (assemblyPart, kind, type, w, h, center, sill) => {
    const out = { ...opening, assemblyType: opening.type, assemblyPart, kind, type,
      width: w, height: h, sill, heightMode: 'custom', glazed: true };
    delete out.span;
    if (opening.host) out.host = { ...opening.host, t: opening.host.t + center };
    else out.offset = opening.offset + center;
    return out;
  };
  const doorCenter = -width / 2 + leftWidth + (leftWidth ? gap : 0) + doorWidth / 2;
  const door = part('door', 'door', spec.doorType, doorWidth, doorHeight, doorCenter, 0);
  const windows = [];
  if (leftWidth) windows.push(part('window-left', 'window', 'fixed', leftWidth, leftHeight, (leftWidth - width) / 2, windowSill));
  if (rightWidth) windows.push(part('window-right', 'window', 'fixed', rightWidth, rightHeight, (width - rightWidth) / 2, windowSill));
  return [door, ...windows];
}

export function glazedOpeningProjections(openings) {
  return openings.some(isGlazedAssembly) ? openings.flatMap(glazedOpeningParts) : openings;
}
