import { distanceWorld, pointInPolygon, segmentsIntersect } from "./geometry.js";
import { parseLineDecimal } from "./line-input.js";
import { planAnnotationPointsFromEntity } from "./plan-annotations.js";
import { polylineSegments } from "./polyline.js";

export const surveyPresets = {
  general: { label: "Общий", types: ["point", "opening", "control", "niche", "contour"] },
  furniture: { label: "Мебельщик", types: ["niche", "point", "control", "opening", "contour"] },
  construction: { label: "Прораб", types: ["opening", "point", "control", "contour", "niche"] },
  architect: { label: "Архитектор", types: ["contour", "control", "opening", "point", "niche"] },
};

export const surveyKinds = {
  point: { label: "Точка / высота", positions: ["Точка на плане"], fields: [
    ["height", "Отметка Z, мм", -1e7], ["diameter", "Диаметр, мм", 0],
  ] },
  opening: { label: "Проём", positions: ["Начало проёма", "Конец проёма", "Начало участка", "Конец участка"], fields: [
    ["width", "Ширина, мм", 0], ["height", "Высота, мм", 0], ["sill", "Низ проёма от уровня, мм", -1e7],
    ["offset", "Отступ от начала участка, мм", 0], ["remaining", "Остаток участка, мм", 0], ["total", "Длина всего участка, мм", 0],
  ] },
  control: { label: "Контрольный замер", positions: ["Первая точка", "Вторая точка"], fields: [
    ["measured", "Фактический отсчёт, мм", 0, true], ["computed", "Расчёт вручную, мм", 0], ["tolerance", "Порог проверки, мм", 0, true],
  ] },
  niche: { label: "Ниша", positions: ["Метка ниши на плане"], fields: [
    ["level1", "Уровень нижнего замера, мм", -1e7], ["width1", "Ширина внизу, мм", 0],
    ["level2", "Уровень среднего замера, мм", -1e7], ["width2", "Ширина посередине, мм", 0],
    ["level3", "Уровень верхнего замера, мм", -1e7], ["width3", "Ширина наверху, мм", 0],
    ["height1", "Высота слева, мм", 0], ["height2", "Высота по центру, мм", 0], ["height3", "Высота справа, мм", 0],
    ["depth", "Глубина, мм", 0], ["diagonal1", "Первая диагональ, мм", 0], ["diagonal2", "Вторая диагональ, мм", 0],
  ] },
  contour: { label: "Площадь / периметр", positions: [], fields: [] },
};

export const surveyMaxPhotoBytes = 155_000;
export const surveyMaxTotalPhotoBytes = 1_200_000;
export const surveyPointTypes = ["Метка", "Розетка", "Труба", "Слив", "Подоконник", "Порог", "Балка"];
export const surveyOpeningTypes = ["Проём", "Дверь", "Окно", "Арка"];
export const surveyPositionKeys = ["point", "end", "runStart", "runEnd"];
const validId = /^[a-zA-Z0-9_-]{1,100}$/;
const isoDate = /^\d{4}-\d{2}-\d{2}$/;
const photoEncoding = /^data:image\/jpeg;base64,[a-zA-Z0-9+/]+={0,2}$/;

function text(value, max = 100) {
  return typeof value === "string" ? value.trim().slice(0, max) : "";
}

function number(value, min) {
  const parsed = typeof value === "string" ? parseLineDecimal(value) : value;
  return Number.isFinite(parsed) && parsed >= min && parsed <= 1e9 ? parsed : null;
}

function position(value) {
  if (![value?.x, value?.y].every((coordinate) => Number.isFinite(coordinate) && Math.abs(coordinate) <= 1e12)) return null;
  return { x: value.x, y: value.y };
}

export function normalizeSurveyRecord(value, index = 0) {
  if (!value || !Object.hasOwn(surveyKinds, value.kind)) return null;
  const kind = surveyKinds[value.kind];
  const values = {};
  for (const [key, , min] of kind.fields) {
    const parsed = number(value.values?.[key], min);
    if (parsed !== null) values[key] = parsed;
  }
  return {
    id: validId.test(value.id ?? "") ? value.id : `record-${index + 1}`,
    number: Number.isSafeInteger(value.number) && value.number > 0 && value.number < 1e9 ? value.number : null,
    kind: value.kind,
    title: text(value.title) || kind.label,
    pointType: surveyPointTypes.includes(value.pointType) ? value.pointType : surveyPointTypes[0],
    openingType: surveyOpeningTypes.includes(value.openingType) ? value.openingType : surveyOpeningTypes[0],
    point: position(value.point),
    end: position(value.end),
    runStart: position(value.runStart),
    runEnd: position(value.runEnd),
    values,
    note: text(value.note, 600),
    source: text(value.source, 100),
    recordedAt: typeof value.recordedAt === "string" && Number.isFinite(Date.parse(value.recordedAt)) ? value.recordedAt : "",
    decision: ["verified", "accepted"].includes(value.decision) ? value.decision : "",
    reason: text(value.reason, 250),
    outlineId: validId.test(value.outlineId ?? "") ? value.outlineId : "",
    holeIds: [...new Set(Array.isArray(value.holeIds) ? value.holeIds.filter((id) => validId.test(id)) : [])],
    photo: typeof value.photo === "string" && value.photo.length <= surveyMaxPhotoBytes && photoEncoding.test(value.photo) ? value.photo : "",
  };
}

