export const PROJECT_UNITS = Object.freeze({
  mm: Object.freeze({ factor: 1, label: "мм" }),
  cm: Object.freeze({ factor: 10, label: "см" }),
  m: Object.freeze({ factor: 1000, label: "м" }),
});

export const PROJECT_PRINT_SCALES = ["fit", "20", "50", "100", "150", "200"];

export const DEFAULT_MEASUREMENT_SETTINGS = Object.freeze({
  unit: "mm", precision: 0, anglePrecision: 0, areaPrecision: 2, printScale: "fit",
});

function digits(value, maximum, fallback) {
  if (value === "" || value == null) return fallback;
  const number = Number(value);
  return Number.isInteger(number) && number >= 0 && number <= maximum ? number : fallback;
}

export function normalizeMeasurementSettings(value) {
  return {
    unit: Object.hasOwn(PROJECT_UNITS, value?.unit) ? value.unit : "mm",
    precision: digits(value?.precision, 4, 0),
    anglePrecision: digits(value?.anglePrecision, 3, 0),
    areaPrecision: digits(value?.areaPrecision, 4, 2),
    printScale: PROJECT_PRINT_SCALES.includes(value?.printScale) ? value.printScale : "fit",
  };
}

function decimal(value, precision) {
  if (!Number.isFinite(value)) return "—";
  return String(Number(value.toFixed(precision))).replace(".", ",");
}

export function projectUnit(settings) {
  return PROJECT_UNITS[settings?.unit] || PROJECT_UNITS.mm;
}

export function toProjectLength(mm, settings) {
  return Number.isFinite(mm) ? mm / projectUnit(settings).factor : NaN;
}

export function fromProjectLength(value, settings) {
  return Number.isFinite(value) ? value * projectUnit(settings).factor : null;
}

export function formatProjectLength(mm, settings, { suffix = true } = {}) {
  const text = decimal(toProjectLength(mm, settings), digits(settings?.precision, 4, 0));
  return suffix && text !== "—" ? `${text} ${projectUnit(settings).label}` : text;
}

export function formatProjectElevation(mm, settings) {
  const text = formatProjectLength(mm, settings);
  return mm > 0 && !text.startsWith("0 ") ? `+${text}` : text;
}

export function formatProjectAngle(degrees, settings, { suffix = true, wrap = false } = {}) {
  if (!Number.isFinite(degrees)) return "—";
  const precision = digits(settings?.anglePrecision, 3, 0);
  const value = wrap ? ((degrees % 360) + 360) % 360 : degrees;
  const rounded = decimal(value, precision);
  const text = wrap && rounded === "360" ? "0" : rounded;
  return suffix ? `${text}°` : text;
}

export function formatProjectArea(squareMetres, settings) {
  if (!Number.isFinite(squareMetres)) return "—";
  const precision = digits(settings?.areaPrecision, 4, 2);
  if (squareMetres > 0 && Number(squareMetres.toFixed(precision)) === 0) {
    return `<${decimal(10 ** -precision, precision)} м²`;
  }
  return `${decimal(squareMetres, precision)} м²`;
}
