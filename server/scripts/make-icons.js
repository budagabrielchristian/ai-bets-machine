// Draws the app icon (a dot and three rising bars on a dark tile) as SVG and
// PNG files in public/. No dependencies: shapes are rasterised with 4x4
// supersampling and written as PNG with zlib.  Run: node server/scripts/make-icons.js
import fs from 'node:fs';
import path from 'node:path';
import zlib from 'node:zlib';
import { fileURLToPath } from 'node:url';

const out = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../public');
const BG = [18, 18, 20], INK = [236, 234, 226];
const UNIT = 1254; // design grid
// The glyph, centred on the tile: a dot over a short bar, then two taller bars.
const DY = -10;
const glyph = [
  { type: 'circle', cx: 366, cy: 564 + DY, r: 68 },
  { type: 'rect', x: 270, y: 680 + DY, w: 200, h: 235, r: 36 },
  { type: 'rect', x: 527, y: 527 + DY, w: 200, h: 388, r: 36 },
  { type: 'rect', x: 785, y: 360 + DY, w: 198, h: 555, r: 36 },
];

function inRoundRect(px, py, { x, y, w, h, r }) {
  if (px < x || px > x + w || py < y || py > y + h) return false;
  const cx = Math.min(Math.max(px, x + r), x + w - r), cy = Math.min(Math.max(py, y + r), y + h - r);
  return (px - cx) ** 2 + (py - cy) ** 2 <= r * r;
}
const inShape = (px, py, s) => s.type === 'circle' ? (px - s.cx) ** 2 + (py - s.cy) ** 2 <= s.r * s.r : inRoundRect(px, py, s);

/** size: pixels; corner: tile corner radius in design units (0 = full square); scale: glyph zoom around the centre. */
function render(size, { corner = 0, scale = 1 } = {}) {
  const px = Buffer.alloc(size * size * 4);
  const tile = { x: 0, y: 0, w: UNIT, h: UNIT, r: corner };
  const S = 4;
  for (let j = 0; j < size; j++) for (let i = 0; i < size; i++) {
    let bg = 0, ink = 0;
    for (let sj = 0; sj < S; sj++) for (let si = 0; si < S; si++) {
      const u = (i + (si + 0.5) / S) / size * UNIT, v = (j + (sj + 0.5) / S) / size * UNIT;
      if (corner && !inRoundRect(u, v, tile)) continue;
      bg++;
      const gu = (u - UNIT / 2) / scale + UNIT / 2, gv = (v - UNIT / 2) / scale + UNIT / 2;
      if (glyph.some(s => inShape(gu, gv, s))) ink++;
    }
    const a = bg / (S * S), t = bg ? ink / bg : 0, k = (j * size + i) * 4;
    for (let c = 0; c < 3; c++) px[k + c] = Math.round(BG[c] + (INK[c] - BG[c]) * t);
    px[k + 3] = Math.round(a * 255);
  }
  return png(size, px);
}

const CRC = Array.from({ length: 256 }, (_, n) => { let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1; return c >>> 0; });
const crc32 = buf => { let c = 0xffffffff; for (const b of buf) c = CRC[(c ^ b) & 0xff] ^ (c >>> 8); return (c ^ 0xffffffff) >>> 0; };
function chunk(type, data) {
  const len = Buffer.alloc(4); len.writeUInt32BE(data.length);
  const body = Buffer.concat([Buffer.from(type), data]);
  const crc = Buffer.alloc(4); crc.writeUInt32BE(crc32(body));
  return Buffer.concat([len, body, crc]);
}
function png(size, rgba) {
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(size, 0); ihdr.writeUInt32BE(size, 4); ihdr[8] = 8; ihdr[9] = 6;
  const raw = Buffer.alloc(size * (size * 4 + 1));
  for (let y = 0; y < size; y++) rgba.copy(raw, y * (size * 4 + 1) + 1, y * size * 4, (y + 1) * size * 4);
  return Buffer.concat([Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]), chunk('IHDR', ihdr),
    chunk('IDAT', zlib.deflateSync(raw, { level: 9 })), chunk('IEND', Buffer.alloc(0))]);
}

function svg({ corner = 150, scale = 1 } = {}) {
  const hex = c => '#' + c.map(v => v.toString(16).padStart(2, '0')).join('');
  const t = scale === 1 ? '' : ` transform="translate(${UNIT / 2} ${UNIT / 2}) scale(${scale}) translate(${-UNIT / 2} ${-UNIT / 2})"`;
  const shapes = glyph.map(s => s.type === 'circle' ? `<circle cx="${s.cx}" cy="${s.cy}" r="${s.r}"/>`
    : `<rect x="${s.x}" y="${s.y}" width="${s.w}" height="${s.h}" rx="${s.r}"/>`).join('');
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${UNIT} ${UNIT}"><rect width="${UNIT}" height="${UNIT}" rx="${corner}" fill="${hex(BG)}"/><g fill="${hex(INK)}"${t}>${shapes}</g></svg>\n`;
}

const files = {
  // Browser tab: tighter crop so the bars stay readable at 16-32 px.
  'favicon.svg': svg({ corner: 230, scale: 1.3 }),
  'favicon-32.png': render(32, { corner: 230, scale: 1.3 }),
  // Installed app (Android): rounded tile, and a full-bleed "maskable" one the launcher crops to its own shape.
  'icon-192.png': render(192, { corner: 150 }),
  'icon-512.png': render(512, { corner: 150 }),
  'icon-maskable-512.png': render(512, { scale: 0.92 }),
  // iPhone home screen (iOS rounds the corners itself).
  'apple-touch-icon.png': render(180),
};
for (const [name, data] of Object.entries(files)) fs.writeFileSync(path.join(out, name), data);
console.log('Icons written to public/: ' + Object.keys(files).join(', '));
