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

test("plot bounds use actual dimension line anchors and measured endpoints", () => {
  const bounds = pdfPlotBounds([{
    type: "line", layer: "dimensions", measurementType: "linear", measurementAxis: "x", offset: 345,
    x1: 0, y1: 0, x2: 300, y2: -42,
    dimX1: -10000, dimY1: -10000, dimX2: 10000, dimY2: 10000,
  }]);
  assert.deepEqual(bounds, { minX: 0, minY: -42, maxX: 300, maxY: 345 });
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
