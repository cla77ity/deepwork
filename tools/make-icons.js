// Draws the Deepwork ring into PNGs for the extension and the app (no image deps).
// node tools/make-icons.js
const fs = require('fs');
const path = require('path');
const zlib = require('zlib');

function crc32(buf) {
  let c, crc = 0xffffffff;
  for (let n = 0; n < buf.length; n++) {
    c = (crc ^ buf[n]) & 0xff;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    crc = (crc >>> 8) ^ c;
  }
  return (crc ^ 0xffffffff) >>> 0;
}

function png(size, rgba) {
  const chunk = (type, data) => {
    const len = Buffer.alloc(4); len.writeUInt32BE(data.length);
    const td = Buffer.concat([Buffer.from(type), data]);
    const crc = Buffer.alloc(4); crc.writeUInt32BE(crc32(td));
    return Buffer.concat([len, td, crc]);
  };
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(size, 0); ihdr.writeUInt32BE(size, 4);
  ihdr[8] = 8; ihdr[9] = 6; ihdr[10] = 0; ihdr[11] = 0; ihdr[12] = 0;
  const raw = Buffer.alloc((size * 4 + 1) * size);
  for (let y = 0; y < size; y++) { raw[y * (size * 4 + 1)] = 0; rgba.copy(raw, y * (size * 4 + 1) + 1, y * size * 4, (y + 1) * size * 4); }
  return Buffer.concat([Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]), chunk('IHDR', ihdr), chunk('IDAT', zlib.deflateSync(raw)), chunk('IEND', Buffer.alloc(0))]);
}

function ring(size) {
  const buf = Buffer.alloc(size * size * 4);
  const c = size / 2, rO = size * 0.47, rI = size * 0.30;
  for (let y = 0; y < size; y++) for (let x = 0; x < size; x++) {
    const d = Math.hypot(x + 0.5 - c, y + 0.5 - c);
    const a = Math.min(1, Math.max(0, rO - d + 0.5)) * Math.min(1, Math.max(0, d - rI + 0.5));
    if (a <= 0) continue;
    const i = (y * size + x) * 4;
    buf[i] = 0xe8; buf[i + 1] = 0xec; buf[i + 2] = 0xff; buf[i + 3] = Math.round(a * 255);
  }
  return png(size, buf);
}

const out = path.join(__dirname, '..', 'extension', 'icons');
fs.mkdirSync(out, { recursive: true });
for (const s of [16, 32, 48, 128]) fs.writeFileSync(path.join(out, s + '.png'), ring(s));
fs.mkdirSync(path.join(__dirname, '..', 'build'), { recursive: true });
// 1024 px: electron-builder needs at least 512 for the macOS .icns
fs.writeFileSync(path.join(__dirname, '..', 'build', 'icon.png'), ring(1024));
console.log('icons written');
