import { ANNOTATION_LINE_SPACING, annotationTextLines, annotationTextWidth, leaderAppearance, leaderElbowPoint, leaderFrameSize, leaderPlanPath, leaderTextHeight } from "./annotation-text.js";
import { arcGeometry, entityBounds, normalizeAnglePositive, transformBlockPoint } from "./geometry.js";
import { entitySize } from "./blocks.js";
import { angularDimensionGeometry, dimensionGeometry } from "./dimensions.js";
import { additionalDimensionArtwork, additionalDimensionKinds, angularDimensionArtwork, linearDimensionArtwork, radialDimensionArtwork } from "./dimension-artwork.js";
import { planAnnotationAnchors, planAnnotationGeometry, planZoneLabelHeight, planZoneLabelLines } from "./plan-annotations.js";
import { polylineBounds } from "./polyline.js";
import { formatProjectAngle, formatProjectLength, normalizeMeasurementSettings, projectUnit } from "./project-settings.js";

const PT_PER_MM = 72 / 25.4;
const A4 = { width: 210 * PT_PER_MM, height: 297 * PT_PER_MM };
const MARGIN = 30;
const PLOT_TOP = 106;
const PLOT_BOTTOM = 70;
const PLOT_INSET = 34;
const IMAGE_SCALE = 3;
const JPEG_QUALITY = 0.88;
const ink = "#1b2936";
const muted = "#4c5968";
const border = "#8c9aaa";
const fontFamily = 'Arial, "Noto Sans", sans-serif';
const mm = new Intl.NumberFormat("ru-RU", { maximumFractionDigits: 1 });
const sheetDate = new Intl.DateTimeFormat("ru-RU", { dateStyle: "short", timeStyle: "short" });
const encoder = new TextEncoder();

function boundsOf(points) {
  const pointsInDrawing = points.filter(({ x, y }) => Number.isFinite(x) && Number.isFinite(y));
  if (!pointsInDrawing.length) return null;
  return {
    minX: Math.min(...pointsInDrawing.map(({ x }) => x)),
    minY: Math.min(...pointsInDrawing.map(({ y }) => y)),
    maxX: Math.max(...pointsInDrawing.map(({ x }) => x)),
    maxY: Math.max(...pointsInDrawing.map(({ y }) => y)),
  };
}

function arcBounds(entity) {
  const arc = arcGeometry(entity.start, entity.through, entity.end);
  if (!arc) return boundsOf([entity.start, entity.through, entity.end]);
  const { center, radius, startAngle, endAngle, counterClockwise } = arc;
  const sign = counterClockwise ? 1 : -1;
  const sweep = normalizeAnglePositive((endAngle - startAngle) * sign);
  return boundsOf([entity.start, entity.through, entity.end, ...arcExtrema(center, radius, startAngle, sweep * sign)]);
}

function arcExtrema(center, radius, startAngle, sweep) {
  if (Math.abs(sweep) <= Number.EPSILON) return [];
  return [0, Math.PI / 2, Math.PI, Math.PI * 1.5]
    .filter((angle) => normalizeAnglePositive((angle - startAngle) * Math.sign(sweep)) <= Math.abs(sweep) + 1e-9)
    .map((angle) => ({ x: center.x + Math.cos(angle) * radius, y: center.y + Math.sin(angle) * radius }));
}

function textCorners(origin, left, top, right, bottom, rotation = 0) {
  const cos = Math.cos(rotation);
  const sin = Math.sin(rotation);
  return [[left, top], [right, top], [right, bottom], [left, bottom]].map(([x, y]) => ({
    x: origin.x + x * cos - y * sin, y: origin.y + x * sin + y * cos,
  }));
}

function centeredTextCorners(origin, width, height, rotation) {
  return textCorners(origin, -width / 2, -height / 2, width / 2, height / 2, rotation);
}

