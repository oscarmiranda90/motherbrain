/**
 * Image discovery.
 *
 * Images are held to a stricter rule than documents, and the reason is
 * asymmetry of harm. A `README.md` almost never contains a secret, and if it
 * does, a grep finds it. A screenshot can expose a customer's name, an email,
 * a token in a URL bar, a client's dashboard — and no text search will ever
 * catch it. The only reliable check is a person looking at the picture.
 *
 * So discovery is automatic and publication is not. The scanner proposes
 * candidates from directories that conventionally hold material already
 * intended for an audience; nothing reaches a public page until the author
 * marks it `confirmed: true`. A wrong guess here is permanent and public, while
 * a missed image costs one line of frontmatter.
 */

import { readdir, stat } from "node:fs/promises";
import { join, extname, basename } from "node:path";

/** Extensions worth proposing. */
const IMAGE_EXTENSIONS = new Set([".png", ".jpg", ".jpeg", ".webp", ".avif", ".svg", ".gif"]);

/**
 * Page weight budget for a raster image, in bytes.
 *
 * Images above it are still proposed — the author's best screenshots are often
 * the heaviest — but they are flagged so publishing knows to re-encode them
 * rather than ship a phone capture at native resolution. A 1290×2796 PNG
 * weighs about 2.2MB and renders around 400px wide, so nearly all of it is
 * paid for and thrown away.
 *
 * SVG is exempt: it is text, and a large one is usually a detailed diagram.
 */
export const RASTER_SIZE_LIMIT = 600 * 1024;

/**
 * Directories whose contents were made to be shown.
 *
 * Branding, press kits and store screenshots are produced for an audience, so
 * they are the safest place to look. Everything else in a repository —
 * fixtures, debug captures, test output — is not.
 */
const PUBLIC_INTENT_DIRS = [
  "assets/branding",
  "assets/brand",
  "assets/app_store",
  "assets/appstore",
  "assets/press",
  "assets/marketing",
  "assets/screenshots",
  "assets/images",
  "branding",
  "brand",
  "press",
  "press-kit",
  "presskit",
  "marketing",
  "screenshots",
  "screenshot",
  "store",
  "app_store",
  "appstore",
  "docs/images",
  "docs/assets",
  "docs/screenshots",
  "public/images",
  "public/img",
  "static/images",
  "static/img",
  ".github/assets",
  ".github/images",
];

/**
 * Names that mark an image as internal even inside a public-looking directory.
 *
 * A directory named `screenshots/` can still hold a debug capture, and the
 * filename is usually the only clue.
 */
const INTERNAL_PATTERNS = [
  /\b(debug|dev|test|tmp|temp|scratch|wip|draft|raw|before|after|bug|error|crash)\b/i,
  /\b(local|localhost|staging|internal|private|secret)\b/i,
  /\bwork\b/i,
  /^untitled/i,
  /copy\s*\d*$/i,
  /\bscreen\s*shot\s+\d{4}-\d{2}-\d{2}/i, // macOS default capture names
];

/** Icon and launch assets: real, but they describe a platform, not a product. */
const PLATFORM_ASSET_PATTERNS = [
  /appicon/i,
  /launchimage/i,
  /\.xcassets\//i,
  /mipmap/i,
  /(^|\/)favicon\./i,
  /ic_launcher/i,
];

/** Never worth walking. */
const SKIP_DIRS = new Set([
  "node_modules",
  ".git",
  "build",
  "dist",
  "out",
  ".next",
  ".nuxt",
  ".dart_tool",
  "Pods",
  "vendor",
  "coverage",
  ".venv",
  "venv",
  "__pycache__",
  ".turbo",
  ".cache",
  "DerivedData",
]);

/**
 * When the author has both a heavy original and an optimised derivative, the
 * derivative is what should travel. Preference order matters: web formats
 * first.
 */
const FORMAT_RANK = { ".avif": 0, ".webp": 1, ".svg": 2, ".png": 3, ".jpg": 4, ".jpeg": 4, ".gif": 5 };

export function isInternalName(path) {
  const name = basename(path);
  return INTERNAL_PATTERNS.some((re) => re.test(name));
}

