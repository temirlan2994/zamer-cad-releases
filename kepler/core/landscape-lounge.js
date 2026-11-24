// The entrance is on local +Y. All heights are measured from the lounge floor.
export function loungeParts(o, drop = 600) {
  const radius = o.w / 2;
  const rotation = ((o.rotation || 0) * Math.PI) / 180;
  const dir = Math.PI / 2 + rotation;
  const entrance = Math.asin(Math.min(0.55, 650 / radius));
  const height = Math.max(300, o.height ?? 800);
  const seat = Math.min(430, height * 0.65);
  const parts = [];
  const point = (r, a) => ({ x: o.x + r * Math.cos(a), y: o.y + r * Math.sin(a) });
  const sector = (inner, outer, a, b) => [point(inner, a), point(outer, a), point(outer, b), point(inner, b)];
  const arc = (inner, outer, gap, bottom, top, material, segments) => {
    const start = dir + gap;
    const sweep = 2 * Math.PI - 2 * gap;
    for (let i = 0; i < segments; i += 1) {
      const a = start + sweep * i / segments;
      const b = start + sweep * (i + 1) / segments;
      const seam = material === 'cushion' ? 0.003 : 0;
      parts.push({ poly: sector(inner, outer, a + seam, b - seam), bottom, top, material });
    }
  };
  arc(radius - 140, radius, entrance, 0, Math.max(drop + 60, height), 'wall', 26);
  arc(radius - 850, radius - 140, 0.95, 0, seat - 85, 'base', 16);
  arc(radius - 850, radius - 245, 0.95, seat - 85, seat, 'cushion', 16);
  arc(radius - 280, radius - 140, 0.95, seat, height, 'cushion', 16);
  const count = Math.max(0, Math.ceil(drop / 150));
  const tread = Math.min(310, radius * 0.75 / Math.max(1, count));
  for (let i = 0; i < count; i += 1) {
    const outer = radius - (count - 1 - i) * tread;
    parts.push({ poly: sector(outer - tread, outer, dir - entrance, dir + entrance), bottom: 0,
      top: drop * (i + 1) / count, material: 'step' });
  }
  return parts;
}

export const LOUNGE_COLORS = { wall: '#807b70', base: '#826a54', cushion: '#d7c9ad', step: '#b1a798' };
