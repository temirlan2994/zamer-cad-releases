// Геометрическое ядро v7: булевы операции, измерения, смещения.
// Своя реализация без внешних зависимостей (обоснование —
// docs/architecture-v7.md, раздел «Геометрия»).
export { UNITS_PER_MM, asMulti, clean, difference, intersection, overlay, union, xor } from './clip.js';
export {
  area, bbox, boxesOverlap, buffer, components, erode, interiorPoint, opening, orientRing, orientation, outerArea,
  perimeter, pointInPolygon, rectRing, ringArea, simplify, simplifyRing, transform, transformPoint, translate,
} from './poly.js';
