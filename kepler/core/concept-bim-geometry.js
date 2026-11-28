import { buildHouseMesh } from './mesh3d.js';

// Дополнительная геометрия для тех сущностей, которые JSON-импортёр пока
// не создаёт нативными семействами. Категория и исходный ID сохраняются;
// DirectShape в отчёте явно отличается от нативного BIM-элемента.
export function conceptBimGeometry(project) {
  const supported = new Set(['slab','foundation','plinth','roof','roof-soffit','fascia','parapet','roof-drain','stairs','entrance','railing','furniture','mass','facade']);
  const mesh = buildHouseMesh(project, { roof: true, site: false, landscape: false, furniture: true, masses: true });
  const groups = new Map();
  for (const face of mesh) {
    if (!supported.has(face.kind) || face.pts.length < 3) continue;
    const category = face.kind === 'slab' ? 'floor' : ['roof','roof-soffit','fascia','parapet','roof-drain'].includes(face.kind) ? 'roof'
      : ['stairs','entrance'].includes(face.kind) ? 'stairs' : face.kind === 'furniture' ? 'furniture' : 'generic';
    const id = `${category}/${face.level || 'building'}/${face.itemId || face.massId || face.roofId || face.entranceId || face.openingId || face.slabRole || face.kind}`;
    if (!groups.has(id)) groups.set(id, { id, category, level_id: face.level || null, kind: face.kind, color: face.color, faces: [] });
    groups.get(id).faces.push(face.pts.map((p) => ({ x: Math.round(p.x*1000)/1000, y: Math.round(p.y*1000)/1000, z: Math.round(p.z*1000)/1000 })));
  }
  return [...groups.values()];
}
