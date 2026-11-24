// Пересъёмка экранов приложения для сайта.
//
// 1. Запустите прототип:      cd prototype && node server.js
// 2. Из корня репозитория:     node site/capture/capture.js
//
// Скрипт импортирует демо-квартиру, снимает экраны 390×844 @2x и
// сохраняет их в site/public/img/*.webp. PDF-лист сохраняется рядом во
// временной папке: отрендерите его первую страницу в pdf-sheet.webp
// (например, pdftoppm -r 144 -png -f 1 -l 1 plan.pdf page).

const fs = require("fs");
const os = require("os");
const path = require("path");
const { chromium } = require("playwright");

const APP = process.env.ZAMER_URL || "http://127.0.0.1:4187/index.html?apk=1";
const OUT = path.resolve(process.env.ZAMER_SITE_IMG || path.join(__dirname, "../public/img"));

// Демо-замер квартиры: только линии, дуги дверей, размеры и площади —
// то же, что замерщик рисует на бумаге. Координаты в мм, ось Y вниз.
function demoProject() {
  const entities = [];
  let id = 0;
  const next = (prefix) => `${prefix}${++id}`;
  const line = (x1, y1, x2, y2, lineWeight = 0.5) =>
    entities.push({ id: next("l"), type: "line", layer: "measure", x1, y1, x2, y2, lineWeight });
  const thin = (x1, y1, x2, y2) => line(x1, y1, x2, y2, 0.18);
  const dim = (x1, y1, x2, y2, offset) => entities.push({ id: next("d"), type: "line", layer: "dimensions", x1, y1, x2, y2, offset });
  const chain = (points, offset) => points.slice(1).forEach((p, i) => dim(...points[i], ...p, offset));
  const area = (x1, y1, x2, y2, label) => entities.push({ id: next("a"), type: "area", layer: "areas", label,
    points: [{ x: x1, y: y1 }, { x: x2, y: y1 }, { x: x2, y: y2 }, { x: x1, y: y2 }] });
  // Дверь: полотно от петли и дуга открывания до второго откоса.
  const door = (hinge, leafEnd, jamb) => {
    line(hinge.x, hinge.y, leafEnd.x, leafEnd.y, 0.35);
    const r = Math.hypot(leafEnd.x - hinge.x, leafEnd.y - hinge.y);
    const mx = (leafEnd.x - hinge.x) / r + (jamb.x - hinge.x) / r;
    const my = (leafEnd.y - hinge.y) / r + (jamb.y - hinge.y) / r;
    const k = r / Math.hypot(mx, my);
    entities.push({ id: next("arc"), type: "arc", layer: "measure", lineWeight: 0.18,
      start: leafEnd, through: { x: hinge.x + mx * k, y: hinge.y + my * k }, end: jamb });
  };

  const W = 6600;
  const H = 9600;
  // Наружный контур с проёмами окон и входной двери.
  [[0, 0, 900, 0], [2700, 0, 4200, 0], [5400, 0, W, 0], [0, 0, 0, 1500], [0, 3300, 0, H],
    [0, H, 1000, H], [2800, H, W, H], [W, 0, W, 5600], [W, 6500, W, H]].forEach((s) => line(...s));
  // Внутренние контуры помещений.
  [[200, 200, 900, 200], [2700, 200, 4200, 200], [5400, 200, 6400, 200], [200, 200, 200, 1500], [200, 3300, 200, 4750],
    [6400, 200, 6400, 4750], [200, 4750, 4600, 4750], [5500, 4750, 6400, 4750],
    [200, 4850, 3750, 4850], [200, 4850, 200, 9400], [200, 9400, 1000, 9400], [2800, 9400, 3750, 9400],
    [3750, 4850, 3750, 5400], [3750, 6200, 3750, 9400],
    [3850, 4850, 4600, 4850], [5500, 4850, 6400, 4850], [3850, 4850, 3850, 5400], [3850, 6200, 3850, 7350],
    [6400, 4850, 6400, 5600], [6400, 6500, 6400, 7350], [3850, 7350, 4100, 7350], [4800, 7350, 6400, 7350],
    [3850, 7450, 4100, 7450], [4800, 7450, 6400, 7450], [3850, 7450, 3850, 9400], [6400, 7450, 6400, 9400],
    [3850, 9400, 6400, 9400]].forEach((s) => line(...s));
  // Откосы проёмов.
  for (const x of [900, 2700, 4200, 5400]) line(x, 0, x, 200);
  for (const y of [1500, 3300]) line(0, y, 200, y);
  for (const x of [1000, 2800]) line(x, 9400, x, 9600);
  for (const y of [5600, 6500]) line(6400, y, 6600, y);
  for (const x of [4600, 5500]) line(x, 4750, x, 4850);
  for (const y of [5400, 6200]) line(3750, y, 3850, y);
  for (const x of [4100, 4800]) line(x, 7350, x, 7450);
  // Окна: три линии в проёме.
  for (const [a, b] of [[900, 2700], [4200, 5400]]) for (const y of [0, 100, 200]) thin(a, y, b, y);
  for (const x of [0, 100, 200]) thin(x, 1500, x, 3300);
  for (const y of [9400, 9500, 9600]) thin(1000, y, 2800, y);
  // Двери.
  door({ x: 6400, y: 5600 }, { x: 5500, y: 5600 }, { x: 6400, y: 6500 });
  door({ x: 5500, y: 4750 }, { x: 5500, y: 3850 }, { x: 4600, y: 4750 });
  door({ x: 3750, y: 5400 }, { x: 2950, y: 5400 }, { x: 3750, y: 6200 });
  door({ x: 4100, y: 7450 }, { x: 4100, y: 8150 }, { x: 4800, y: 7450 });

  area(200, 200, 6400, 4750, "Гостиная-кухня"); area(200, 4850, 3750, 9400, "Спальня");
  area(3850, 4850, 6400, 7350, "Прихожая"); area(3850, 7450, 6400, 9400, "Санузел");

  // Наружные размеры и привязки проёмов.
  dim(0, 0, W, 0, -1000); dim(0, 0, 0, H, 1000);
  chain([[0, 0], [900, 0], [2700, 0], [4200, 0], [5400, 0], [W, 0]], -500);
  chain([[0, 0], [0, 1500], [0, 3300], [0, H]], 500);
  chain([[0, H], [1000, H], [2800, H], [W, H]], 500);
  chain([[W, 0], [W, 5600], [W, 6500], [W, H]], -500);
  // Внутренние размеры помещений.
  dim(200, 200, 6400, 200, 450); dim(200, 200, 200, 4750, -450);
  dim(200, 4850, 3750, 4850, 450); dim(200, 4850, 200, 9400, -450);
  dim(3850, 4850, 6400, 4850, 450); dim(3850, 4850, 3850, 7350, -450);
  dim(3850, 9400, 6400, 9400, -450); dim(6400, 7450, 6400, 9400, 450);
  return { version: 2, name: "Квартира · замер", entities };
}

