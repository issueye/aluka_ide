#!/usr/bin/env node
/**
 * 零依赖 VSIX 打包脚本：node scripts/make-vsix.mjs <extension目录> <输出.vsix>
 * 目录布局约定：<extensionDir>/extension/** → VSIX 内 extension/** 前缀。
 * 实现 stored（无压缩）ZIP：正斜杠条目名（规避 PowerShell Compress-Archive
 * 在 Windows PowerShell 5.1 下以反斜杠作条目分隔符、zip 规范工具读不出来的坑）。
 */
import fs from "node:fs";
import path from "node:path";

const [dir, out] = process.argv.slice(2);
if (!dir || !out) {
  console.error("用法: node scripts/make-vsix.mjs <extension目录> <输出.vsix>");
  process.exit(1);
}
const extRoot = path.join(dir, "extension");
if (!fs.existsSync(path.join(extRoot, "package.json"))) {
  console.error(`缺少 ${extRoot}/package.json（VSIX 清单）`);
  process.exit(1);
}

// ---- CRC32（IEEE 0xEDB88320 查表法） ----
const CRC_TABLE = (() => {
  const t = new Int32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    t[n] = c;
  }
  return t;
})();
function crc32(buf) {
  let c = -1;
  for (let i = 0; i < buf.length; i++) c = CRC_TABLE[(c ^ buf[i]) & 0xff] ^ (c >>> 8);
  return (c ^ -1) >>> 0;
}

const files = [];
(function walk(p, rel) {
  for (const e of fs.readdirSync(p, { withFileTypes: true })) {
    const relName = rel ? `${rel}/${e.name}` : e.name;
    if (e.isDirectory()) walk(path.join(p, e.name), relName);
    else files.push({ rel: relName, data: fs.readFileSync(path.join(p, e.name)) });
  }
})(extRoot, "extension");
files.sort((a, b) => (a.rel < b.rel ? -1 : 1));

// ---- 组装 ZIP（stored） ----
const DOS_TIME = 0; // 00:00:00
const DOS_DATE = ((2024 - 1980) << 9) | (1 << 5) | 1; // 2024-01-01
const chunks = [];
const central = [];
let offset = 0;

for (const f of files) {
  const name = Buffer.from(f.rel, "utf8");
  const crc = crc32(f.data);
  const size = f.data.length;
  const lh = Buffer.alloc(30);
  lh.writeUInt32LE(0x04034b50, 0);
  lh.writeUInt16LE(20, 4); // version needed
  lh.writeUInt16LE(0, 6); // flags
  lh.writeUInt16LE(0, 8); // method: stored
  lh.writeUInt16LE(DOS_TIME, 10);
  lh.writeUInt16LE(DOS_DATE, 12);
  lh.writeUInt32LE(crc, 14);
  lh.writeUInt32LE(size, 18);
  lh.writeUInt32LE(size, 22);
  lh.writeUInt16LE(name.length, 26);
  lh.writeUInt16LE(0, 28);
  chunks.push(lh, name, f.data);

  const ch = Buffer.alloc(46);
  ch.writeUInt32LE(0x02014b50, 0);
  ch.writeUInt16LE(20, 4); // version made by
  ch.writeUInt16LE(20, 6); // version needed
  ch.writeUInt16LE(0, 8);
  ch.writeUInt16LE(0, 10);
  ch.writeUInt16LE(DOS_TIME, 12);
  ch.writeUInt16LE(DOS_DATE, 14);
  ch.writeUInt32LE(crc, 16);
  ch.writeUInt32LE(size, 20);
  ch.writeUInt32LE(size, 24);
  ch.writeUInt16LE(name.length, 28);
  ch.writeUInt32LE(0, 30); // extra len
  ch.writeUInt16LE(0, 32); // comment len
  ch.writeUInt16LE(0, 34); // disk start
  ch.writeUInt16LE(0, 36); // internal attrs
  ch.writeUInt32LE(0, 38); // external attrs
  ch.writeUInt32LE(offset, 42);
  central.push(ch, name);

  offset += 30 + name.length + size;
}

const cdOffset = offset;
const cdBuf = Buffer.concat(central);
const eocd = Buffer.alloc(22);
eocd.writeUInt32LE(0x06054b50, 0);
eocd.writeUInt16LE(0, 4);
eocd.writeUInt16LE(0, 6);
eocd.writeUInt16LE(files.length, 8);
eocd.writeUInt16LE(files.length, 10);
eocd.writeUInt32LE(cdBuf.length, 12);
eocd.writeUInt32LE(cdOffset, 16);
eocd.writeUInt16LE(0, 20);

fs.writeFileSync(out, Buffer.concat([...chunks, cdBuf, eocd]));
console.log(`已生成 ${out}（${files.length} 个条目）`);
