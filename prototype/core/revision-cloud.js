import { isLinePoint } from "./line-edits.js";
import { planAnnotationGeometry } from "./plan-annotations.js";
import { createPolyline } from "./polyline.js";

export const MAX_REVISION_CLOUD_CORNERS = 96;
const MAX_SCALLOPS = 512;

export function revisionCloudRectangle(start, end) {
  return [start, { x: end.x, y: start.y }, end, { x: start.x, y: end.y }];
}

export function createRevisionCloud(id, corners, arcLength, layer = "text") {
  if (!Array.isArray(corners) || corners.length < 3 || corners.length > MAX_REVISION_CLOUD_CORNERS ||
      !corners.every(isLinePoint) || !planAnnotationGeometry({ type: "area", points: corners })) return null;
  const first = corners[0];
  const edges = corners.map((start, index) => {
    const end = corners[(index + 1) % corners.length];
    return { start, dx: end.x - start.x, dy: end.y - start.y };
  });
  const perimeter = edges.reduce((total, { dx, dy }) => total + Math.hypot(dx, dy), 0);
  const winding = Math.sign(edges.reduce((area, { start, dx, dy }) =>
    area + (start.x - first.x) * dy - (start.y - first.y) * dx, 0));
  const spacing = Math.max(Number.isFinite(arcLength) ? arcLength : 300, 1, perimeter / (MAX_SCALLOPS - corners.length));
  const points = edges.flatMap(({ start, dx, dy }) => {
    const steps = Math.ceil(Math.hypot(dx, dy) / spacing);
    return Array.from({ length: steps }, (_, step) => ({ x: start.x + dx * step / steps, y: start.y + dy * step / steps }));
  });
  const entity = createPolyline(id, points, { closed: true, layer, bulges: points.map(() => 0.45 * winding) });
  return entity ? { ...entity, revisionCloud: true } : null;
}
