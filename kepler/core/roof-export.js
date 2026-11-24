// Геометрия крыши для обмена: вершины в осях дома, Z от проектного нуля,
// треугольники по индексам с нуля. Берём поверхности модели с их вырезами.
import { linkedRoofFaces, linkedRoofRegions, roofFaces } from './mesh3d.js';

function indexedMesh(faces) {
  const vertices = [];
  const triangles = [];
  const indices = new Map();
  const indexOf = (p) => {
    const key = [p.x, p.y, p.z].join(',');
    if (!indices.has(key)) {
      indices.set(key, vertices.length);
      vertices.push([p.x, p.y, p.z]);
    }
    return indices.get(key);
  };
  for (const { pts, normal } of faces) {
    const a = pts[0];
    for (let i = 1; i < pts.length - 1; i += 1) {
      const b = pts[i]; const c = pts[i + 1];
      const u = [b.x - a.x, b.y - a.y, b.z - a.z];
      const v = [c.x - a.x, c.y - a.y, c.z - a.z];
      const direction = (u[1] * v[2] - u[2] * v[1]) * normal.x
        + (u[2] * v[0] - u[0] * v[2]) * normal.y + (u[0] * v[1] - u[1] * v[0]) * normal.z;
      if (Math.abs(direction) < 0.000001) continue;
      triangles.push((direction > 0 ? [a, b, c] : [a, c, b]).map(indexOf));
    }
  }
  return { vertices, triangles };
}

export function exportRoofBodies(project, { manual = false } = {}) {
  const regions = linkedRoofRegions(project);
  const facesById = new Map();
  for (const face of linkedRoofFaces(project, regions)) {
    if (face.kind === 'roof-drain') continue;
    if (!facesById.has(face.autoRoofId)) facesById.set(face.autoRoofId, []);
    facesById.get(face.autoRoofId).push(face);
  }
  const linked = regions.filter((region) => facesById.has(region.id)).map((region) => ({
    id: region.id, name: region.name, level_id: region.levelId, room_ids: [...region.roomIds],
    type: region.roofType, source: 'linked', thickness: region.thickness, pitch_deg: region.pitchDeg,
    material: region.material,
    ...(region.roofType === 'flat' ? { parapet_height: region.parapetHeight } : {}),
    polygons: region.outline, plan_area_m2: region.planArea / 1_000_000,
    mesh: indexedMesh(facesById.get(region.id)),
  }));
  if (!manual) return linked;
  for (const roof of project.roofs || []) {
    const faces = roofFaces(project, [roof]);
    if (faces.length) linked.push({ id: roof.id, name: roof.name, level_id: roof.levelId, type: 'flat',
      source: 'manual', mesh: indexedMesh(faces) });
  }
  return linked;
}
