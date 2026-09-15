/**
 * Image optimisation at publish time.
 *
 * A published page should not ship a phone screenshot at native resolution. A
 * 1290×2796 capture weighs about 2.2MB and renders at roughly 400px wide, so
 * more than 95% of those bytes are discarded by the browser after being paid
 * for by the reader.
 *
 * Optimisation therefore runs when copying a confirmed image into the published
 * output. The original in the repository is never touched.
 *
 * ## Why a system tool rather than a package
 *
 * Mother Brain installs with no npm dependencies, which is a real property: it
 * can be cloned in five years and run. Image encoding cannot be done well in
 * plain Node, so the work is delegated to whichever encoder the machine already
 * has — ffmpeg, cwebp, ImageMagick, or macOS `sips`. None is required. When
 * none is present, publishing continues and says plainly which images were left
 * out and what to install, rather than silently shipping megabytes or silently
 * dropping pictures.
 */

import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { stat, mkdir, copyFile } from "node:fs/promises";
import { dirname, extname, join } from "node:path";

const run = promisify(execFile);

/** Longest edge, in pixels, for a published image. */
export const MAX_EDGE = 1400;

/**
 * Bytes above which a raster is re-encoded on the way out.
 *
 * Deliberately lower than the discovery budget, because the two thresholds
 * answer different questions. Discovery asks "is this worth offering to the
 * author", where a heavy file is still a good picture. This asks "does this
 * belong on a page as-is", where the answer is stricter: a 424KB PNG slipped
 * through unchanged while its 2.2MB siblings came out at 38-51KB, so the
 * published page carried one image ten times heavier than the rest for no
 * visible benefit.
 */
export const OPTIMISE_ABOVE = 120 * 1024;

/** Target quality for lossy re-encoding. */
export const WEBP_QUALITY = 82;

/**
 * Encoders in preference order.
 *
 * ffmpeg first because it is the most commonly installed of the four and
 * handles scaling and encoding in one pass. `sips` is last: it ships with macOS
 * so it is a reliable fallback there, but it cannot write webp on older
 * versions, in which case it produces a resized JPEG instead — still a large
 * improvement over an unscaled PNG.
 */
const ENCODERS = [
  {
    name: "ffmpeg",
    probe: ["-version"],
    // `force_original_aspect_ratio=decrease` keeps proportions; `-1` on a side
    // would round to odd numbers and some encoders reject that.
    args: (input, output) => [
      "-hide_banner",
      "-loglevel",
      "error",
      "-y",
      "-i",
      input,
      "-vf",
      `scale=${MAX_EDGE}:${MAX_EDGE}:force_original_aspect_ratio=decrease`,
      "-quality",
      String(WEBP_QUALITY),
      output,
    ],
    produces: ".webp",
  },
  {
    name: "cwebp",
    probe: ["-version"],
    args: (input, output) => [
      "-quiet",
      "-q",
      String(WEBP_QUALITY),
      "-resize",
      String(MAX_EDGE),
      "0",
      input,
      "-o",
      output,
    ],
    produces: ".webp",
  },
  {
    name: "magick",
    probe: ["-version"],
    args: (input, output) => [
      input,
      "-resize",
      `${MAX_EDGE}x${MAX_EDGE}>`,
      "-quality",
      String(WEBP_QUALITY),
      output,
    ],
    produces: ".webp",
  },
  {
    name: "sips",
    probe: ["--help"],
    args: (input, output) => [
      "-Z",
      String(MAX_EDGE),
      "-s",
      "format",
      "jpeg",
      input,
      "--out",
      output,
    ],
    produces: ".jpg",
  },
];

let cachedEncoder;

/**
 * Find an available encoder, once per process.
 *
 * @returns {Promise<object|null>}
 */
export async function findEncoder() {
  if (cachedEncoder !== undefined) return cachedEncoder;

  for (const encoder of ENCODERS) {
    try {
      await run(encoder.name, encoder.probe, { timeout: 5_000 });
      cachedEncoder = encoder;
      return encoder;
    } catch {
      /* not installed, or not on PATH */
    }
  }

  cachedEncoder = null;
  return null;
}

/** For tests: forget the cached probe result. */
export function resetEncoderCache() {
  cachedEncoder = undefined;
}

/** What to tell a user who has no encoder installed. */
export const INSTALL_HINT =
  "Install one of: ffmpeg (brew install ffmpeg / apt install ffmpeg), " +
  "cwebp (brew install webp), or ImageMagick (brew install imagemagick).";

/**
 * Copy one image into the published output, optimising it when it is heavier
 * than the page budget.
 *
 * SVG is copied as-is: it is text, and rasterising a diagram would make it
 * worse. An image already under budget is copied untouched, since re-encoding
 * an author's optimised webp can only lose quality.
 *
 * @param {object} job
 * @param {string} job.from          absolute source path
 * @param {string} job.to            absolute destination path
 * @param {number} [job.budget]      bytes above which optimisation is attempted
 * @returns {Promise<{ok: boolean, action: string, bytes?: number, was?: number, path?: string, reason?: string}>}
 */
export async function placeImage({ from, to, budget = OPTIMISE_ABOVE }) {
  let size;
  try {
    size = (await stat(from)).size;
  } catch {
    return { ok: false, action: "missing", reason: "source could not be read" };
  }

  await mkdir(dirname(to), { recursive: true });

  const extension = extname(from).toLowerCase();
  if (extension === ".svg" || size <= budget) {
    await copyFile(from, to);
    return { ok: true, action: "copied", bytes: size, path: to };
  }

  const encoder = await findEncoder();
  if (!encoder) {
    return {
      ok: false,
      action: "skipped",
      was: size,
      reason: "no image encoder available",
    };
  }

  // The published name takes the encoder's extension, since the format changes.
  const target = to.replace(/\.[^.]+$/, encoder.produces);
  try {
    await run(encoder.name, encoder.args(from, target), { timeout: 60_000 });
    const after = (await stat(target)).size;
    return {
      ok: true,
      action: "optimised",
      bytes: after,
      was: size,
      path: target,
      encoder: encoder.name,
    };
  } catch (error) {
    return {
      ok: false,
      action: "failed",
      was: size,
      reason: `${encoder.name}: ${String(error.message).split("\n")[0]}`,
    };
  }
}

/** Where an optimised file ends up, given the encoder that will run. */
export async function publishedExtension(sourcePath, bytes, budget = OPTIMISE_ABOVE) {
  const extension = extname(sourcePath).toLowerCase();
  if (extension === ".svg" || bytes <= budget) return extension;
  const encoder = await findEncoder();
  return encoder ? encoder.produces : extension;
}
