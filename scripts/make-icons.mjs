import fs from "node:fs/promises";
import path from "node:path";
import sharp from "sharp";

const root = process.cwd();
const iconDir = path.join(root, "public", "icons");
await fs.mkdir(iconDir, { recursive: true });

function svg(size) {
  return `
  <svg width="${size}" height="${size}" viewBox="0 0 ${size} ${size}" xmlns="http://www.w3.org/2000/svg">
    <rect width="${size}" height="${size}" rx="${Math.round(size * 0.16)}" fill="#152019"/>
    <rect x="${size * 0.12}" y="${size * 0.12}" width="${size * 0.76}" height="${size * 0.76}" rx="${Math.round(size * 0.08)}" fill="#f2f7f2"/>
    <path d="M ${size * 0.25} ${size * 0.28} H ${size * 0.75}" stroke="#2f7d4f" stroke-width="${size * 0.045}" stroke-linecap="round"/>
    <path d="M ${size * 0.25} ${size * 0.43} H ${size * 0.68}" stroke="#2f7d4f" stroke-width="${size * 0.045}" stroke-linecap="round"/>
    <path d="M ${size * 0.25} ${size * 0.58} H ${size * 0.74}" stroke="#b88219" stroke-width="${size * 0.045}" stroke-linecap="round"/>
    <text x="50%" y="78%" dominant-baseline="middle" text-anchor="middle" font-family="Arial, sans-serif" font-size="${size * 0.18}" font-weight="800" fill="#152019">dL</text>
  </svg>`;
}

for (const size of [192, 512]) {
  await sharp(Buffer.from(svg(size))).png().toFile(path.join(iconDir, `icon-${size}.png`));
}
