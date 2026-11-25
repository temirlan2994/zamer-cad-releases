// Оконно-дверной блок хранится одним проёмом. Для плана, 3D и расчётов
// получаем отдельные створки с тем же id: перенос и Undo относятся ко всему блоку.
export const GLAZED_OPENING_TYPES = {
  'glazed-swing': 'Остекление с распашной дверью',
  'glazed-double': 'Остекление с двумя распашными дверями',
  'glazed-sliding': 'Остекление с раздвижными дверями',
  'balcony-swing': 'Балконный блок · распашная дверь',
  'balcony-sliding': 'Балконный блок · раздвижная дверь',
};
export const isGlazedAssembly = (opening) => Boolean(GLAZED_OPENING_TYPES[opening?.type]) && !opening.assemblyPart;
export const isGlazing = (opening) => opening?.kind === 'window' || Boolean(opening?.glazed);
export const glazedOpeningMinWidth = (opening) => !isGlazedAssembly(opening) ? 300
  : opening.type === 'glazed-swing' ? 600 : 1200;

export function glazedAssemblySpec(opening) {
  if (!isGlazedAssembly(opening)) return null;
  const width = Math.max(300, Number(opening.width) || 2200);
  const height = Math.max(300, Number(opening.height) || 2300);
  const balcony = opening.type.startsWith('balcony-');
  const sliding = opening.type.endsWith('sliding');
  const double = opening.type === 'glazed-double';
  const gap = balcony && width >= 700 ? 100 : 0;
  const maxDoor = balcony && width >= 700 ? width - gap - 300 : width;
  const requested = Number(opening.assembly?.doorWidth) || (sliding || double ? (balcony ? 1800 : width) : 900);
  let doorWidth = Math.min(maxDoor, Math.max(300, requested));
  if (!balcony && width - doorWidth < 300) doorWidth = width;
  return {
    width, height, balcony, gap, doorWidth, doorType: sliding ? 'sliding' : double ? 'double' : 'single',
    doorSide: opening.assembly?.doorSide === 'end' ? 'end' : 'start',
    windowSill: balcony ? Math.min(height - 300, Math.max(0, Number.isFinite(Number(opening.assembly?.windowSill)) ? Number(opening.assembly.windowSill) : 900)) : 0,
  };
}

export function glazedOpeningParts(opening) {
  const spec = glazedAssemblySpec(opening);
  if (!spec) return [opening];
  const { width, height, doorWidth, gap, doorSide, windowSill } = spec;
  const windowWidth = width - doorWidth - gap;
  const sign = doorSide === 'end' ? 1 : -1;
  const part = (assemblyPart, kind, type, w, center, sill) => {
    const out = { ...opening, assemblyType: opening.type, assemblyPart, kind, type,
      width: w, height: height - sill, sill, heightMode: 'custom', glazed: true };
    delete out.span;
    if (opening.host) out.host = { ...opening.host, t: opening.host.t + center };
    else out.offset = opening.offset + center;
    return out;
  };
  const door = part('door', 'door', spec.doorType, doorWidth, sign * (width - doorWidth) / 2, 0);
  const window = windowWidth >= 300
    ? part('window', 'window', 'fixed', windowWidth, -sign * (doorWidth + gap) / 2, windowSill) : null;
  return window ? [door, window] : [door];
}

export function glazedOpeningProjections(openings) {
  return openings.some(isGlazedAssembly) ? openings.flatMap(glazedOpeningParts) : openings;
}