export function isPlatformAsset(path) {
  return PLATFORM_ASSET_PATTERNS.some((re) => re.test(path));
}

/**
 * Walk the conventional directories and propose images found there.
 *
 * @param {string} root  absolute project path
 * @param {object} [opts]
 * @param {number} [opts.maxPerProject=24]
 * @returns {Promise<Array<{path: string, bytes: number, from: string}>>}
 */
export async function discoverImages(root, opts = {}) {
  const limit = opts.maxPerProject ?? 24;
  const found = [];

  async function walk(relative, depth) {
    if (depth > 3 || found.length >= limit * 3) return;
    let entries;
    try {
      entries = await readdir(join(root, relative), { withFileTypes: true });
    } catch {
      return;
    }

    for (const entry of entries) {
      const rel = relative ? `${relative}/${entry.name}` : entry.name;
      if (entry.isDirectory()) {
        if (SKIP_DIRS.has(entry.name)) continue;
        await walk(rel, depth + 1);
        continue;
      }
      if (!entry.isFile()) continue;
      if (!IMAGE_EXTENSIONS.has(extname(entry.name).toLowerCase())) continue;
      if (isPlatformAsset(rel) || isInternalName(rel)) continue;

      let bytes = 0;
      try {
        bytes = (await stat(join(root, rel))).size;
      } catch {
        continue;
      }
      found.push({ path: rel, bytes, from: relative || "." });
    }
  }

  for (const dir of PUBLIC_INTENT_DIRS) {
    await walk(dir, 1);
  }

  // Heavy images are proposed too: a phone screenshot is usually both the
  // largest file and the most useful picture. Publishing re-encodes them.
  return dedupeByStem(found).slice(0, limit);
}

/** Whether this image needs re-encoding before it belongs on a page. */
export function needsOptimising(image) {
  if (!image?.path) return false;
  if (extname(image.path).toLowerCase() === ".svg") return false;
  return (image.bytes ?? 0) > RASTER_SIZE_LIMIT;
}

/**
 * Collapse `hook.png` and `hook.webp` to one entry, keeping the web-friendlier
 * format. Authors often commit both, and publishing the 1.6MB original when a
 * 20KB derivative exists beside it is simply wrong.
 */
export function dedupeByStem(images) {
  const best = new Map();

  for (const image of images) {
    const dir = image.path.includes("/") ? image.path.slice(0, image.path.lastIndexOf("/")) : "";
    const stem = basename(image.path, extname(image.path)).toLowerCase();
    const key = `${dir}/${stem}`;
    const rank = FORMAT_RANK[extname(image.path).toLowerCase()] ?? 9;

    const current = best.get(key);
    if (!current) {
      best.set(key, { ...image, rank });
      continue;
    }
    // Better format wins; at equal format, the smaller file wins.
    if (rank < current.rank || (rank === current.rank && image.bytes < current.bytes)) {
      best.set(key, { ...image, rank });
    }
  }

  return [...best.values()]
    .sort((a, b) => a.path.localeCompare(b.path))
    .map(({ rank, ...image }) => image);
}

/**
 * Build the frontmatter entries for discovered images.
 *
 * Every one starts unconfirmed. The author reviews them — looking at the actual
 * pictures — and sets `confirmed: true` on the ones that may be published.
 */
export function proposeImages(images) {
  return images.map((image) => ({
    path: image.path,
    alt: null,
    confirmed: false,
    bytes: image.bytes,
    ...(needsOptimising(image) ? { needs_optimising: true } : {}),
  }));
}

/**
 * Only images the author has confirmed may be published.
 *
 * `section` is carried through: an encyclopedia article floats a picture
 * beside the prose it illustrates, so a screenshot of the script generator
 * belongs next to "What it does" and not wherever it happens to fall in the
 * list. Omitting it places the image in the article's opening, like an infobox.
 */
export function confirmedImages(images = []) {
  return (Array.isArray(images) ? images : [])
    .filter((image) => image && image.confirmed === true && image.path)
    .map((image) => ({
      path: image.path,
      alt: image.alt ?? null,
      ...(image.section ? { section: image.section } : {}),
    }));
}
