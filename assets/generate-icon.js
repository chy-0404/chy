'use strict';

// 用官方 DeepSeek 鲸鱼 SVG（assets/whale.svg，取自 favicon）生成桌面图标。
// 纯 Node 实现：解析 SVG path（M/C/Z + cubic bezier 采样）→ nonzero 填充规则光栅化 → PNG / ICO。
// 产物：icon.png(512) 白底黑鲸、icon-256.png、tray.png(32)/tray-16.png(16) 透明底白鲸、icon.ico。

const fs = require('node:fs');
const path = require('node:path');
const zlib = require('node:zlib');

const OUT_DIR = __dirname;
const SEGS = 20; // 每条 cubic bezier 的采样段数

// ---- 读取并解析官方 SVG path ----
const svgText = fs.readFileSync(path.join(OUT_DIR, 'whale.svg'), 'utf8');
const dAttr = /d="([^"]+)"/.exec(svgText);
if (!dAttr) throw new Error('whale.svg 中未找到 path d 属性');
const d = dAttr[1];

function cubic(a, b, c, dd, t) {
  const u = 1 - t;
  return u * u * u * a + 3 * u * u * t * b + 3 * u * t * t * c + t * t * t * dd;
}

/** 解析 path 为若干子路径（每段为采样后的点序列）。 */
function parsePath(dStr) {
  const tokens = dStr.match(/[A-Za-z]|[-+]?\d*\.?\d+(?:e[-+]?\d+)?/gi) || [];
  const subpaths = [];
  let cur = null;
  let sx = 0;
  let sy = 0;
  let i = 0;
  while (i < tokens.length) {
    const t = tokens[i];
    if (t === 'M') {
      if (cur && cur.length > 0) subpaths.push(cur);
      cur = [];
      sx = Number(tokens[i + 1]);
      sy = Number(tokens[i + 2]);
      cur.push([sx, sy]);
      i += 3;
    } else if (t === 'C') {
      const x1 = Number(tokens[i + 1]);
      const y1 = Number(tokens[i + 2]);
      const x2 = Number(tokens[i + 3]);
      const y2 = Number(tokens[i + 4]);
      const x = Number(tokens[i + 5]);
      const y = Number(tokens[i + 6]);
      i += 7;
      const [p0x, p0y] = cur[cur.length - 1];
      for (let s = 1; s <= SEGS; s++) {
        const tt = s / SEGS;
        cur.push([cubic(p0x, x1, x2, x, tt), cubic(p0y, y1, y2, y, tt)]);
      }
    } else if (t === 'Z' || t === 'z') {
      if (cur && cur.length > 0) {
        cur.push([sx, sy]);
        subpaths.push(cur);
        cur = null;
      }
      i += 1;
    } else {
      i += 1;
    }
  }
  if (cur && cur.length > 0) subpaths.push(cur);
  return subpaths;
}

const subpaths = parsePath(d);

// ---- 计算鲸鱼包围盒 ----
let minX = Infinity;
let minY = Infinity;
let maxX = -Infinity;
let maxY = -Infinity;
for (const poly of subpaths) {
  for (const [x, y] of poly) {
    if (x < minX) minX = x;
    if (y < minY) minY = y;
    if (x > maxX) maxX = x;
    if (y > maxY) maxY = y;
  }
}

/** 单条边叉积。 */
function cross(x0, y0, x1, y1, px, py) {
  return (x1 - x0) * (py - y0) - (y1 - y0) * (px - x0);
}

/** 单条闭合/开放折线的绕数。 */
function windingNumber(px, py, poly) {
  let w = 0;
  for (let i = 0; i < poly.length - 1; i++) {
    const [x0, y0] = poly[i];
    const [x1, y1] = poly[i + 1];
    if (y0 <= py) {
      if (y1 > py && cross(x0, y0, x1, y1, px, py) > 0) w += 1;
    } else if (y1 <= py && cross(x0, y0, x1, y1, px, py) < 0) {
      w -= 1;
    }
  }
  return w;
}

/** nonzero 填充测试（所有子路径绕数之和非零即在鲸鱼内）。 */
function insideWhale(px, py) {
  if (px < minX || px > maxX || py < minY || py > maxY) return false; // 包围盒粗筛
  let w = 0;
  for (const poly of subpaths) w += windingNumber(px, py, poly);
  return w !== 0;
}

// ---- PNG / ICO 编码 ----
function clamp01(v) {
  return v < 0 ? 0 : v > 1 ? 1 : v;
}

function roundedRectSDF(nx, ny, r) {
  const px = Math.abs(nx - 0.5) - (0.5 - r);
  const py = Math.abs(ny - 0.5) - (0.5 - r);
  const qx = Math.max(px, 0);
  const qy = Math.max(py, 0);
  return Math.sqrt(qx * qx + qy * qy) + Math.min(Math.max(px, py), 0) - r;
}