function dimensionPlotBounds(entity, textWidth, scaleFactor, measurementSettings) {
  if (entity.dimensionKind === "angular") {
    const geometry = angularDimensionGeometry(entity);
    const art = angularDimensionArtwork(geometry, scaleFactor, entity.arcRadius);
    if (!art) return null;
    const { vertex, startAngle, sweep, measurement } = geometry;
    const text = formatProjectAngle(measurement, measurementSettings);
    const width = textWidth([text], art.textHeight, 700) + art.textHeight * 0.25;
    return boundsOf([vertex, art.firstLegEnd, art.secondLegEnd, ...arcExtrema(vertex, art.radius, startAngle, sweep),
      ...centeredTextCorners(art.label, width, art.textHeight * 1.25)]);
  }
  if (additionalDimensionKinds.includes(entity.dimensionKind)) {
    const art = additionalDimensionArtwork(entity, scaleFactor);
    if (!art) return null;
    const text = art.prefix + formatProjectLength(art.measurement, measurementSettings);
    const width = textWidth([text], art.textHeight, 700) + art.textHeight * 0.5;
    const extrema = art.arc ? arcExtrema(art.arc.center, art.arc.radius, art.arc.startAngle, art.arc.sweep) : [];
    return boundsOf([...art.paths.flat(), ...extrema, ...centeredTextCorners(art.label, width, art.textHeight * 1.28)]);
  }
  if (entity.dimensionKind === "radius" || entity.dimensionKind === "diameter") {
    const art = radialDimensionArtwork(entity, scaleFactor);
    if (!art) return null;
    const text = `${art.diameter ? "⌀" : "R"} ${formatProjectLength(art.measurement, measurementSettings)}`;
    const width = textWidth([text], art.textHeight, 700) + art.textHeight * 0.5;
    return boundsOf([art.start, art.end, ...centeredTextCorners(art.label, width, art.textHeight * 1.28)]);
  }
  const geometry = dimensionGeometry(entity);
  const art = linearDimensionArtwork(geometry, scaleFactor);
  if (!art) return null;
  const width = textWidth([formatProjectLength(geometry.measurement, measurementSettings)], art.textHeight, 700) + art.textHeight * 0.25;
  return boundsOf([art.start, art.end, art.lineStart, art.lineEnd, art.extensionStart, art.extensionEnd,
    ...centeredTextCorners(art.label, width, art.textHeight * 1.25, art.rotation)]);
}

function entityPlotBounds(entity, textWidth, scaleFactor, zoneAnchors, measurementSettings) {
  if (entity.type === "polyline") return polylineBounds(entity);
  if (entity.type === "area" || entity.type === "elevation") {
    const geometry = planAnnotationGeometry(entity);
    if (!geometry) return null;
    const { minX, minY, maxX, maxY } = geometry.bounds;
    const label = zoneAnchors.get(entity.id) || geometry.anchor;
    const lines = planZoneLabelLines(entity, geometry, measurementSettings);
    const size = planZoneLabelHeight(scaleFactor);
    const width = textWidth(lines, size, 700) + size * 1.2;
    const height = size * (1.7 + (lines.length - 1) * ANNOTATION_LINE_SPACING);
    return boundsOf([{ x: minX, y: minY }, { x: maxX, y: maxY }, ...centeredTextCorners(label, width, height)]);
  }
  if (entity.type === "arc") return arcBounds(entity);
  if (entity.type === "line" && entity.dimensionKind === "leader") {
    const height = leaderTextHeight(entity);
    const lines = annotationTextLines(entity.text);
    const appearance = leaderAppearance(entity);
    const frame = leaderFrameSize(height, textWidth(lines, height, 600), lines.length, appearance.frame);
    const center = { x: entity.x2, y: entity.y2 };
    const rect = { x: center.x - frame.width / 2, y: center.y - frame.height / 2, ...frame };
    const path = leaderPlanPath({ x: entity.x1, y: entity.y1 }, rect, appearance.line, height * 1.1, leaderElbowPoint(entity));
    return boundsOf([...path, ...centeredTextCorners(center, frame.width, frame.height)]);
  }
  if (entity.type === "line" && entity.layer === "dimensions") return dimensionPlotBounds(entity, textWidth, scaleFactor, measurementSettings);
  if (entity.type === "block") {
    const { width, height } = entitySize(entity);
    const block = { ...entity, rotation: entity.rotation || 0 };
    return boundsOf([
      transformBlockPoint(block, -width / 2, -height / 2),
      transformBlockPoint(block, width / 2, -height / 2),
      transformBlockPoint(block, width / 2, height / 2),
      transformBlockPoint(block, -width / 2, height / 2),
    ]);
  }
  if (entity.type === "text") {
    const height = Math.abs(entity.height || 260);
    const lines = annotationTextLines(entity.text);
    const width = textWidth(lines, height, 400);
    const minY = -height;
    const maxY = ((lines.length - 1) * ANNOTATION_LINE_SPACING + 0.22) * height;
    const rotation = (entity.rotation || 0) * Math.PI / 180;
    return boundsOf(textCorners(entity, 0, minY, width, maxY, rotation));
  }
  const bounds = entityBounds(entity);
  if (entity.type !== "wall") return bounds;
  const halfWidth = (entity.width || 180) / 2;
  return {
    minX: bounds.minX - halfWidth, maxX: bounds.maxX + halfWidth,
    minY: bounds.minY - halfWidth, maxY: bounds.maxY + halfWidth,
  };
}

