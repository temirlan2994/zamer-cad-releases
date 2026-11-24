// Ролики инструментов для сайта: линия, полилиния, фигуры, обрезка,
// зеркало, размеры. Каждый ролик снимается покадрово в настоящем прототипе
// (центральный прицел: чертёж двигают пальцем, точку ставят касанием).
//
// 1. Запустите прототип:          cd prototype && node server.js
// 2. Из корня репозитория:         node site/capture/tools-demo.js [line polyline …]
//
// Нужны Playwright и ffmpeg (libx264, libwebp). Результат:
// site/public/media/tool-<имя>.mp4 и постер tool-<имя>.webp.

const fs = require("fs");
const os = require("os");
const path = require("path");
const { execFileSync } = require("child_process");
const { chromium } = require("playwright");

const APP = process.env.ZAMER_URL || "http://127.0.0.1:4187/index.html?apk=1";
const OUT = path.resolve(process.env.ZAMER_SITE_MEDIA || path.join(__dirname, "../public/media"));
const CENTER = { x: 195, y: 498.5 }; // центр холста = прицел
const THUMB = { x: 210, y: 650 }; // откуда «палец» тянет чертёж
const TAP = { x: 285, y: 705 }; // куда «палец» касается, чтобы поставить точку

const line = (id, x1, y1, x2, y2) => ({ id, type: "line", layer: "measure", x1, y1, x2, y2 });
const room = (w, h) => [line("r1", 0, 0, w, 0), line("r2", w, 0, w, h), line("r3", w, h, 0, h), line("r4", 0, h, 0, 0)];

const scenes = {
  line: {
    entities: [],
    scale: 0.075,
    start: [-700, -500],
    async run(s) {
      await s.press('[data-tool="line"]');
      await s.cursorTo(0, 0); await s.tap();
      await s.cursorTo(3600, 0); await s.tap();
      await s.tap(); await s.cursorTo(3600, 2400); await s.tap();
      await s.tap(); await s.cursorTo(0, 2400); await s.tap();
      await s.tap(); await s.cursorTo(0, 0); await s.tap({ hold: 10 });
      await s.press("#cursorToolButton"); await s.fit();
    },
  },
  polyline: {
    entities: [],
    scale: 0.07,
    start: [-700, -500],
    async run(s) {
      await s.press("#figureToolButton");
      await s.press('[data-draw-tool="polyline"]');
      for (const [x, y] of [[0, 0], [4200, 0], [4200, 2000], [2000, 2000], [2000, 3400], [0, 3400], [0, 0]]) {
        await s.cursorTo(x, y); await s.tap();
      }
      await s.press("#cursorToolButton"); await s.fit();
    },
  },
  shapes: {
    entities: [],
    scale: 0.085,
    start: [-700, -500],
    async run(s) {
      await s.press("#figureToolButton");
      await s.press('[data-draw-tool="rectangle"]');
      await s.cursorTo(0, 0); await s.tap();
      await s.cursorTo(3000, 1800); await s.tap();
      await s.press("#figureToolButton");
      await s.press('[data-draw-tool="circle"]');
      await s.cursorTo(1500, 900); await s.tap();
      await s.cursorTo(2100, 900); await s.tap({ hold: 10 });
      await s.press("#cursorToolButton"); await s.fit();
    },
  },
  trim: {
    entities: [...room(4000, 3000), line("h", -700, 1500, 4700, 1500), line("v", 2000, -700, 2000, 3700)],
    fit: true,
    async run(s) {
      await s.press("#quickTrimTool");
      for (const [x, y] of [[-350, 1500], [4350, 1500], [2000, -350], [2000, 3350], [3000, 1500]]) await s.tapAt(x, y);
    },
  },
  mirror: {
    entities: [
      line("axis", 2000, -400, 2000, 2400),
      { id: "shape", type: "polyline", layer: "measure", closed: true,
        points: [{ x: 300, y: 200 }, { x: 1600, y: 200 }, { x: 1600, y: 700 }, { x: 900, y: 700 }, { x: 900, y: 1800 }, { x: 300, y: 1800 }] },
    ],
    scale: 0.09,
    center: [2000, 1000],
    async run(s) {
      await s.tapAt(300, 1000);
      await s.press("#quickMirrorTool");
      await s.press('[data-mirror-axis="line"]');
      await s.cursorTo(2000, 0); await s.tap();
      await s.cursorTo(2000, 2000); await s.tap();
      await s.press("#lineEditApply");
    },
  },
  dims: {
    entities: room(3600, 2400),
    fit: true,
    zoomOut: 1,
    async run(s) {
      await s.press('[data-tool="dimension"]');
      await s.press('[data-dimension-tool="aligned"]');
      await s.cursorTo(0, 2400); await s.tap();
      await s.cursorTo(3600, 2400); await s.tap();
      await s.cursorTo(1800, 2950); await s.tap();
      await s.cursorTo(3600, 2400); await s.tap();
      await s.cursorTo(3600, 0); await s.tap();
      await s.cursorTo(4150, 1200); await s.tap();
      await s.press("#cursorToolButton"); await s.fit();
    },
  },
};

