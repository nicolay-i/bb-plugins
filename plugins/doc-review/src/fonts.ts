// A font for the list of comments in an exported PDF. Comments are often in
// Cyrillic or other scripts PDF's built-in fonts cannot show, so the export
// embeds a system font: whatever fontconfig picks for sans-serif, or one of
// the usual files on Linux, macOS, and Windows.
import { execFile } from "node:child_process";
import { readFile } from "node:fs/promises";
import { promisify } from "node:util";
import type { ExportFonts } from "./annotate.js";

const run = promisify(execFile);

const REGULAR = [
  "/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf",
  "/usr/share/fonts/dejavu/DejaVuSans.ttf",
  "/usr/share/fonts/TTF/DejaVuSans.ttf",
  "/usr/share/fonts/truetype/liberation/LiberationSans-Regular.ttf",
  "/usr/share/fonts/liberation-sans/LiberationSans-Regular.ttf",
  "/usr/share/fonts/truetype/noto/NotoSans-Regular.ttf",
  "/System/Library/Fonts/Supplemental/Arial.ttf",
  "/Library/Fonts/Arial.ttf",
  "C:\\Windows\\Fonts\\arial.ttf",
];
const BOLD = [
  "/usr/share/fonts/truetype/dejavu/DejaVuSans-Bold.ttf",
  "/usr/share/fonts/dejavu/DejaVuSans-Bold.ttf",
  "/usr/share/fonts/TTF/DejaVuSans-Bold.ttf",
  "/usr/share/fonts/truetype/liberation/LiberationSans-Bold.ttf",
  "/usr/share/fonts/liberation-sans/LiberationSans-Bold.ttf",
  "/usr/share/fonts/truetype/noto/NotoSans-Bold.ttf",
  "/System/Library/Fonts/Supplemental/Arial Bold.ttf",
  "/Library/Fonts/Arial Bold.ttf",
  "C:\\Windows\\Fonts\\arialbd.ttf",
];

/** Font collections (.ttc) and Type 1 files cannot be embedded this way. */
const usable = (file: string) => /\.(ttf|otf)$/i.test(file);

async function fontconfig(pattern: string): Promise<string | null> {
  try {
    const { stdout } = await run("fc-match", ["-f", "%{file}", pattern], { timeout: 5000 });
    const file = stdout.trim();
    return file && usable(file) ? file : null;
  } catch {
    return null;
  }
}

async function firstReadable(files: readonly (string | null)[]): Promise<Uint8Array | null> {
  for (const file of files) {
    if (!file) continue;
    const bytes = await readFile(file).catch(() => null);
    if (bytes && bytes.length > 0) return new Uint8Array(bytes);
  }
  return null;
}

let found: Promise<ExportFonts | null> | null = null;

/** The fonts for exports, looked up once; null when the machine has none of them. */
export function exportFonts(): Promise<ExportFonts | null> {
  found ??= (async () => {
    const [regularMatch, boldMatch] = await Promise.all([
      fontconfig("sans-serif:lang=ru"),
      fontconfig("sans-serif:lang=ru:bold"),
    ]);
    const regular = await firstReadable([regularMatch, ...REGULAR]);
    if (!regular) return null;
    return { regular, bold: await firstReadable([boldMatch, ...BOLD]) };
  })();
  return found;
}