export function pdfPlotBounds(entities, textWidth = annotationTextWidth, scaleFactor, measurementSettings) {
  let combined = null;
  const zoneAnchors = planAnnotationAnchors(entities);
  for (const entity of entities) {
    const bounds = entityPlotBounds(entity, textWidth, scaleFactor, zoneAnchors, measurementSettings);
    if (!bounds || !Object.values(bounds).every(Number.isFinite)) continue;
    combined = combined ? {
      minX: Math.min(combined.minX, bounds.minX),
      minY: Math.min(combined.minY, bounds.minY),
      maxX: Math.max(combined.maxX, bounds.maxX),
      maxY: Math.max(combined.maxY, bounds.maxY),
    } : bounds;
  }
  return combined;
}

function pagePlotArea(page) {
  return {
    x: MARGIN, y: PLOT_TOP,
    width: page.width - MARGIN * 2,
    height: page.height - PLOT_TOP - PLOT_BOTTOM,
  };
}

function fitScale(area, width, height) {
  return Math.min((area.width - PLOT_INSET * 2) / width, (area.height - PLOT_INSET * 2) / height);
}

export function pdfPlotLayout(bounds, scaleMode = "fit") {
  const plotWidth = Math.max(10, (bounds?.maxX ?? 1000) - (bounds?.minX ?? 0));
  const plotHeight = Math.max(10, (bounds?.maxY ?? 1000) - (bounds?.minY ?? 0));
  const portrait = pagePlotArea(A4);
  const landscapePage = { width: A4.height, height: A4.width };
  const landscape = pagePlotArea(landscapePage);
  const portraitScale = fitScale(portrait, plotWidth, plotHeight);
  const landscapeScale = fitScale(landscape, plotWidth, plotHeight);
  const useLandscape = landscapeScale > portraitScale * 1.02;
  const page = useLandscape ? landscapePage : A4;
  const area = useLandscape ? landscape : portrait;
  const maximumScale = useLandscape ? landscapeScale : portraitScale;
  const requested = scaleMode === "fit" ? null : Number(scaleMode);
  if (requested !== null && !(requested > 0 && Number.isFinite(requested))) {
    throw new Error("Укажите масштаб листа");
  }
  const scale = requested === null ? Math.min(maximumScale, PT_PER_MM) : PT_PER_MM / requested;
  if (scale > maximumScale * (1 + 1e-9)) {
    throw new Error(`Чертёж не помещается на A4 в масштабе 1:${requested}. Выберите меньший масштаб или «Вписать в лист».`);
  }
  const middleX = ((bounds?.minX ?? 0) + (bounds?.maxX ?? 1000)) / 2;
  const middleY = ((bounds?.minY ?? 0) + (bounds?.maxY ?? 1000)) / 2;
  return {
    page, area, ratio: PT_PER_MM / scale, fitted: requested === null,
    view: { scale, panX: area.x + area.width / 2 - middleX * scale, panY: area.y + area.height / 2 - middleY * scale },
  };
}