async function record(browser, name, scene) {
  const frames = fs.mkdtempSync(path.join(os.tmpdir(), `zamer-tool-${name}-`));
  const context = await browser.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true });
  const page = await context.newPage();
  await page.goto(APP);
  await page.waitForTimeout(1000);
  const file = path.join(frames, "scene.zamer");
  fs.writeFileSync(file, JSON.stringify({ version: 2, name: "Чертёж", entities: scene.entities }));
  await page.setInputFiles("#projectImportInput", file);
  await page.waitForTimeout(600);
  await page.click(".import-settings-dialog button[type=submit]");
  await page.waitForTimeout(1200);
  await page.addStyleTag({ content: `#demoFinger{position:fixed;z-index:99999;width:48px;height:48px;margin:-24px 0 0 -24px;border-radius:50%;
    background:rgba(31,117,255,.2);border:2px solid rgba(31,117,255,.6);box-shadow:0 2px 10px rgba(11,27,51,.25);pointer-events:none;opacity:0}
    #demoFinger.on{opacity:1}#demoFinger.down{background:rgba(31,117,255,.4);transform:scale(.8)}` });
  await page.evaluate(() => { const f = document.createElement("div"); f.id = "demoFinger"; document.body.append(f); });

  let count = 0;
  const frame = async (times = 1) => {
    const first = path.join(frames, `f${String(++count).padStart(5, "0")}.png`);
    await page.screenshot({ path: first });
    for (let i = 1; i < times; i++) fs.copyFileSync(first, path.join(frames, `f${String(++count).padStart(5, "0")}.png`));
  };
  const finger = (x, y, mode) => page.evaluate(({ x, y, mode }) => {
    const f = document.getElementById("demoFinger");
    f.style.left = `${x}px`; f.style.top = `${y}px`;
    f.className = mode === "off" ? "" : mode === "down" ? "on down" : "on";
  }, { x, y, mode });
  const key = async (...names) => {
    await page.evaluate(() => document.querySelector("canvas").focus());
    for (const name of names) await page.keyboard.press(name);
    await page.evaluate(() => document.activeElement.blur());
    await page.waitForTimeout(300);
  };
  const cursor = async () => {
    const text = (await page.textContent("#viewportCoordinates")).replace(/\s+/g, " ");
    const m = text.match(/X\s*(-?[\d\s  ]+)\s*Y\s*(-?[\d\s  ]+)/);
    const num = (value) => Number(value.replace(/[\s  ]/g, ""));
    return { x: num(m[1]), y: -num(m[2]) };
  };
  const rawDrag = async (dx, dy) => {
    await page.mouse.move(THUMB.x, THUMB.y); await page.mouse.down();
    await page.mouse.move(THUMB.x + dx, THUMB.y + dy, { steps: 4 }); await page.mouse.up();
    await page.waitForTimeout(120);
  };
  let pxPerMm = 0;
  const calibrate = async () => {
    const a = await cursor(); await rawDrag(-100, 0); const b = await cursor(); await rawDrag(100, 0);
    pxPerMm = 100 / (b.x - a.x);
  };
  const ease = (t) => (t < 0.5 ? 2 * t * t : 1 - (-2 * t + 2) ** 2 / 2);

  const s = {
    async drag(dx, dy) {
      const steps = Math.round(Math.min(24, Math.max(12, Math.hypot(dx, dy) / 9)));
      await page.mouse.move(THUMB.x, THUMB.y);
      await finger(THUMB.x, THUMB.y, "on"); await frame(2);
      await page.mouse.down(); await finger(THUMB.x, THUMB.y, "down"); await frame(2);
      for (let i = 1; i <= steps; i++) {
        const t = ease(i / steps);
        const x = THUMB.x + dx * t;
        const y = THUMB.y + dy * t;
        await page.mouse.move(x, y); await finger(x, y, "down"); await frame();
      }
      await page.mouse.up(); await finger(THUMB.x + dx, THUMB.y + dy, "on"); await frame(2);
      await finger(0, 0, "off"); await frame(3);
    },
    async cursorTo(wx, wy) {
      const c = await cursor();
      await s.drag((c.x - wx) * pxPerMm, (c.y - wy) * pxPerMm);
      const d = await cursor();
      const ex = (d.x - wx) * pxPerMm;
      const ey = (d.y - wy) * pxPerMm;
      if (Math.hypot(ex, ey) > 1) await rawDrag(ex, ey);
    },
    async tap({ x = TAP.x, y = TAP.y, hold = 7 } = {}) {
      await page.mouse.move(x, y);
      await finger(x, y, "on"); await frame(3);
      await page.mouse.down(); await finger(x, y, "down"); await frame(3);
      await page.mouse.up(); await page.waitForTimeout(80);
      await finger(x, y, "on"); await frame(2);
      await finger(0, 0, "off"); await frame(hold);
    },
    async tapAt(wx, wy) {
      const c = await cursor();
      await s.tap({ x: CENTER.x + (wx - c.x) * pxPerMm, y: CENTER.y + (wy - c.y) * pxPerMm, hold: 12 });
    },
    async press(selector, { hold = 10 } = {}) {
      const target = page.locator(selector).first();
      const box = await target.boundingBox();
      const x = box.x + box.width / 2;
      const y = box.y + box.height / 2;
      await finger(x, y, "on"); await frame(4);
      await finger(x, y, "down"); await frame(3);
      await target.click(); await page.waitForTimeout(150);
      await finger(x, y, "on"); await frame(2);
      await finger(0, 0, "off"); await frame(hold);
    },
    async fit() {
      await key("Home");
      await page.waitForTimeout(200);
      await frame(45);
    },
  };

  if (scene.fit) await key("Home");
  for (let i = 0; i < (scene.zoomOut || 0); i++) await key("-");
  await calibrate();
  if (scene.scale) {
    const presses = Math.round(Math.log(scene.scale / pxPerMm) / Math.log(1.2));
    for (let i = 0; i < Math.abs(presses); i++) await key(presses > 0 ? "+" : "-");
    await calibrate();
  }
  const center = scene.center || scene.start;
  if (center) {
    const c = await cursor();
    await rawDrag((c.x - center[0]) * pxPerMm, (c.y - center[1]) * pxPerMm);
  }

  await frame(14);
  await scene.run(s);
  await frame(36);
  await context.close();

  fs.mkdirSync(OUT, { recursive: true });
  const video = path.join(OUT, `tool-${name}.mp4`);
  execFileSync("ffmpeg", ["-y", "-loglevel", "error", "-framerate", "30", "-i", path.join(frames, "f%05d.png"),
    "-vf", "scale=480:-2:flags=lanczos,format=yuv420p", "-c:v", "libx264", "-preset", "slow", "-crf", "26",
    "-movflags", "+faststart", "-an", video]);
  execFileSync("ffmpeg", ["-y", "-loglevel", "error", "-i", path.join(frames, "f00001.png"),
    "-vf", "scale=480:-2:flags=lanczos", "-c:v", "libwebp", "-quality", "80", path.join(OUT, `tool-${name}.webp`)]);
  fs.rmSync(frames, { recursive: true, force: true });
  console.log(`tool-${name}.mp4 · ${count} кадров · ${(fs.statSync(video).size / 1024).toFixed(0)} КБ`);
}

(async () => {
  const names = process.argv.slice(2).length ? process.argv.slice(2) : Object.keys(scenes);
  const browser = await chromium.launch();
  for (const name of names) {
    if (!scenes[name]) throw new Error(`Нет сцены «${name}». Есть: ${Object.keys(scenes).join(", ")}`);
    await record(browser, name, scenes[name]);
  }
  await browser.close();
})();
