// Ролики блока «Полноценный CAD в кармане» из записей экрана телефона.
// Из каждой записи берутся нужные отрезки, ролик ускоряется, а паузы, где
// на экране ничего не меняется, вырезаются: остаются только действия.
//
//   node site/capture/cut-clips.js <папка с записями> [dwg line …]
//
// Записи узнаются по времени в имени файла (Screen_Recording_20261125_133450…).
// Нужен ffmpeg с libx264 и libwebp. Результат: site/public/media/cad-<имя>.mp4
// и постер cad-<имя>.webp (первый кадр ролика).

const fs = require("fs");
const path = require("path");
const { spawn } = require("child_process");

const OUT = path.resolve(process.env.ZAMER_SITE_MEDIA || path.join(__dirname, "../public/media"));
const FPS = 30; // кадров в секунду в готовом ролике
const SRC_FPS = 60; // с какой частотой читается запись
const CROP = { w: 648, h: 1302 }; // экран приложения без строки состояния
const SIZE = { w: 540, h: 1084 }; // размер ролика на сайте
const STILL = 220; // сколько точек (из 162×325) должно измениться, чтобы кадр считался действием
const STILL_KEEP = 0.16; // сколько секунд паузы оставить, чтобы успеть увидеть результат

const SOURCES = {
  measure: { match: "20261125_133450", top: 0 }, // новый замер: линии, скругление, обрезка, круг
  dwg: { match: "20261125_150345", top: 0 }, // DWG дома с мансардой
  snaps: { match: "20261125_150455", top: 70 }, // настройки привязок, сверху строка состояния
};

// parts — отрезки записи в секундах, speed — ускорение, lead/hold — пауза
// на первом и последнем кадре.
const CLIPS = {
  // Заканчивается на общем плане: крупнее видны служебные коды текста DWG
  // («\pi1152.6;Спальня»), их пока не убирает импорт.
  dwg: { source: "dwg", parts: [[0, 3.45]], speed: 1.25, lead: 0.4, hold: 0.6 },
  // Пропуски — мелькание буквенной клавиатуры после ввода длины и холостое
  // движение прицела перед последними отрезками.
  line: { source: "measure", parts: [[0.85, 3.94], [4.06, 7.29], [7.42, 10.52], [10.64, 13.21], [15.6, 17.7]], speed: 2.2, hold: 0.7 },
  fillet: { source: "measure", parts: [[18.9, 23.94], [24.08, 25.1]], speed: 1.7, hold: 0.6 },
  trim: { source: "measure", parts: [[29.9, 35.6]], speed: 1.7, hold: 0.6 },
  copy: { source: "measure", parts: [[38.4, 47.8]], speed: 2, hold: 0.6 },
  snaps: { source: "snaps", parts: [[0, 6.05]], speed: 1.7, hold: 0.6 },
};

const COLOR = ["-color_range", "tv", "-colorspace", "bt709", "-color_primaries", "bt709", "-color_trc", "bt709"];

// Читает кадры отрезка записи и отдаёт их по одному. Конец режет trim:
// -to останавливает чтение неточно и пропускает пару кадров после границы.
function readFrames(file, [from, to], filter, frameSize, onFrame) {
  return new Promise((resolve, reject) => {
    const ff = spawn("ffmpeg", ["-loglevel", "error", "-ss", String(from), "-to", String(to + 0.5), "-i", file,
      "-vf", `trim=end=${(to - from).toFixed(3)},fps=${SRC_FPS},${filter}`, "-f", "rawvideo", "-"],
      { stdio: ["ignore", "pipe", "inherit"] });
    let frame = Buffer.allocUnsafe(frameSize);
    let filled = 0;
    let index = 0;
    ff.stdout.on("data", (chunk) => {
      for (let offset = 0; offset < chunk.length;) {
        const n = Math.min(frameSize - filled, chunk.length - offset);
        chunk.copy(frame, filled, offset, offset + n);
        filled += n;
        offset += n;
        if (filled === frameSize) {
          onFrame(frame, index++, ff.stdout);
          frame = Buffer.allocUnsafe(frameSize);
          filled = 0;
        }
      }
    });
    ff.on("error", reject);
    ff.on("close", (code) => (code === 0 ? resolve(index) : reject(new Error(`ffmpeg завершился с кодом ${code}`))));
  });
}