export function pdfScaleBar(scale) {
  const maximum = 102 / scale;
  const order = 10 ** Math.floor(Math.log10(maximum));
  const lengthMm = ([5, 2, 1].find((n) => n * order <= maximum) || 1) * order;
  return { lengthMm, lengthPt: lengthMm * scale };
}

function newPage(page) {
  const canvas = document.createElement("canvas");
  canvas.width = Math.round(page.width * IMAGE_SCALE);
  canvas.height = Math.round(page.height * IMAGE_SCALE);
  const ctx = canvas.getContext("2d", { alpha: false });
  ctx.setTransform(canvas.width / page.width, 0, 0, canvas.height / page.height, 0, 0);
  ctx.fillStyle = "#ffffff";
  ctx.fillRect(0, 0, page.width, page.height);
  return { ctx, canvas };
}

function pageHeader(ctx, page, title, subtitle = "") {
  ctx.fillStyle = ink;
  ctx.font = `bold 19px ${fontFamily}`;
  ctx.fillText(title, MARGIN, 43, page.width - MARGIN * 2);
  ctx.fillStyle = muted;
  ctx.font = `11px ${fontFamily}`;
  ctx.fillText(subtitle, MARGIN, 63, page.width - MARGIN * 2);
}

function pageFooter(ctx, page, index, total, revision, generatedAt, unit) {
  ctx.strokeStyle = border;
  ctx.lineWidth = 0.55;
  ctx.beginPath();
  ctx.moveTo(MARGIN, page.height - 44);
  ctx.lineTo(page.width - MARGIN, page.height - 44);
  ctx.stroke();
  ctx.fillStyle = muted;
  ctx.font = `9px ${fontFamily}`;
  ctx.fillText(`Замер CAD · редакция ${revision} · ${generatedAt} · ${unit}`, MARGIN, page.height - 29, (page.width - MARGIN * 2) * .75);
  ctx.textAlign = "right";
  ctx.fillText(`Лист ${index} из ${total}`, page.width - MARGIN, page.height - 29);
  ctx.textAlign = "left";
}

function drawScaleBar(ctx, x, y, scale, measurementSettings) {
  const { lengthMm, lengthPt } = pdfScaleBar(scale);
  ctx.fillStyle = ink;
  ctx.fillRect(x, y, lengthPt / 2, 4);
  ctx.strokeStyle = ink;
  ctx.lineWidth = 0.7;
  ctx.strokeRect(x, y, lengthPt, 4);
  ctx.font = `9px ${fontFamily}`;
  ctx.textBaseline = "bottom";
  ctx.fillText("0", x, y - 2);
  ctx.fillText(formatProjectLength(lengthMm, { ...measurementSettings, precision: 4 }), x + lengthPt + 4, y - 2);
  ctx.textBaseline = "alphabetic";
}

function wrapLine(ctx, value, width) {
  const parts = String(value || "").trim().split(/\s+/u).filter(Boolean);
  if (!parts.length) return [];
  const output = [];
  let line = "";
  for (const part of parts) {
    const next = line ? `${line} ${part}` : part;
    if (ctx.measureText(next).width <= width) {
      line = next;
      continue;
    }
    if (line) output.push(line);
    line = "";
    for (const char of part) {
      if (line && ctx.measureText(line + char).width > width) {
        output.push(line);
        line = "";
      }
      line += char;
    }
  }
  if (line) output.push(line);
  return output;
}

function tablePages(ctx, details, project) {
  const entries = [
    ["Проект", project.name],
    ["Объект", details.site], ["Помещение", details.room], ["Дата выезда", details.visitDate],
    ["Исполнитель", details.operator], ["Уровень отсчёта", details.datum],
    ...details.records.map(({ label, detail }) => [label, detail]),
  ].filter(([, value]) => String(value ?? "").trim());
  if (entries.length <= 1) return [];
  const lineHeight = 14, top = 86, bottom = A4.height - 56;
  const linesPerPage = Math.floor((bottom - top) / lineHeight);
  const pages = [[]];
  for (const [label, value] of entries) {
    ctx.font = `bold 10px ${fontFamily}`;
    const titleLines = wrapLine(ctx, label, A4.width - 2 * MARGIN);
    ctx.font = `10px ${fontFamily}`;
    const valueLines = wrapLine(ctx, value, A4.width - 2 * MARGIN);
    if (pages.at(-1).length + titleLines.length + 1 > linesPerPage) pages.push([]);
    for (const line of [
      ...titleLines.map((text) => ({ text, title: true })),
      ...valueLines.map((text) => ({ text, title: false })),
      { text: "", title: false },
    ]) {
      if (pages.at(-1).length === linesPerPage) pages.push([]);
      pages.at(-1).push(line);
    }
  }
  return pages.filter((page) => page.some(({ text }) => text));
}

