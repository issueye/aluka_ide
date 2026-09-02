/**
 * 生成 Aluka IDE 应用图标源图（1024×1024 PNG）。
 * 设计：深蓝渐变圆角方块 + "A" 字形笔画（两条斜边 + 横梁），VS Code 蓝渐变。
 * 零依赖实现：手写 PNG 编码（IHDR/IDAT/IEND + CRC32 + zlib deflate）。
 * 用法：node scripts/gen-icon.mjs  →  输出 app-icon.png
 */
import { deflateSync } from "node:zlib";
import { writeFileSync } from "node:fs";

const SIZE = 1024;

// ---------- PNG 编码 ----------
const crcTable = (() => {
  const t = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    t[n] = c >>> 0;
  }
  return t;
})();

function crc32(buf) {
  let c = 0xffffffff;
  for (let i = 0; i < buf.length; i++) c = crcTable[(c ^ buf[i]) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

function chunk(type, data) {
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length);
  const body = Buffer.concat([Buffer.from(type, "ascii"), data]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(body));
  return Buffer.concat([len, body, crc]);
}

function encodePNG(width, height, rgba) {
  const sig = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0);
  ihdr.writeUInt32BE(height, 4);
  ihdr[8] = 8; // 位深
  ihdr[9] = 6; // 颜色类型 RGBA
  const stride = width * 4 + 1;
  const raw = Buffer.alloc(stride * height);
  for (let y = 0; y < height; y++) {
    raw[y * stride] = 0; // filter: None
    rgba.copy(raw, y * stride + 1, y * width * 4, (y + 1) * width * 4);
  }
  return Buffer.concat([
    sig,
    chunk("IHDR", ihdr),
    chunk("IDAT", deflateSync(raw, { level: 9 })),
    chunk("IEND", Buffer.alloc(0)),
  ]);
}

// ---------- 绘制 ----------
/** 点到线段距离 */
function distToSeg(px, py, x1, y1, x2, y2) {
  const dx = x2 - x1;
  const dy = y2 - y1;
  const t = Math.max(0, Math.min(1, ((px - x1) * dx + (py - y1) * dy) / (dx * dx + dy * dy)));
  return Math.hypot(x1 + t * dx - px, y1 + t * dy - py);
}

const clamp01 = (v) => Math.max(0, Math.min(1, v));

// "A" 字形几何参数
const APEX = [512, 240];
const BL = [230, 800];
const BR = [794, 800];
const EDGE = 38; // 笔画半宽
const BAR_Y1 = 610;
const BAR_Y2 = 690;

// 腿部内边横向范围（横梁端点随行高内缩/外扩）
function legSpan(y) {
  const t = (y - APEX[1]) / (BL[1] - APEX[1]);
  const xl = APEX[0] + (BL[0] - APEX[0]) * t;
  const xr = APEX[0] + (BR[0] - APEX[0]) * t;
  return [xl - 26, xr + 26];
}

const R = 185; // 圆角半径
const rgba = Buffer.alloc(SIZE * SIZE * 4);

for (let y = 0; y < SIZE; y++) {
  const g = y / (SIZE - 1);
  // 背景垂直渐变 #1b212e → #101620
  const bgR = 27 + g * -11;
  const bgG = 33 + g * -11;
  const bgB = 46 + g * -16;
  // 笔画垂直渐变 #56c5ff → #007ae8
  const inkR = 86 * (1 - g);
  const inkG = 197 + (122 - 197) * g;
  const inkB = 255 + (232 - 255) * g;

  const [barL, barR] = legSpan(y);

  for (let x = 0; x < SIZE; x++) {
    const i = (y * SIZE + x) * 4;
    // 圆角方形遮罩（带 1px 抗锯齿）
    const rx = Math.max(R - x, x - (SIZE - 1 - R), 0);
    const ry = Math.max(R - y, y - (SIZE - 1 - R), 0);
    const mask = clamp01(0.5 - (Math.hypot(rx, ry) - R));
    if (mask <= 0) continue;

    // "A" 字形：两斜边 + 横梁（矩形距离场），取并集
    const px = x + 0.5;
    const py = y + 0.5;
    const d1 = distToSeg(px, py, APEX[0], APEX[1], BL[0], BL[1]);
    const d2 = distToSeg(px, py, APEX[0], APEX[1], BR[0], BR[1]);
    const dxBar = Math.max(barL - px, px - barR, 0);
    const dyBar = Math.max(BAR_Y1 - py, py - BAR_Y2, 0);
    const dbar = Math.hypot(dxBar, dyBar);
    const ink = clamp01(Math.max(EDGE + 0.5 - d1, EDGE + 0.5 - d2, EDGE + 0.5 - dbar));

    rgba[i] = Math.round(bgR + (inkR - bgR) * ink);
    rgba[i + 1] = Math.round(bgG + (inkG - bgG) * ink);
    rgba[i + 2] = Math.round(bgB + (inkB - bgB) * ink);
    rgba[i + 3] = Math.round(mask * 255);
  }
}

const png = encodePNG(SIZE, SIZE, rgba);
writeFileSync(new URL("../app-icon.png", import.meta.url), png);
console.log(`app-icon.png 生成完成: ${SIZE}x${SIZE}, ${png.length} 字节`);
