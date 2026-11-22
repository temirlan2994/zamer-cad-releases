// Generates PWA app icons (PNG) with no external dependencies — uses Node's
// built-in zlib to encode. Run: node scripts/make-icons.js
const fs = require("fs");
const path = require("path");
const zlib = require("zlib");

const OUT = path.join(__dirname, "..", "icons");

const crcTable = (() => {
  const t = new Uint32Array(256);
  for (let n = 0; n < 256; n += 1) {
    let c = n;
    for (let k = 0; k < 8; k += 1) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    t[n] = c >>> 0;
  }
  return t;
})();

function crc32(buf) {
  let c = 0xffffffff;
  for (let i = 0; i < buf.length; i += 1) c = crcTable[(c ^ buf[i]) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

function chunk(type, data) {
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length, 0);
  const typeBuf = Buffer.from(type, "ascii");
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(Buffer.concat([typeBuf, data])), 0);
  return Buffer.concat([len, typeBuf, data, crc]);
}

function encodePng(size, px) {
  const sig = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]);
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(size, 0);
  ihdr.writeUInt32BE(size, 4);
  ihdr[8] = 8; // bit depth
  ihdr[9] = 6; // color type: RGBA
  const stride = size * 4;
  const raw = Buffer.alloc((stride + 1) * size);
  for (let y = 0; y < size; y += 1) {
    raw[y * (stride + 1)] = 0; // filter: none
    px.copy(raw, y * (stride + 1) + 1, y * stride, y * stride + stride);
  }
  const idat = zlib.deflateSync(raw, { level: 9 });
  return Buffer.concat([sig, chunk("IHDR", ihdr), chunk("IDAT", idat), chunk("IEND", Buffer.alloc(0))]);
}

function drawIcon(size) {
  const px = Buffer.alloc(size * size * 4);
  const set = (x, y, r, g, b) => {
    if (x < 0 || y < 0 || x >= size || y >= size) return;
    const i = (y * size + x) * 4;
    px[i] = r; px[i + 1] = g; px[i + 2] = b; px[i + 3] = 255;
  };
  const rect = (x0, y0, x1, y1, r, g, b) => {
    for (let y = Math.round(y0); y < Math.round(y1); y += 1) {
      for (let x = Math.round(x0); x < Math.round(x1); x += 1) set(x, y, r, g, b);
    }
  };
  // brand background
  rect(0, 0, size, size, 31, 117, 255);
  // faint grid (graph-paper feel)
  const step = size / 6;
  const gw = Math.max(1, Math.round(size * 0.01));
  for (let k = 1; k < 6; k += 1) {
    rect(k * step, 0, k * step + gw, size, 86, 156, 250);
    rect(0, k * step, size, k * step + gw, 86, 156, 250);
  }
  // white right-angle ruler (room corner)
  const T = Math.round(size * 0.075);
  const ax = Math.round(size * 0.30);
  const ayTop = Math.round(size * 0.27);
  const ayBot = Math.round(size * 0.73);
  const hxR = Math.round(size * 0.71);
  rect(ax, ayTop, ax + T, ayBot, 255, 255, 255); // vertical arm
  rect(ax, ayBot - T, hxR, ayBot, 255, 255, 255); // horizontal arm
  // tick marks (tape-measure feel)
  const tickLen = Math.round(size * 0.05);
  const tickW = Math.max(2, Math.round(size * 0.022));
  for (let i = 1; i <= 3; i += 1) {
    const y = ayTop + Math.round((i * (ayBot - ayTop)) / 4);
    rect(ax + T, y, ax + T + tickLen, y + tickW, 255, 255, 255);
    const x = ax + Math.round((i * (hxR - ax)) / 4);
    rect(x, ayBot - T - tickLen, x + tickW, ayBot - T, 255, 255, 255);
  }
  return encodePng(size, px);
}

fs.mkdirSync(OUT, { recursive: true });
for (const size of [192, 512, 180]) {
  const name = size === 180 ? "icon-180.png" : `icon-${size}.png`;
  fs.writeFileSync(path.join(OUT, name), drawIcon(size));
  console.log(`wrote icons/${name}`);
}
