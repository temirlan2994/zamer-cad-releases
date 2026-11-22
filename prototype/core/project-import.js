import { scaleStoredEntity } from "./entity-transform.js";

export const IMPORT_UNIT_FACTORS = Object.freeze({ mm: 1, cm: 10, m: 1000 });

function scalePoint(point, factor) {
  return Number.isFinite(point?.x) && Number.isFinite(point?.y)
    ? { x: point.x * factor, y: point.y * factor }
    : point;
}

function scaleDraft(draft, factor) {
  if (!draft || !Array.isArray(draft.points)) return draft;
  return { ...draft, points: draft.points.map((point) => scalePoint(point, factor)) };
}

function scaleView(view, factor) {
  if (!view || !Number.isFinite(view.scale)) return view;
  return { ...view, scale: view.scale / factor };
}

function scaleImportEntity(entity, factor) {
  const scaled = scaleStoredEntity(entity, { x: 0, y: 0 }, factor);
  if (!scaled) throw new Error("Не удалось пересчитать геометрию импортируемого объекта");
  if ((scaled.type === "elevation" || (scaled.type === "line" && scaled.layer === "dimensions")) &&
      Number.isFinite(scaled.height)) scaled.height *= factor;
  return scaled;
}

function scaleDrawing(drawing, factor) {
  if (!drawing || !Array.isArray(drawing.entities)) return drawing;
  return {
    ...drawing,
    entities: drawing.entities.map((entity) => scaleImportEntity(entity, factor)),
    view: scaleView(drawing.view, factor),
    draft: scaleDraft(drawing.draft, factor),
  };
}

function scaleSurveyRecord(record, factor) {
  const positions = Object.fromEntries(["point", "end", "runStart", "runEnd"]
    .filter((key) => record[key] != null)
    .map((key) => [key, scalePoint(record[key], factor)]));
  const values = Object.fromEntries(Object.entries(record.values || {})
    .map(([key, value]) => [key, Number.isFinite(value) ? value * factor : value]));
  return { ...record, ...positions, values };
}

function scaleSurvey(survey, factor) {
  if (!survey || !Array.isArray(survey.rooms)) return survey;
  return {
    ...survey,
    tolerance: Number.isFinite(survey.tolerance) ? survey.tolerance * factor : survey.tolerance,
    rooms: survey.rooms.map((room) => ({
      ...room,
      records: Array.isArray(room.records) ? room.records.map((record) => scaleSurveyRecord(record, factor)) : room.records,
      drawing: scaleDrawing(room.drawing, factor),
    })),
  };
}

/** Переводит все линейные данные импортируемого проекта в миллиметры. */
export function scaleImportedProject(project, factor) {
  if (!project || !Number.isFinite(factor) || factor < 0.001 || factor > 1000) {
    throw new Error("Коэффициент импорта должен быть от 0,001 до 1000");
  }
  let copy;
  try {
    copy = JSON.parse(JSON.stringify(project));
  } catch {
    throw new Error("Файл .zamer повреждён");
  }
  const scaled = scaleDrawing(copy, factor);
  if (Array.isArray(copy.reusableBlocks)) {
    scaled.reusableBlocks = copy.reusableBlocks.map((block) => ({
      ...block,
      parts: block.parts.map((part) => scaleImportEntity(part, factor)),
    }));
  }
  scaled.survey = scaleSurvey(copy.survey, factor);
  return scaled;
}