export function surveyRoom(id, name = "Помещение", preset = "general") {
  return { id, name: text(name) || "Помещение", preset: Object.hasOwn(surveyPresets, preset) ? preset : "general", records: [], nextRecordNumber: 1 };
}

export function normalizeSurvey(value) {
  const rooms = [];
  const roomIds = new Set();
  for (const entry of Array.isArray(value?.rooms) ? value.rooms : []) {
    if (!entry || !validId.test(entry.id ?? "") || roomIds.has(entry.id)) continue;
    const room = surveyRoom(entry.id, entry.name, entry.preset);
    const recordIds = new Set();
    const recordNumbers = new Set();
    for (const [index, item] of (Array.isArray(entry.records) ? entry.records : []).entries()) {
      const record = normalizeSurveyRecord(item, index);
      if (!record || recordIds.has(record.id)) continue;
      recordIds.add(record.id);
      if (recordNumbers.has(record.number)) record.number = null;
      if (record.number) {
        recordNumbers.add(record.number);
        room.nextRecordNumber = Math.max(room.nextRecordNumber, record.number + 1);
      }
      room.records.push(record);
    }
    for (const record of room.records) {
      if (!record.number) record.number = room.nextRecordNumber++;
    }
    if (Number.isSafeInteger(entry.nextRecordNumber) && entry.nextRecordNumber < 1e9) {
      room.nextRecordNumber = Math.max(room.nextRecordNumber, entry.nextRecordNumber);
    }
    if (Array.isArray(entry.drawing?.entities)) {
      room.drawing = { entities: entry.drawing.entities, view: entry.drawing.view, draft: entry.drawing.draft };
    }
    rooms.push(room);
    roomIds.add(room.id);
  }
  if (!rooms.length) rooms.push(surveyRoom("room-1"));
  const activeRoomId = roomIds.has(value?.activeRoomId) ? value.activeRoomId : rooms[0].id;
  return {
    version: 1,
    site: text(value?.site, 150),
    visitDate: isoDate.test(value?.visitDate ?? "") ? value.visitDate : "",
    operator: text(value?.operator),
    datum: text(value?.datum) || "Чистый пол",
    tolerance: number(value?.tolerance, 0) ?? 5,
    activeRoomId,
    rooms,
  };
}

function ringEdges(points) {
  return points.map((point, index) => [point, points[(index + 1) % points.length]]);
}

function circularSegmentArea(arc, chord) {
  const angle = arc.sweep;
  if (Math.abs(angle) < 1e-3) {
    // The chord form avoids cancellation of angle − sin(angle) for shallow bows.
    return chord ** 2 * angle / 12 * (1 + angle ** 2 / 30);
  }
  return arc.radius ** 2 * (angle - Math.sin(angle)) / 2;
}

function curvedRingMetrics(entity, segments) {
  const points = planAnnotationPointsFromEntity(entity);
  if (!points) return null;
  const [origin] = entity.points;
  let signedArea = 0;
  let perimeter = 0;
  for (const { p1, p2, arc } of segments) {
    const chord = distanceWorld(p1, p2);
    signedArea += ((p1.x - origin.x) * (p2.y - origin.y) - (p1.y - origin.y) * (p2.x - origin.x)) / 2;
    if (arc) signedArea += circularSegmentArea(arc, chord);
    perimeter += arc ? arc.radius * Math.abs(arc.sweep) : chord;
  }
  const area = Math.abs(signedArea);
  // Sampled edges are used for topology, while the measurements use the original arcs.
  return Number.isFinite(area) && area > 1e-6 && Number.isFinite(perimeter)
    ? { points, edges: ringEdges(points), area, perimeter }
    : null;
}

