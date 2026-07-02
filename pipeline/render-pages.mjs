import { spawnSync } from "node:child_process";
import fs from "node:fs/promises";
import path from "node:path";
import { pathToFileURL } from "node:url";
import sharp from "sharp";

const root = process.cwd();
const pdfPath = process.env.PDF_PATH || path.join(root, "AUT_SS26_redux.pdf");
const tmpDir = path.join(root, "pipeline", "tmp", "pages");
const mediaDir = path.join(root, "public", "media");

function run(command, args) {
  const result = spawnSync(command, args, { cwd: root, encoding: "utf8", shell: command.endsWith(".cmd") });
  if (result.status !== 0) {
    throw new Error(`${command} failed: ${result.stderr || result.stdout || result.error?.message || "unknown error"}`);
  }
  return result.stdout;
}

export function pdfInfoPath() {
  return (
    process.env.PDFINFO_BIN ||
    path.join(process.env.USERPROFILE || "", ".cache", "codex-runtimes", "codex-primary-runtime", "dependencies", "native", "poppler", "Library", "bin", "pdfinfo.exe")
  );
}

export function pdftoppmPath() {
  return (
    process.env.PDFTOPPM_BIN ||
    path.join(process.env.USERPROFILE || "", ".cache", "codex-runtimes", "codex-primary-runtime", "dependencies", "native", "poppler", "Library", "bin", "pdftoppm.exe")
  );
}

export function getPageCount() {
  const info = run(pdfInfoPath(), [pdfPath]);
  const match = info.match(/^Pages:\s+(\d+)/m);
  if (!match) throw new Error("Could not read page count with pdfinfo.");
  return Number(match[1]);
}

export async function renderPages({ dpi = 130, quality = 78 } = {}) {
  await fs.mkdir(tmpDir, { recursive: true });
  await fs.mkdir(mediaDir, { recursive: true });
  const pageCount = getPageCount();
  const pages = [];

  for (let page = 1; page <= pageCount; page += 1) {
    const pageId = String(page).padStart(3, "0");
    const pngPrefix = path.join(tmpDir, `page-${pageId}`);
    const pngPath = `${pngPrefix}.png`;
    const webpPath = path.join(tmpDir, `page-${pageId}.webp`);

    const needsRender = await fs.stat(webpPath).then((stat) => stat.size === 0).catch(() => true);
    if (needsRender) {
      run(pdftoppmPath(), ["-r", String(dpi), "-png", "-singlefile", "-f", String(page), "-l", String(page), pdfPath, pngPrefix]);
      await sharp(pngPath).webp({ quality }).toFile(webpPath);
      await fs.rm(pngPath, { force: true });
    }

    pages.push({ page, imagePath: webpPath });
  }

  return pages;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const pages = await renderPages();
  console.log(`Rendered ${pages.length} pages.`);
}
