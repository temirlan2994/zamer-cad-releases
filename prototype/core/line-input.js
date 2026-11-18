import { degToRad, radToDeg } from "./geometry.js";

const DECIMAL = /^[+-]?(?:\d+(?:\.\d*)?|\.\d+)$/;

function finitePoint(point) {
  return Number.isFinite(point?.x) && Number.isFinite(point?.y);
}

export function parseLineDecimal(text) {
  if (typeof text !== "string") return null;
  const decimal = text.trim().replace(",", ".");
  if (!DECIMAL.test(decimal)) return null;
  const value = Number(decimal);
  return Number.isFinite(value) ? value : null;
}

function resultPoint(x, y) {
  if (!Number.isFinite(x) || !Number.isFinite(y)) return null;
  return { x: x || 0, y: y || 0 };
}

function directionAt(degrees) {
  switch (degrees % 360) {
    case 0: return { x: 1, y: 0 };
    case 90: case -270: return { x: 0, y: 1 };
    case 180: case -180: return { x: -1, y: 0 };
    case 270: case -90: return { x: 0, y: -1 };
    default: {
      const radians = degToRad(degrees % 360);
      return { x: Math.cos(radians), y: Math.sin(radians) };
    }
  }
}

export function linePolarPoint(base, length, angle) {
  if (!finitePoint(base) || !Number.isFinite(length) || length < 0 || !Number.isFinite(angle)) return null;
  const unit = directionAt(-angle);
  return resultPoint(base.x + length * unit.x, base.y + length * unit.y);
}

export function linePointWithConstraint(base, cursor, { length, angle }) {
  const dx = cursor.x - base.x;
  const dy = cursor.y - base.y;
  if (angle !== undefined) {
    const direction = directionAt(-angle);
    const projection = Math.max(0, dx * direction.x + dy * direction.y);
    return linePolarPoint(base, projection, angle);
  }
  if (dx === 0 && dy === 0) return base;
  return linePolarPoint(base, length, -radToDeg(Math.atan2(dy, dx)));
}

// Project the cursor onto the nearest enabled direction from the base point.
export function constrainLinePoint(base, point, step = 90) {
  if (!finitePoint(base) || !finitePoint(point) || !(step > 0 && step <= 360)) return point;
  const dx = point.x - base.x;
  const dy = point.y - base.y;
  const angle = Math.round(radToDeg(Math.atan2(dy, dx)) / step) * step;
  const unit = directionAt(angle);
  const length = Math.max(0, dx * unit.x + dy * unit.y);
  return resultPoint(base.x + length * unit.x, base.y + length * unit.y) ?? point;
}
