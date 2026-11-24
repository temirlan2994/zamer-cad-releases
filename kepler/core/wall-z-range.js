import { roomCeiling } from './model.js';

// Высота стены в 3D от пола этажа (мм): base.offset — низ; top.level —
// отметка другого этажа + offset; top.height — от низа; иначе — на всю
// высоту этажа (до перекрытия). Ручная стена — из объекта (level.walls),
// стена комнаты — из wallOverrides[key]. lp — проект на этаже стены.
export function wallZRange(lp, rec, levelHeight) {
  const src = rec?.kind === 'manual'
    ? (lp.walls || []).find((w) => w.id === rec.wallId)
    : lp.wallOverrides?.[rec?.key];
  const z0 = Number(src?.base?.offset) || 0;
  const top = src?.top;
  const levels = lp.levels || [];
  const topLevel = top?.level ? levels.find((l) => l.id === top.level) : null;
  let z1 = levelHeight;
  if (topLevel) {
    const own = levels.find((l) => l.id === lp.activeLevel);
    z1 = (Number(topLevel.elevation) || 0) - (Number(own?.elevation) || 0) + (Number(top.offset) || 0);
  } else if (Number(top?.height) > 0) z1 = z0 + Number(top.height);
  else if (rec?.rooms?.length) {
    const level = levels.find((l) => l.id === lp.activeLevel);
    const heights = rec.rooms
      .map((id) => lp.rooms?.find((room) => room.id === id))
      .filter(Boolean)
      // Связанная комната оставляет стену на полной конструктивной высоте
      // этажа; индивидуальная чистая высота реально опускает её верх.
      .map((room) => room.ceiling ? roomCeiling(room, level) : levelHeight);
    if (heights.length) z1 = Math.max(...heights);
  }
  return { z0, z1: Math.max(z0 + 1, z1) };
}
