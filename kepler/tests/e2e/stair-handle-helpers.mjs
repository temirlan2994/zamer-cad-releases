// Центры шести граней по габаритам настоящей 3D-геометрии выбранной ступени.
// Фикстуры — плоское основание, повёрнутые дом и лестница.
export const stairFaceCenters = (page) => page.evaluate(async () => {
  const { stairShapeSelection } = await import('./ui/stair-shape.js');
  const { buildHouseMesh } = await import('./core/mesh3d.js');
  const k = window.__kepler; const { t, part } = stairShapeSelection();
  const vertices = buildHouseMesh(k.state.project, { site: true, landscape: true })
    .filter((f) => f.stairPart === part.key && (f.openingId === t.object.id || f.landscapeId === t.object.id)).flatMap((f) => f.pts);
  const local = vertices.map((p) => ({
    x: (p.x - part.origin.x) * part.xAxis.x + (p.y - part.origin.y) * part.xAxis.y,
    y: (p.x - part.origin.x) * part.yAxis.x + (p.y - part.origin.y) * part.yAxis.y,
    z: p.z,
  }));
  const lo = {}; const hi = {};
  for (const axis of ['x', 'y', 'z']) { lo[axis] = Math.min(...local.map((p) => p[axis])); hi[axis] = Math.max(...local.map((p) => p[axis])); }
  const center = Object.fromEntries(['x', 'y', 'z'].map((axis) => [axis, (lo[axis] + hi[axis]) / 2]));
  const world = {}; const screen = {};
  for (const [edge, axis, value] of [['left', 'x', lo.x], ['right', 'x', hi.x], ['back', 'y', lo.y], ['front', 'y', hi.y], ['upper', 'z', hi.z], ['lower', 'z', lo.z]]) {
    const p = { ...center, [axis]: value };
    world[edge] = { x: part.origin.x + part.xAxis.x * p.x + part.yAxis.x * p.y,
      y: part.origin.y + part.xAxis.y * p.x + part.yAxis.y * p.y, z: p.z };
    screen[edge] = k.screen3d(world[edge]);
  }
  return { world, screen };
});

export const stairBodyPoint = (page, outdoor, part = 'step-3') => page.evaluate(async ({ outdoor, part }) => {
  const { buildHouseMesh } = await import('./core/mesh3d.js');
  const { objectGizmoPartAt } = await import('./ui/object-gizmo3d.js');
  const k = window.__kepler; const mobile = navigator.maxTouchPoints > 0;
  const faces = buildHouseMesh(k.state.project, { site: true, landscape: true }).filter((f) =>
    f.stairPart === part && f.normal.z > .9 && (outdoor ? f.landscapeId === 'outside-stair' : f.openingId === 'entry-door'));
  for (const face of faces) for (const weights of [[1 / 3, 1 / 3, 1 / 3], [.6, .2, .2], [.2, .6, .2], [.2, .2, .6]]) {
    const p = face.pts.slice(0, 3).reduce((a, v, i) => ({ x: a.x + v.x * weights[i], y: a.y + v.y * weights[i], z: a.z + v.z * weights[i] }), { x: 0, y: 0, z: 0 });
    const s = k.screen3d(p); const hit = k.pick3d(s.x, s.y);
    if (document.elementFromPoint(s.x, s.y)?.id !== 'canvas3d' || hit?.type !== (outdoor ? 'landscape' : 'entrance') ||
      (hit.part !== part && !(part === 'landing' && !hit.part))) continue;
    if (!objectGizmoPartAt({ clientX: s.x, clientY: s.y, pointerType: mobile ? 'touch' : 'mouse' })) return s;
  }
  return null;
}, { outdoor, part });