function ringMetrics(entity) {
  if (entity?.type !== "polyline" || entity.closed !== true || !Array.isArray(entity.points) || entity.points.length < 2) return null;
  if (entity.bulges !== undefined) {
    const segments = polylineSegments(entity);
    if (!segments.length) return null;
    if (segments.some(({ arc }) => arc)) return curvedRingMetrics(entity, segments);
  }
  const points = entity.points;
  if (!points.every((point) => position(point))) return null;
  const edges = ringEdges(points);
  const origin = points[0];
  let perimeter = 0;
  let twiceArea = 0;
  for (const [index, [a, b]] of edges.entries()) {
    const length = distanceWorld(a, b);
    if (length < 1e-6) return null;
    perimeter += length;
    twiceArea += (a.x - origin.x) * (b.y - origin.y) - (a.y - origin.y) * (b.x - origin.x);
    for (let next = index + 2; next < edges.length; next++) {
      if (index === 0 && next === edges.length - 1) continue;
      if (segmentsIntersect(a, b, ...edges[next])) return null;
    }
  }
  return Math.abs(twiceArea) > 1e-6 ? { points, edges, area: Math.abs(twiceArea) / 2, perimeter } : null;
}

function boundariesMeet(first, second) {
  return first.edges.some(([a, b]) => second.edges.some(([c, d]) => segmentsIntersect(a, b, c, d)));
}

export function measureSurveyContour(outerEntity, holeEntities = []) {
  const outer = ringMetrics(outerEntity);
  if (!outer) return { error: "Нужна замкнутая полилиния без самопересечений" };
  const holes = [];
  for (const entity of holeEntities) {
    const hole = ringMetrics(entity);
    if (!hole || !pointInPolygon(hole.points[0], outer.points) || boundariesMeet(outer, hole)) {
      return { error: "Вычет должен целиком лежать внутри внешнего контура" };
    }
    if (holes.some((other) => boundariesMeet(other, hole) || pointInPolygon(hole.points[0], other.points) || pointInPolygon(other.points[0], hole.points))) {
      return { error: "Контуры вычетов пересекаются или вложены друг в друга" };
    }
    holes.push(hole);
  }
  const excluded = holes.reduce((sum, hole) => sum + hole.area, 0);
  return { areaM2: (outer.area - excluded) / 1e6, excludedM2: excluded / 1e6, perimeterM: outer.perimeter / 1000,
    boundaryM: (outer.perimeter + holes.reduce((sum, hole) => sum + hole.perimeter, 0)) / 1000 };
}

export function surveyNumber(value, digits = 1) {
  return Number.isFinite(value) ? String(Number(value.toFixed(digits))).replace(".", ",") : "—";
}

export function surveyMarkers(records) {
  const anchors = new Map();
  function add(point, label, record) {
    if (!point) return;
    const key = `${point.x}|${point.y}`;
    let anchor = anchors.get(key);
    if (!anchor) {
      anchor = { point, tags: [], firstRecord: record };
      anchors.set(key, anchor);
    }
    anchor.tags.push(label);
  }
  records.forEach((record, index) => {
    const number = record.number ?? index + 1;
    add(record.point, `${number}${record.end ? "а" : ""}`, record);
    if (record.end) add(record.end, `${number}б`, record);
  });
  return [...anchors.values()].map(({ point, tags, firstRecord }) => ({ point, firstRecord,
    label: `№${tags.slice(0, 4).join("/")}${tags.length > 4 ? `+${tags.length - 4}` : ""}`,
    count: tags.length,
  }));
}

function foundRecordCoordinates(record) {
  return record.point && record.end ? distanceWorld(record.point, record.end) : null;
}

function openingFromPlan({ point, end, runStart, runEnd }) {
  if (!point || !end || !runStart || !runEnd) return null;
  const total = distanceWorld(runStart, runEnd);
  if (total < 1e-6) return { error: "Укажите разные начало и конец участка" };
  const unitX = (runEnd.x - runStart.x) / total;
  const unitY = (runEnd.y - runStart.y) / total;
  const project = ({ x, y }) => ({
    along: (x - runStart.x) * unitX + (y - runStart.y) * unitY,
    across: Math.abs((x - runStart.x) * unitY - (y - runStart.y) * unitX),
  });
  const [left, right] = [project(point), project(end)].sort((a, b) => a.along - b.along);
  if (left.along < -1e-6 || right.along > total + 1e-6 || Math.max(left.across, right.across) > 5) {
    return { error: "Точки проёма должны лежать на указанном участке" };
  }
  const offset = Math.max(0, left.along);
  return { offset, width: right.along - left.along, remaining: Math.max(0, total - right.along), total };
}