(async () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "zamer-site-"));
  const demo = path.join(tmp, "demo.zamer");
  fs.writeFileSync(demo, JSON.stringify(demoProject()));

  const browser = await chromium.launch();
  const context = await browser.newContext({
    viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true, acceptDownloads: true,
  });
  const page = await context.newPage();
  await page.goto(APP);
  await page.waitForTimeout(1200);
  await page.setInputFiles("#projectImportInput", demo);
  await page.click(".import-settings-dialog button[type=submit]");
  await page.waitForTimeout(1500);

  const keys = async (...names) => {
    await page.evaluate(() => document.querySelector("canvas").focus());
    for (const name of names) await page.keyboard.press(name);
    await page.evaluate(() => document.activeElement.blur());
    await page.waitForTimeout(450);
  };

  const shots = {};
  await keys("Home");
  shots["screen-plan"] = await page.screenshot();
  await keys("+", "+");
  shots["screen-areas"] = await page.screenshot();
  await keys("Home");
  await page.click("#exportButton");
  await page.waitForTimeout(700);
  shots["screen-export"] = await page.screenshot();

  await page.locator("#exportSheet button", { hasText: "PDF" }).first().click();
  const [download] = await Promise.all([
    page.waitForEvent("download"),
    page.locator("#exportSheet button", { hasText: "Сохранить PDF" }).click(),
  ]);
  const pdf = path.join(tmp, "plan.pdf");
  await download.saveAs(pdf);

  const converter = await context.newPage();
  for (const [name, png] of Object.entries(shots)) {
    const webp = await converter.evaluate(async ({ base64, width }) => {
      const image = new Image();
      image.src = `data:image/png;base64,${base64}`;
      await image.decode();
      const canvas = document.createElement("canvas");
      canvas.width = width;
      canvas.height = Math.round(image.height * width / image.width);
      canvas.getContext("2d").drawImage(image, 0, 0, canvas.width, canvas.height);
      return canvas.toDataURL("image/webp", 0.8).split(",")[1];
    }, { base64: png.toString("base64"), width: 720 });
    fs.writeFileSync(path.join(OUT, `${name}.webp`), Buffer.from(webp, "base64"));
    console.log(`${name}.webp`);
  }
  console.log(`PDF для pdf-sheet.webp: ${pdf}`);
  await browser.close();
})();
