import test from "node:test";
import assert from "node:assert/strict";
import { pdfFromJpegPages, pdfPlotBounds, pdfPlotLayout, pdfScaleBar } from "./pdf.js";

const line = { type: "line", layer: "measure", x1: -300, y1: 0, x2: 4700, y2: 1200 };

function close(actual, expected, tolerance = 1e-8) {
  assert.ok(Math.abs(actual - expected) <= tolerance, `${actual} != ${expected}`);
}

test("an explicit 1:50 A4 plot maps 1000 world mm to exactly 20 paper mm", () => {
  const bounds = pdfPlotBounds([line]);
  const layout = pdfPlotLayout(bounds, "50");
  assert.equal(layout.fitted, false);
  close(layout.ratio, 50);
  const paperMm = 1000 * layout.view.scale * 25.4 / 72;
  close(paperMm, 20);
  const bar = pdfScaleBar(layout.view.scale);
  assert.equal(bar.lengthMm, 1000);
  close(bar.lengthPt * 25.4 / 72, 20);
  assert.ok(layout.page.width > layout.page.height);
});

test("fit respects offsets and keeps a plot inside the page without rewriting requested scales", () => {
  const bounds = { minX: -34000, minY: 20000, maxX: 42000, maxY: 60000 };
  const { view, area, fitted } = pdfPlotLayout(bounds);
  assert.ok(fitted);
  for (const x of [bounds.minX, bounds.maxX]) {
    const point = x * view.scale + view.panX;
    assert.ok(point > area.x && point < area.x + area.width);
  }
  for (const y of [bounds.minY, bounds.maxY]) {
    const point = y * view.scale + view.panY;
    assert.ok(point > area.y && point < area.y + area.height);
  }
  assert.throws(() => pdfPlotLayout(bounds, "20"), /не помещается/);
  assert.throws(() => pdfPlotLayout(bounds, "-1"), /масштаб/);
});

test("plot bounds retain a circular arc extremum beyond its three defining points", () => {
  const point = (degrees) => {
    const radians = degrees * Math.PI / 180;
    return { x: Math.cos(radians) * 400, y: Math.sin(radians) * 400 };
  };
  const bounds = pdfPlotBounds([{ type: "arc", start: point(10), through: point(60), end: point(140) }]);
  close(bounds.maxY, 400);
  close(bounds.maxX, point(10).x);
  close(bounds.minY, point(10).y);
});

test("plot bounds preserve exact extrema of arc segments of a native polyline", () => {
  const polyline = { type: "polyline", layer: "measure", closed: false,
    points: [{ x: 0, y: 0 }, { x: 2000, y: 0 }, { x: 2000, y: 1500 }], bulges: [1, 0] };
  const bounds = pdfPlotBounds([polyline]);
  close(bounds.minX, 0);
  close(bounds.maxX, 2000);
  close(bounds.minY, -1000);
  close(bounds.maxY, 1500);

  const ring = { ...polyline, closed: true, points: [{ x: 0, y: 0 }, { x: 1000, y: 0 },
    { x: 1000, y: 1000 }, { x: 0, y: 1000 }], bulges: [0, 0, 0, 1] };
  const closed = pdfPlotBounds([ring]);
  close(closed.minX, -500);
  close(closed.maxX, 1000);
  close(closed.minY, 0);
  close(closed.maxY, 1000);
});

test("plot bounds include scaled dimension artwork and ignore replaced legacy anchors", () => {
  const dimension = {
    type: "line", layer: "dimensions", measurementType: "linear", measurementAxis: "x", offset: 345,
    x1: 0, y1: 0, x2: 300, y2: -42,
    dimX1: -10000, dimY1: -10000, dimX2: 10000, dimY2: 10000,
  };
  const bounds = pdfPlotBounds([dimension]);
  close(bounds.minX, -138.70588235294116);
  close(bounds.minY, -42);
  close(bounds.maxX, 438.70588235294116);
  close(bounds.maxY, 345 + 12 / 0.085);
  const enlarged = pdfPlotBounds([dimension], undefined, 1.3);
  close(enlarged.maxY, 345 + 12 * 1.3 / 0.085);
  assert.ok(enlarged.maxX > bounds.maxX);
});

test("enlarged angular dimensions include both non-cardinal arc ends in the plot", () => {
  const point = (degrees) => ({ x: 400 * Math.cos(degrees * Math.PI / 180), y: 400 * Math.sin(degrees * Math.PI / 180) });
  const dimension = { type: "line", layer: "dimensions", dimensionKind: "angular", vertex: { x: 0, y: 0 },
    arm1: point(10), arm2: point(80), arcRadius: 3000 };
  const bounds = pdfPlotBounds([dimension]);
  close(bounds.minX, 0);
  close(bounds.minY, 0);
  close(bounds.maxX, 3000 * Math.cos(Math.PI / 18));
  close(bounds.maxY, 3000 * Math.sin(4 * Math.PI / 9));
});