export function describeSurveyRecord(record, entities = [], datum = "Чистый пол") {
  const values = record.values;
  const mm = (value) => `${surveyNumber(value)} мм`;
  const show = (key, name) => Number.isFinite(values[key]) ? `${name} ${mm(values[key])}` : "";
  let parts;
  let issue = "";
  if (record.kind === "point") {
    parts = [show("height", "Z"), show("diameter", "Ø")];
    if (Number.isFinite(values.height)) parts.push(`уровень «${datum}»`);
  } else if (record.kind === "opening") {
    const plan = openingFromPlan(record);
    const wide = values.width ?? plan?.width ?? foundRecordCoordinates(record);
    const offset = values.offset ?? plan?.offset;
    const dims = [offset, wide, values.remaining ?? plan?.remaining];
    const total = values.total ?? plan?.total;
    parts = [record.openingType === "Проём" ? "" : record.openingType,
      Number.isFinite(wide) ? `ширина ${mm(wide)}` : "", show("height", "высота"), show("sill", `низ от уровня «${datum}»`)];
    if (dims.every(Number.isFinite)) {
      const sum = dims.reduce((left, right) => left + right, 0);
      parts.push(`${dims.map((item) => surveyNumber(item)).join(" + ")} = ${mm(sum)}`);
      if (Number.isFinite(total) && Math.abs(sum - total) > 0.05) issue = `Расхождение цепочки ${mm(Math.abs(sum - total))}`;
    } else if (Number.isFinite(total) && Number.isFinite(offset) && Number.isFinite(wide)) {
      const rest = total - offset - wide;
      if (rest >= 0) parts.push(`отступ ${mm(offset)} · остаток ${mm(rest)} по расчёту`);
      else issue = "Отступ и ширина больше длины участка";
    } else {
      parts.push(show("offset", "отступ"), show("remaining", "остаток"));
    }
    if (plan?.error) issue = [issue, plan.error].filter(Boolean).join(" · ");
  } else if (record.kind === "control") {
    const computed = values.computed ?? foundRecordCoordinates(record);
    const gap = Number.isFinite(computed) && Number.isFinite(values.measured) ? Math.abs(values.measured - computed) : null;
    parts = [show("measured", "факт"), Number.isFinite(computed) ? `расчёт ${mm(computed)}` : "", Number.isFinite(gap) ? `разница ${mm(gap)}` : "", show("tolerance", "порог")];
    if (gap !== null && gap > (values.tolerance ?? 5) + 1e-6) issue = "Повторить замер";
    if (issue && record.decision === "verified") issue = "Перепроверено";
    if (issue && record.decision === "accepted") issue = "Оставлено как замерено";
  } else if (record.kind === "niche") {
    const widths = [1, 2, 3].flatMap((index) => Number.isFinite(values[`width${index}`]) ? [{ value: values[`width${index}`], level: values[`level${index}`] }] : []);
    const heights = ["слева", "по центру", "справа"].flatMap((side, index) => Number.isFinite(values[`height${index + 1}`]) ? [{ side, value: values[`height${index + 1}`] }] : []);
    const narrowest = widths.reduce((best, next) => !best || next.value < best.value ? next : best, null);
    const lowest = heights.reduce((best, next) => !best || next.value < best.value ? next : best, null);
    parts = [narrowest ? `мин. ширина ${mm(narrowest.value)}${Number.isFinite(narrowest.level) ? ` на уровне ${mm(narrowest.level)}` : ""}` : "",
      lowest ? `мин. высота ${mm(lowest.value)} ${lowest.side}` : "",
      widths.length ? `ширины ${widths.map(({ value }) => surveyNumber(value)).join(" / ")} мм` : "",
      heights.length ? `высоты ${heights.map(({ value }) => surveyNumber(value)).join(" / ")} мм` : "", show("depth", "глубина"),
      show("diagonal1", "диагональ 1"), show("diagonal2", "диагональ 2")];
  } else {
    const byId = new Map(entities.map((entity) => [entity.id, entity]));
    const shape = measureSurveyContour(byId.get(record.outlineId), record.holeIds.map((id) => byId.get(id)));
    parts = shape.error ? [] : [`площадь ${surveyNumber(shape.areaM2, 3)} м²`, `периметр ${surveyNumber(shape.perimeterM, 3)} м`];
    if (shape.excludedM2 > 0) parts.push(`вычет ${surveyNumber(shape.excludedM2, 3)} м²`, `все границы ${surveyNumber(shape.boundaryM, 3)} м`);
    issue = shape.error || "";
  }
  const summary = [...parts.filter(Boolean), issue].filter(Boolean).join(" · ");
  return { summary, detail: [summary, record.source, record.reason, record.note].filter(Boolean).join(". "), issue };
}
