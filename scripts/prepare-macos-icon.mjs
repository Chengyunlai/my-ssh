#!/usr/bin/env node
/**
 * macOS 打包图标重建/校验脚本
 *
 * 背景:macOS Big Sur+ 对包含透明/半透明像素的图标会跳过系统圆角(squircle)
 * 遮罩,按原图直接渲染 → 打包后图标呈直角边 / 白色毛边。
 * 正确做法:打包 icns 的源图必须是 100% 不透明(所有像素 alpha=255)的
 * 全出血正方形,圆角由系统在运行时自动套用。
 *
 * 用法:
 *   node scripts/prepare-macos-icon.mjs           # 重建 build/icon.png + iconset + icns
 *   node scripts/prepare-macos-icon.mjs --check   # 只校验现有资产是否全部不透明
 */
import { readFileSync, writeFileSync, copyFileSync, rmSync, existsSync, mkdirSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import zlib from 'node:zlib';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const SOURCE = join(root, 'docs/logo/final/myssh-icon-white-1024.png');
const DMG_SOURCE = join(root, 'docs/logo/final/myssh-icon-white-tile-1024.png');
const ICON_PNG = join(root, 'build/icon.png');
const ICONSET_DIR = join(root, 'build/icon.iconset');
const ICNS = join(root, 'build/icon.icns');
const DMG_ICONSET_DIR = join(root, 'build/dmg-volume.iconset');
const DMG_ICNS = join(root, 'build/dmg-volume.icns');

const ICONSET_SIZES = [
  ['icon_16x16.png', 16],
  ['icon_16x16@2x.png', 32],
  ['icon_32x32.png', 32],
  ['icon_32x32@2x.png', 64],
  ['icon_128x128.png', 128],
  ['icon_128x128@2x.png', 256],
  ['icon_256x256.png', 256],
  ['icon_256x256@2x.png', 512],
  ['icon_512x512.png', 512],
  ['icon_512x512@2x.png', 1024],
];

/* ---------- PNG 解码 ---------- */
function decodePNG(buf) {
  let pos = 8;
  const chunks = [];
  while (pos < buf.length) {
    const len = buf.readUInt32BE(pos); pos += 4;
    const type = buf.toString('ascii', pos, pos + 4); pos += 4;
    chunks.push({ type, data: buf.subarray(pos, pos + len) });
    pos += len + 4;
  }
  const ihdr = chunks.find((c) => c.type === 'IHDR').data;
  const width = ihdr.readUInt32BE(0);
  const height = ihdr.readUInt32BE(4);
  const colorType = ihdr[9];
  const idat = Buffer.concat(chunks.filter((c) => c.type === 'IDAT').map((c) => c.data));
  const raw = zlib.inflateSync(idat);
  const bpp = colorType === 6 ? 4 : 2;
  const stride = width * bpp;
  const out = Buffer.alloc(width * height * 4);
  let prev = Buffer.alloc(stride);
  let p = 0;
  for (let y = 0; y < height; y++) {
    const filter = raw[p++];
    const line = raw.subarray(p, p + stride); p += stride;
    const cur = Buffer.alloc(stride);
    for (let x = 0; x < stride; x++) {
      const a = x >= bpp ? cur[x - bpp] : 0;
      const b = prev[x];
      const c = x >= bpp ? prev[x - bpp] : 0;
      let v = line[x];
      if (filter === 1) v += a;
      else if (filter === 2) v += b;
      else if (filter === 3) v += (a + b) >> 1;
      else if (filter === 4) {
        const pred = a + b - c;
        const pa = Math.abs(pred - a), pb = Math.abs(pred - b), pc = Math.abs(pred - c);
        v += pa <= pb && pa <= pc ? a : pb <= pc ? b : c;
      }
      cur[x] = v & 0xff;
    }
    for (let x = 0; x < width; x++) {
      const o = (y * width + x) * 4;
      if (colorType === 6) {
        out[o] = cur[x * 4]; out[o + 1] = cur[x * 4 + 1];
        out[o + 2] = cur[x * 4 + 2]; out[o + 3] = cur[x * 4 + 3];
      } else {
        out[o] = cur[x * 2]; out[o + 1] = cur[x * 2];
        out[o + 2] = cur[x * 2]; out[o + 3] = cur[x * 2 + 1];
      }
    }
    prev = cur;
  }
  return { width, height, pixels: out };
}

/* ---------- PNG 编码(RGBA, filter 0) ---------- */
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
  let c = 0xffffffff;
  for (let i = 0; i < buf.length; i++) c = CRC_TABLE[(c ^ buf[i]) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

function chunk(type, data) {
  const len = Buffer.alloc(4); len.writeUInt32BE(data.length);
  const t = Buffer.from(type, 'ascii');
  const crc = Buffer.alloc(4); crc.writeUInt32BE(crc32(Buffer.concat([t, data])));
  return Buffer.concat([len, t, data, crc]);
}

function encodePNG(width, height, rgba) {
  const sig = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0);
  ihdr.writeUInt32BE(height, 4);
  ihdr[8] = 8; // bit depth
  ihdr[9] = 6; // color type RGBA
  const row = width * 4;
  const raw = Buffer.alloc((row + 1) * height);
  for (let y = 0; y < height; y++) {
    raw[y * (row + 1)] = 0; // filter: none
    rgba.copy(raw, y * (row + 1) + 1, y * row, (y + 1) * row);
  }
  const idat = zlib.deflateSync(raw, { level: 9 });
  return Buffer.concat([sig, chunk('IHDR', ihdr), chunk('IDAT', idat), chunk('IEND', Buffer.alloc(0))]);
}

/* ---------- 合成:黑 logo 合到纯白底,所有像素 alpha 强制 255 ---------- */
function compositeOpaqueOnWhite(pixels) {
  for (let o = 0; o < pixels.length; o += 4) {
    const a = pixels[o + 3];
    if (a === 255) continue;
    const na = a / 255;
    pixels[o] = Math.round(pixels[o] * na + 255 * (1 - na));
    pixels[o + 1] = Math.round(pixels[o + 1] * na + 255 * (1 - na));
    pixels[o + 2] = Math.round(pixels[o + 2] * na + 255 * (1 - na));
    pixels[o + 3] = 255;
  }
  return pixels;
}

/* ---------- alpha 校验 ---------- */
function alphaStats(width, height, pixels) {
  let notOpaque = 0;
  let nonWhite = 0;
  for (let o = 0; o < pixels.length; o += 4) {
    if (pixels[o + 3] !== 255) notOpaque++;
    if (pixels[o] < 250 || pixels[o + 1] < 250 || pixels[o + 2] < 250) nonWhite++;
  }
  const total = width * height;
  return {
    total,
    notOpaque,
    opaquePct: ((total - notOpaque) / total * 100).toFixed(3),
    nonWhitePct: (nonWhite / total * 100).toFixed(3),
  };
}

function checkFile(file, label) {
  if (!existsSync(file)) {
    console.error(`✗ ${label}:文件不存在 ${file}`);
    return false;
  }
  const { width, height, pixels } = decodePNG(readFileSync(file));
  const s = alphaStats(width, height, pixels);
  if (s.notOpaque > 0) {
    console.error(`✗ ${label}:存在 ${s.notOpaque} 个非不透明像素(${s.opaquePct}% 不透明) ${file}`);
    return false;
  }
  console.log(`✓ ${label}:100.000% 不透明,${s.nonWhitePct}% 非白内容像素 ${file}`);
  return true;
}

/* ---------- icns 解析校验(iconutil 产出的 icns 内嵌 PNG) ---------- */
function checkIcns(file, requireOpaque = true) {
  if (!existsSync(file)) {
    console.error(`✗ icns:文件不存在 ${file}`);
    return false;
  }
  const buf = readFileSync(file);
  if (buf.toString('ascii', 0, 4) !== 'icns') {
    console.error(`✗ icns:非法文件头 ${file}`);
    return false;
  }
  let pos = 8;
  let ok = true;
  let count = 0;
  const sig = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
  while (pos + 8 <= buf.length) {
    const type = buf.toString('ascii', pos, pos + 4);
    const len = buf.readUInt32BE(pos + 4);
    const data = buf.subarray(pos + 8, pos + 8 + len - 8);
    if (len > 8 && data.subarray(0, 8).equals(sig)) {
      const { width, height, pixels } = decodePNG(data);
      const s = alphaStats(width, height, pixels);
      count++;
      if (requireOpaque && s.notOpaque > 0) {
        console.error(`✗ icns[${type} ${width}x${height}]:存在 ${s.notOpaque} 个非不透明像素`);
        ok = false;
      } else if (requireOpaque) {
        console.log(`✓ icns[${type} ${width}x${height}]:100.000% 不透明`);
      } else {
        console.log(`✓ icns[${type} ${width}x${height}]:圆角卷图标资源已校验`);
      }
    }
    pos += len;
  }
  if (count === 0) {
    console.error(`✗ icns:未找到内嵌 PNG 条目 ${file}`);
    return false;
  }
  return ok;
}

/* ---------- 重建 ---------- */
function hasBin(name) {
  try { execFileSync('which', [name], { stdio: 'ignore' }); return true; }
  catch { return false; }
}

function rebuild() {
  if (!existsSync(SOURCE)) {
    console.error(`✗ 源图不存在:${SOURCE}`);
    process.exit(1);
  }
  console.log(`1/4 合成不透明白底源图 → ${SOURCE}`);
  const { width, height, pixels } = decodePNG(readFileSync(SOURCE));
  compositeOpaqueOnWhite(pixels);
  const png = encodePNG(width, height, pixels);
  writeFileSync(SOURCE, png);
  copyFileSync(SOURCE, ICON_PNG);
  console.log(`    build/icon.png 已同步`);

  if (!hasBin('sips') || !hasBin('iconutil')) {
    console.log('2/5 跳过 iconset/icns(当前环境无 sips/iconutil,仅适用于 macOS 构建机)');
  } else {
    console.log('2/5 生成 icon.iconset(10 个尺寸)');
    rmSync(ICONSET_DIR, { recursive: true, force: true });
    mkdirSync(ICONSET_DIR, { recursive: true });
    for (const [name, size] of ICONSET_SIZES) {
      const outFile = join(ICONSET_DIR, name);
      execFileSync('sips', ['-z', String(size), String(size), ICON_PNG, '--out', outFile], { stdio: 'ignore' });
    }

    console.log('3/5 生成 icon.icns');
    if (!existsSync(join(ICONSET_DIR, 'icon_512x512@2x.png'))) {
      console.error('✗ iconset 缺少 icon_512x512@2x.png,无法生成 icns');
      process.exit(1);
    }
    execFileSync('iconutil', ['-c', 'icns', ICONSET_DIR, '-o', ICNS], { stdio: 'ignore' });

    console.log('4/5 生成 DMG 专用圆角卷图标');
    if (!existsSync(DMG_SOURCE)) {
      console.error(`✗ DMG 圆角源图不存在:${DMG_SOURCE}`);
      process.exit(1);
    }
    rmSync(DMG_ICONSET_DIR, { recursive: true, force: true });
    mkdirSync(DMG_ICONSET_DIR, { recursive: true });
    for (const [name, size] of ICONSET_SIZES) {
      const outFile = join(DMG_ICONSET_DIR, name);
      execFileSync('sips', ['-z', String(size), String(size), DMG_SOURCE, '--out', outFile], { stdio: 'ignore' });
    }
    execFileSync('iconutil', ['-c', 'icns', DMG_ICONSET_DIR, '-o', DMG_ICNS], { stdio: 'ignore' });
  }

  console.log('5/5 校验打包资产');
  let ok = true;
  ok = checkFile(ICON_PNG, 'build/icon.png') && ok;
  for (const [name] of ICONSET_SIZES) {
    const f = join(ICONSET_DIR, name);
    if (existsSync(f)) ok = checkFile(f, `iconset/${name}`) && ok;
  }
  if (existsSync(ICNS)) ok = checkIcns(ICNS) && ok;
  if (existsSync(DMG_ICNS)) ok = checkIcns(DMG_ICNS, false) && ok;
  if (!ok) {
    console.error('✗ 校验失败:仍有非不透明像素,请检查源图');
    process.exit(1);
  }
  console.log('✓ 完成:应用图标使用全出血资源,DMG 磁盘卷使用专用圆角资源');
}

function check() {
  let ok = true;
  ok = checkFile(ICON_PNG, 'build/icon.png') && ok;
  for (const [name] of ICONSET_SIZES) {
    const f = join(ICONSET_DIR, name);
    if (existsSync(f)) ok = checkFile(f, `iconset/${name}`) && ok;
  }
  if (existsSync(ICNS)) ok = checkIcns(ICNS) && ok;
  if (existsSync(DMG_ICNS)) ok = checkIcns(DMG_ICNS, false) && ok;
  if (!ok) {
    console.error('✗ 图标资产存在非不透明像素,请运行 node scripts/prepare-macos-icon.mjs 重建');
    process.exit(1);
  }
  console.log('✓ 校验通过:macOS 图标资产均为 100% 不透明');
}

if (process.argv.includes('--check')) check();
else rebuild();