// Какие кадры отрезка попадут в ролик: всё, где что-то меняется, и начало
// каждой паузы; затем прореживание под ускорение.
async function pickFrames(file, part, crop, speed) {
  const w = 162;
  const h = 325;
  const counts = [];
  let prev = null;
  await readFrames(file, part, `${crop},scale=${w}:${h}:flags=area,format=gray`, w * h, (frame) => {
    let changed = 0;
    if (prev) for (let i = 0; i < frame.length; i++) if (Math.abs(frame[i] - prev[i]) > 14) changed++;
    counts.push(changed);
    prev = frame;
  });
  const near = Math.round(SRC_FPS * 0.08);
  const busy = counts.map((_, i) => counts.slice(Math.max(0, i - near), i + near + 1).some((c) => c > STILL));
  const keepStill = Math.round(STILL_KEEP * SRC_FPS * speed);
  const kept = [];
  let still = 0;
  busy.forEach((isBusy, i) => {
    still = isBusy ? 0 : still + 1;
    if (still <= keepStill) kept.push(i);
  });
  const step = (SRC_FPS * speed) / FPS;
  const picked = [];
  for (let j = 0; Math.floor(j * step) < kept.length; j++) picked.push(kept[Math.floor(j * step)]);
  return { picked, total: counts.length, kept: kept.length };
}

function encoder(args) {
  const ff = spawn("ffmpeg", ["-y", "-loglevel", "error", "-f", "rawvideo", "-pix_fmt", "yuv420p",
    "-s", `${SIZE.w}x${SIZE.h}`, "-r", String(FPS), ...COLOR, "-i", "-", ...args], { stdio: ["pipe", "inherit", "inherit"] });
  const done = new Promise((resolve, reject) => {
    ff.on("error", reject);
    ff.on("close", (code) => (code === 0 ? resolve() : reject(new Error(`ffmpeg завершился с кодом ${code}`))));
  });
  return { stdin: ff.stdin, done };
}

async function cut(dir, name, clip) {
  const source = SOURCES[clip.source];
  const file = fs.readdirSync(dir).filter((f) => f.includes(source.match) && /\.mp4$/i.test(f)).map((f) => path.join(dir, f))[0];
  if (!file) throw new Error(`Нет записи *${source.match}*.mp4 в ${dir}`);
  const crop = `crop=${CROP.w}:${CROP.h}:0:${source.top}`;
  const frameSize = SIZE.w * SIZE.h * 1.5;
  const video = path.join(OUT, `cad-${name}.mp4`);
  const mp4 = encoder(["-c:v", "libx264", "-preset", "slow", "-crf", "25", "-pix_fmt", "yuv420p", ...COLOR,
    "-movflags", "+faststart", "-an", video]);
  let written = 0;
  let last = null;
  const write = (frame, times = 1, stream = null) => {
    for (let i = 0; i < times; i++) {
      written++;
      if (!mp4.stdin.write(frame) && stream) {
        stream.pause();
        mp4.stdin.once("drain", () => stream.resume());
      }
    }
    last = frame;
  };

  let first = true;
  let posterDone = Promise.resolve();
  for (const part of clip.parts) {
    const { picked, total, kept } = await pickFrames(file, part, crop, clip.speed);
    const times = new Map();
    for (const i of picked) times.set(i, (times.get(i) || 0) + 1);
    await readFrames(file, part, `${crop},scale=${SIZE.w}:${SIZE.h}:flags=lanczos,format=yuv420p`, frameSize, (frame, i, stream) => {
      const n = times.get(i);
      if (!n) return;
      if (first) {
        first = false;
        const poster = encoder(["-frames:v", "1", "-vf",
          "scale=in_color_matrix=bt709:in_range=tv:out_color_matrix=bt601:out_range=tv,format=yuv420p",
          "-c:v", "libwebp", "-quality", "82", path.join(OUT, `cad-${name}.webp`)]);
        poster.stdin.end(frame);
        posterDone = poster.done;
        write(frame, Math.round((clip.lead || 0) * FPS));
      }
      write(frame, n, stream);
    });
    console.log(`  ${name}: ${part.join("–")} с — ${total} кадров записи, без пауз ${kept}, в ролик ${picked.length}`);
  }
  write(last, Math.round((clip.hold || 0) * FPS));
  mp4.stdin.end();
  await Promise.all([mp4.done, posterDone]);
  console.log(`cad-${name}.mp4 · ${(written / FPS).toFixed(1)} с · ${(fs.statSync(video).size / 1024).toFixed(0)} КБ`);
}

(async () => {
  const [dir, ...names] = process.argv.slice(2);
  if (!dir) throw new Error("Укажите папку с записями экрана: node site/capture/cut-clips.js <папка> [имя …]");
  fs.mkdirSync(OUT, { recursive: true });
  for (const name of names.length ? names : Object.keys(CLIPS)) {
    if (!CLIPS[name]) throw new Error(`Нет ролика «${name}». Есть: ${Object.keys(CLIPS).join(", ")}`);
    await cut(dir, name, CLIPS[name]);
  }
})().catch((error) => {
  console.error(error.message);
  process.exit(1);
});