function crc32(buf) {
  return zlib.crc32(buf) >>> 0;
}

function pngChunk(type, data) {
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length, 0);
  const typeBuf = Buffer.from(type, 'ascii');
  const crcBuf = Buffer.alloc(4);
  crcBuf.writeUInt32BE(crc32(Buffer.concat([typeBuf, data])), 0);
  return Buffer.concat([len, typeBuf, data, crcBuf]);
}

function makePng(size) {
  const raw = Buffer.alloc(size * (1 + size * 4));
  let o = 0;
  for (let y = 0; y < size; y++) {
    raw[o++] = 0;
    for (let x = 0; x < size; x++) {
      raw[o++] = 0;
      raw[o++] = 0;
      raw[o++] = 0;
      raw[o++] = 0;
    }
  }
  const sig = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(size, 0);
  ihdr.writeUInt32BE(size, 4);
  ihdr[8] = 8;
  ihdr[9] = 6;
  return Buffer.concat([
    sig,
    pngChunk('IHDR', ihdr),
    pngChunk('IDAT', zlib.deflateSync(raw, { level: 9 })),
    pngChunk('IEND', Buffer.alloc(0)),
  ]);
}

function makeIco(entries) {
  const header = Buffer.alloc(6);
  header.writeUInt16LE(0, 0);
  header.writeUInt16LE(1, 2);
  header.writeUInt16LE(entries.length, 4);
  const dirSize = 16;
  let offset = 6 + entries.length * dirSize;
  const dirs = [];
  const datas = [];
  for (const { size, png } of entries) {
    const dir = Buffer.alloc(dirSize);
    dir[0] = size >= 256 ? 0 : size;
    dir[1] = size >= 256 ? 0 : size;
    dir[2] = 0;
    dir[3] = 0;
    dir.writeUInt16LE(1, 4);
    dir.writeUInt16LE(32, 6);
    dir.writeUInt32LE(png.length, 8);
    dir.writeUInt32LE(offset, 12);
    dirs.push(dir);
    datas.push(png);
    offset += png.length;
  }
  return Buffer.concat([header, ...dirs, ...datas]);
}

// ---- 渲染一帧：把鲸鱼画到 size×size 画布 ----
// opts.bg: [r,g,b] 时画圆角背景；opts.whale: [r,g,b] 鲸鱼颜色。
function render(size, opts) {
  const bg = opts.bg;
  const whale = opts.whale;
  const bboxW = maxX - minX;
  const bboxH = maxY - minY;
  const scale = (size * 0.72) / Math.max(bboxW, bboxH);
  const offX = (size - bboxW * scale) / 2 - minX * scale;
  const offY = (size - bboxH * scale) / 2 - minY * scale;

  const raw = Buffer.alloc(size * (1 + size * 4));
  let o = 0;
  for (let y = 0; y < size; y++) {
    raw[o++] = 0;
    const ny = y / (size - 1);
    for (let x = 0; x < size; x++) {
      const nx = x / (size - 1);
      let r = 0;
      let g = 0;
      let b = 0;
      let a = 0;

      if (bg) {
        const dRect = roundedRectSDF(nx, ny, 0.22);
        if (dRect <= 0) {
          [r, g, b] = bg;
          a = Math.round(255 * clamp01(-dRect / 0.02));
        }
      }

      const sx = (x - offX) / scale;
      const sy = (y - offY) / scale;
      if (insideWhale(sx, sy)) {
        [r, g, b] = whale;
        a = bg ? 255 : 255;
      }

      raw[o++] = Math.round(r);
      raw[o++] = Math.round(g);
      raw[o++] = Math.round(b);
      raw[o++] = a;
    }
  }

  const sig = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(size, 0);
  ihdr.writeUInt32BE(size, 4);
  ihdr[8] = 8;
  ihdr[9] = 6;
  return Buffer.concat([
    sig,
    pngChunk('IHDR', ihdr),
    pngChunk('IDAT', zlib.deflateSync(raw, { level: 9 })),
    pngChunk('IEND', Buffer.alloc(0)),
  ]);
}

function write(name, buf) {
  const p = path.join(OUT_DIR, name);
  fs.writeFileSync(p, buf);
  return p;
}

const BLACK = [0, 0, 0];
const WHITE = [255, 255, 255];

const icon512 = render(512, { bg: WHITE, whale: BLACK });
const icon256 = render(256, { bg: WHITE, whale: BLACK });
const tray32 = render(32, { whale: BLACK });
const tray16 = render(16, { whale: BLACK });

const written = [
  write('icon.png', icon512),
  write('icon-256.png', icon256),
  write('tray.png', tray32),
  write('tray-16.png', tray16),
  write('icon.ico', makeIco([
    { size: 256, png: icon256 },
    { size: 32, png: tray32 },
    { size: 16, png: tray16 },
  ])),
];

console.log('generated whale icons:');
for (const p of written) console.log('  ' + p);