function drawTablePage(ctx, page, title, lines) {
  pageHeader(ctx, page, "Паспорт и ведомость замеров", title);
  for (const [index, { text, title: label }] of lines.entries()) {
    ctx.fillStyle = label ? ink : muted;
    ctx.font = `${label ? "bold " : ""}10px ${fontFamily}`;
    ctx.fillText(text, MARGIN, 86 + index * 14);
  }
}

async function drawPhotoPage(ctx, page, title, records) {
  pageHeader(ctx, page, "Фотографии с замера", title);
  const reserve = (page.height - 155) / 2;
  for (const [index, { label, photo }] of records.entries()) {
    const image = new Image();
    image.src = photo;
    try {
      await image.decode();
    } catch {
      throw new Error(`Не удалось прочитать фото «${label}». В PDF можно выгрузить план и ведомость без фотографий.`);
    }
    const y = 84 + index * reserve;
    ctx.fillStyle = ink;
    ctx.font = `bold 10px ${fontFamily}`;
    ctx.fillText(label, MARGIN, y, page.width - MARGIN * 2);
    const scale = Math.min((page.width - MARGIN * 2) / image.naturalWidth, (reserve - 22) / image.naturalHeight);
    ctx.drawImage(image, MARGIN, y + 8, image.naturalWidth * scale, image.naturalHeight * scale);
  }
}

async function capturePage(canvas, page) {
  const image = await new Promise((resolve) => canvas.toBlob(resolve, "image/jpeg", JPEG_QUALITY));
  if (!image) throw new Error("Не удалось подготовить лист PDF");
  const record = { bytes: new Uint8Array(await image.arrayBuffer()), pixelWidth: canvas.width, pixelHeight: canvas.height, ...page };
  // Some WebViews retain a large drawing buffer even after toBlob.
  canvas.width = 1;
  canvas.height = 1;
  return record;
}

export function pdfFromJpegPages(pages) {
  if (!pages.length) throw new RangeError("PDF needs at least one page");
  const chunks = [];
  const offsets = [0];
  let total = 0;
  const write = (part) => {
    const chunk = typeof part === "string" ? encoder.encode(part) : part;
    chunks.push(chunk);
    total += chunk.byteLength;
  };
  function object(body, stream = null) {
    offsets.push(total);
    write(`${offsets.length - 1} 0 obj\n${body}`);
    if (stream !== null) {
      write("\nstream\n");
      write(stream);
      write("\nendstream");
    }
    write("\nendobj\n");
  }
  write("%PDF-1.4\n");
  write(Uint8Array.of(37, 226, 227, 207, 211, 10));
  object("<< /Type /Catalog /Pages 2 0 R >>");
  object(`<< /Type /Pages /Count ${pages.length} /Kids [${pages.map((_, i) => `${3 + i * 3} 0 R`).join(" ")}] >>`);
  for (const [index, page] of pages.entries()) {
    const width = page.width.toFixed(5), height = page.height.toFixed(5);
    const imageId = 4 + index * 3, contentId = imageId + 1;
    object(`<< /Type /Page /Parent 2 0 R /MediaBox [0 0 ${width} ${height}] /Resources << /XObject << /Plan ${imageId} 0 R >> >> /Contents ${contentId} 0 R >>`);
    object(`<< /Type /XObject /Subtype /Image /Width ${page.pixelWidth} /Height ${page.pixelHeight} /ColorSpace /DeviceRGB /BitsPerComponent 8 /Filter /DCTDecode /Length ${page.bytes.byteLength} >>`, page.bytes);
    const commands = encoder.encode(`q\n${width} 0 0 ${height} 0 0 cm\n/Plan Do\nQ\n`);
    object(`<< /Length ${commands.byteLength} >>`, commands);
  }
  const xref = total;
  write(`xref\n0 ${offsets.length}\n0000000000 65535 f \n`);
  for (const offset of offsets.slice(1)) write(`${String(offset).padStart(10, "0")} 00000 n \n`);
  write(`trailer\n<< /Size ${offsets.length} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF\n`);
  return new Blob(chunks, { type: "application/pdf" });
}