test("plot bounds cover isolated area and elevation zones without their associated drafting geometry", () => {
  const area = { type: "area", layer: "areas", points: [{ x: -1200, y: -300 }, { x: 800, y: -300 }, { x: -1200, y: 1200 }] };
  const roof = { type: "elevation", layer: "elevations", zoneStyle: "beam", height: -450,
    points: [{ x: 1200, y: 100 }, { x: 4600, y: 400 }, { x: 3000, y: 3100 }] };
  const bounds = pdfPlotBounds([area, roof]);
  assert.deepEqual(bounds, { minX: -1200, minY: -300, maxX: 4600, maxY: 3100 });
  assert.ok(pdfPlotLayout(bounds, "50").view.scale > 0);
  assert.equal(pdfPlotBounds([{ ...area, points: area.points.slice(1) }]), null);
});

test("PDF fit includes all disconnected contours and measures labels in project units", () => {
  const first = [{ x: 0, y: 0 }, { x: 2000, y: 0 }, { x: 2000, y: 1000 }, { x: 0, y: 1000 }];
  const second = [{ x: 4500, y: 300 }, { x: 5734, y: 300 }, { x: 5734, y: 1300 }, { x: 4500, y: 1300 }];
  const roof = { type: "elevation", id: "roof", layer: "elevations", zoneStyle: "beam", height: -2450,
    points: first, contours: [first, second] };
  const area = { ...roof, type: "area", id: "area", layer: "areas" };
  const labels = [];
  const bounds = pdfPlotBounds([roof, area], (lines) => { labels.push(...lines); return 100; }, 1,
    { unit: "m", precision: 3, areaPrecision: 3 });
  assert.deepEqual(bounds, { minX: 0, minY: 0, maxX: 5734, maxY: 1300 });
  assert.deepEqual(labels, ["Z -2,45 м", "3,234 м²"]);
});

test("plot bounds account for rotation and vertical extension of multiple text lines", () => {
  const text = { type: "text", layer: "text", x: 4000, y: 1500, height: 200,
    rotation: 90, text: "А\n\nСтрока" };
  const bounds = pdfPlotBounds([text]);
  close(bounds.maxX, 4200);
  close(bounds.minX, 3476);
  close(bounds.minY, 1500);
  close(bounds.maxY, 2268);
});

test("plot bounds include a multiline leader's full label even at the plan edge", () => {
  const note = { type: "line", layer: "text", dimensionKind: "leader", leaderStyle: "boxed",
    x1: -200, y1: -300, x2: 1000, y2: 0, textHeight: 200, text: "Справа\nРозетка" };
  const bounds = pdfPlotBounds([note]);
  close(bounds.minX, -200);
  close(bounds.minY, -300);
  close(bounds.maxX, 1581.3333333333333);
  close(bounds.maxY, 290);
});

test("plot bounds include an explicit bend outside the arrow and label extents", () => {
  const note = { type: "line", layer: "text", dimensionKind: "leader", leaderLine: "bent", leaderFrame: true,
    x1: -200, y1: -300, x2: 1000, y2: 0, leaderElbow: { x: -950, y: 1200 }, textHeight: 200, text: "Точка" };
  const bent = pdfPlotBounds([note]);
  close(bent.minX, -950);
  close(bent.maxY, 170);
  const straight = pdfPlotBounds([{ ...note, leaderLine: "straight" }]);
  close(straight.minX, -200);
  close(straight.maxY, 170);
});

test("PDF object table uses byte offsets even with binary data and multiple pages", async () => {
  const jpeg = Uint8Array.of(255, 216, 0, 195, 222, 255, 217);
  const pages = [
    { width: 210 * 72 / 25.4, height: 297 * 72 / 25.4, pixelWidth: 10, pixelHeight: 12, bytes: jpeg },
    { width: 300, height: 180, pixelWidth: 10, pixelHeight: 12, bytes: jpeg },
  ];
  const pdf = pdfFromJpegPages(pages);
  assert.equal(pdf.type, "application/pdf");
  const data = new TextDecoder("latin1").decode(await pdf.arrayBuffer());
  assert.match(data, /^%PDF-1\.4/);
  assert.match(data, /\/Count 2 \/Kids \[3 0 R 6 0 R\]/);
  assert.match(data, /\/MediaBox \[0 0 595\.27559 841\.88976\]/);
  const xref = Number(data.match(/startxref\n(\d+)\n/)[1]);
  const offsets = data.slice(xref).split("\n").slice(3, 11);
  assert.equal(offsets.length, 8);
  for (const [index, entry] of offsets.entries()) {
    const offset = Number(entry.slice(0, 10));
    assert.ok(data.slice(offset).startsWith(`${index + 1} 0 obj\n`));
  }
});
