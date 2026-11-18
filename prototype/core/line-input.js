import { degToRad, radToDeg } from "./geometry.js";

const DECIMAL = /^[+-]?(?:\d+(?:\.\d*)?|\.\d+)$/;

function finitePoint(point) {
  return Number.isFinite(point?.x) && Number.isFinite(point?.y);
}

function readNumber(text, commaDecimal = false) {
  const value = commaDecimal ? text.trim().replace(",", ".") : text.trim();
  return DECIMAL.test(value) ? Number(value) : NaN;
}

export function parseLineDecimal(text) {
  if (typeof text !== "string") return null;
  const value = readNumber(text, true);
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

// CAD input is Y-up with counterclockwise angles. The drawing uses Y-down.
// In pairs, a semicolon allows commas inside decimal numbers: 10,5;20,25.
export function parseLinePoint(input, { base = null, direction = null } = {}) {
  if (typeof input !== "string") return null;
  const text = input.trim();
  const relative = text.startsWith("@");
  const explicit = relative || text.startsWith("#");
  const expression = explicit ? text.slice(1) : text;
  if (relative && !finitePoint(base)) return null;

  if (expression.includes("<")) {
    const fields = expression.split("<");
    if (fields.length !== 2) return null;
    const length = readNumber(fields[0], true);
    const angle = readNumber(fields[1], true);
    if (relative && length === 0) return null;
    return linePolarPoint(relative ? base : { x: 0, y: 0 }, length, angle);
  }

  const commaDecimal = expression.includes(";");
  const fields = expression.split(commaDecimal ? ";" : ",");
  if (fields.length === 2) {
    const x = readNumber(fields[0], commaDecimal);
    const y = readNumber(fields[1], commaDecimal);
    return relative ? resultPoint(base.x + x, base.y - y) : resultPoint(x, -y);
  }

  if (explicit || fields.length !== 1 || !finitePoint(base) || !finitePoint(direction)) return null;
  const length = readNumber(expression);
  const scale = Math.max(Math.abs(direction.x), Math.abs(direction.y));
  if (!(length > 0) || !scale) return null;
  const dx = direction.x / scale;
  const dy = direction.y / scale;
  const magnitude = Math.hypot(dx, dy);
  return resultPoint(base.x + length * (dx / magnitude), base.y + length * (dy / magnitude));
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