export async function buildPlotPdf(project, entities, details, options, renderPlot) {
  const measurementSettings = normalizeMeasurementSettings(project.measurementSettings);
  const unit = projectUnit(measurementSettings).label;
  const probe = document.createElement("canvas").getContext("2d");
  const bounds = pdfPlotBounds(entities, (lines, height, weight) => {
    if (!probe) return annotationTextWidth(lines, height);
    probe.font = `${weight} ${height}px Inter, Arial, sans-serif`;
    return lines.reduce((width, line) => Math.max(width, probe.measureText(line).width), height * 0.8);
  }, project.annotationScale, measurementSettings);
  const { page, area, view, ratio, fitted } = pdfPlotLayout(bounds, options.scale || measurementSettings.printScale);
  const title = project.name || "Замер";
  const room = [details.site, details.room, details.visitDate].filter(Boolean).join(" · ");
  const revision = details.revision ?? project.revision ?? "—";
  const savedTime = Date.parse(project.savedAt);
  const generatedAt = sheetDate.format(Number.isFinite(savedTime) ? savedTime : Date.now());
  const image = newPage(page);
  const { ctx } = image;
  const readings = tablePages(ctx, details, project);
  const photos = options.photos ? details.records.filter(({ photo }) => /^data:image\/(jpeg|png|webp);base64,/u.test(photo || "")) : [];
  const total = 1 + readings.length + Math.ceil(photos.length / 2);
  pageHeader(ctx, page, title, room || "План обмера");
  ctx.font = `10px ${fontFamily}`;
  const subtitle = fitted ? `Вписано в лист · 1:${mm.format(ratio)}` : `Масштаб 1:${mm.format(ratio)}`;
  ctx.fillText(`${subtitle} · ${options.layerLabel} · ${entities.length} объектов`, MARGIN, 83, page.width - MARGIN * 2);
  ctx.strokeStyle = border;
  ctx.lineWidth = 0.55;
  ctx.strokeRect(area.x, area.y, area.width, area.height);
  if (bounds) {
    ctx.save();
    ctx.beginPath();
    ctx.rect(area.x, area.y, area.width, area.height);
    ctx.clip();
    renderPlot(ctx, view, entities, project.annotationScale, measurementSettings);
    ctx.restore();
    drawScaleBar(ctx, MARGIN, page.height - 54, view.scale, measurementSettings);
    ctx.textAlign = "right";
    ctx.fillText("Для масштаба листа печатайте при 100 %", page.width - MARGIN, page.height - 52);
    ctx.textAlign = "left";
  } else {
    ctx.textAlign = "center";
    ctx.fillText("На листе нет геометрии", page.width / 2, area.y + area.height / 2);
    ctx.textAlign = "left";
  }
  pageFooter(ctx, page, 1, total, revision, generatedAt, unit);
  const pages = [await capturePage(image.canvas, page)];
  for (const lines of readings) {
    const sheet = newPage(A4);
    drawTablePage(sheet.ctx, A4, title, lines);
    pageFooter(sheet.ctx, A4, pages.length + 1, total, revision, generatedAt, unit);
    pages.push(await capturePage(sheet.canvas, A4));
  }
  for (let index = 0; index < photos.length; index += 2) {
    const sheet = newPage(A4);
    await drawPhotoPage(sheet.ctx, A4, title, photos.slice(index, index + 2));
    pageFooter(sheet.ctx, A4, pages.length + 1, total, revision, generatedAt, unit);
    pages.push(await capturePage(sheet.canvas, A4));
  }
  return pdfFromJpegPages(pages);
}
