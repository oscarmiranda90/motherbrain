/**
 * The wordmark and banner.
 *
 * Terminal art is decoration, so it has to be decoration that cannot break
 * anything. Three rules follow from that:
 *
 *   - every colour goes through `paint()`, which already returns plain text
 *     when stdout is not a TTY, when `NO_COLOR` is set, or when `TERM=dumb` —
 *     so piping to a file or a dumb terminal yields readable output, not
 *     escape codes
 *   - the wide wordmark is only drawn when the terminal is wide enough for it;
 *     a narrow window gets a compact form rather than a wrapped mess
 *   - nothing here is load-bearing. Strip the banner and every command still
 *     does its job
 */

import { stdout } from "node:process";

import { paint, color } from "./multiselect.js";

/** Extra hues for the gradient, kept here so the base palette stays small. */
const hue = {
  blue: "[38;5;69m",
  indigo: "[38;5;99m",
  violet: "[38;5;141m",
  lilac: "[38;5;183m",
  steel: "[38;5;110m",
};

/**
 * The wordmark.
 *
 * Block capitals rather than a figlet font: at 62 columns it fits a standard
 * 80-column terminal with room to spare, and it stays legible when colour is
 * stripped.
 */
const WORDMARK = [
  "███╗   ███╗  ██████╗  ████████╗ ██╗  ██╗ ███████╗ ██████╗",
  "████╗ ████║ ██╔═══██╗ ╚══██╔══╝ ██║  ██║ ██╔════╝ ██╔══██╗",
  "██╔████╔██║ ██║   ██║    ██║    ███████║ █████╗   ██████╔╝",
  "██║╚██╔╝██║ ██║   ██║    ██║    ██╔══██║ ██╔══╝   ██╔══██╗",
  "██║ ╚═╝ ██║ ╚██████╔╝    ██║    ██║  ██║ ███████╗ ██║  ██║",
  "╚═╝     ╚═╝  ╚═════╝     ╚═╝    ╚═╝  ╚═╝ ╚══════╝ ╚═╝  ╚═╝",
];

const SUBMARK = [
  "██████╗  ██████╗   █████╗  ██╗ ███╗   ██╗",
  "██╔══██╗ ██╔══██╗ ██╔══██╗ ██║ ████╗  ██║",
  "██████╔╝ ██████╔╝ ███████║ ██║ ██╔██╗ ██║",
  "██╔══██╗ ██╔══██╗ ██╔══██║ ██║ ██║╚██╗██║",
  "██████╔╝ ██║  ██║ ██║  ██║ ██║ ██║ ╚████║",
  "╚═════╝  ╚═╝  ╚═╝ ╚═╝  ╚═╝ ╚═╝ ╚═╝  ╚═══╝",
];

/** Top-to-bottom gradient, so the wordmark reads as one object. */
const GRADIENT = [hue.blue, hue.blue, hue.indigo, hue.indigo, hue.violet, hue.violet];

const WIDE_WIDTH = 62;

function columns() {
  return stdout.columns ?? 80;
}

/**
 * Render the full banner.
 *
 * @param {object} [opts]
 * @param {string} [opts.version]
 * @param {string} [opts.tagline]
 * @returns {string[]} lines, ready to log
 */
export function banner({ version, tagline } = {}) {
  const lines = [];
  const width = columns();

  if (width >= WIDE_WIDTH) {
    lines.push("");
    for (const [index, row] of WORDMARK.entries()) {
      lines.push("  " + paint(row, GRADIENT[index] ?? hue.violet));
    }
    for (const [index, row] of SUBMARK.entries()) {
      // The submark is indented to sit under the second half of the wordmark,
      // so the two read as one stacked lockup rather than two words.
      lines.push("                   " + paint(row, GRADIENT[index] ?? hue.violet));
    }
  } else {
    // Narrow terminal: a wrapped wordmark is worse than no wordmark, so the
    // eye stands in for it.
    lines.push("");
    lines.push("  " + paint("◉", hue.violet) + " " + paint("MOTHER BRAIN", color.bold));
  }

  lines.push("");

  // The tagline has to fit too. A 40-column terminal cannot hold the long
  // form, and a wrapped tagline looks like a rendering fault.
  const long = tagline ?? "an encyclopedia of everything you have built";
  const short = tagline ?? "everything you have built";
  const suffix = version ? `  v${version}` : "";
  const label = 2 + long.length + suffix.length <= width ? long : short;

  lines.push("  " + paint(label, hue.steel) + (suffix ? paint(suffix, color.gray) : ""));
  lines.push("");

  return lines;
}

/**
 * A compact one-line mark, for commands that print their own heading and only
 * need to say which tool is speaking.
 *
 * Pictorial art was tried and abandoned: the name refers to a brain with a
 * central eye, and at terminal scale neither the convolutions nor the eye
 * survive — shading characters read as noise, and the eye alone reads as a
 * padlock. Block capitals carry the name reliably, which is the job.
 */
export function mark() {
  return paint("◉", hue.violet) + " " + paint("mother brain", color.bold);
}

/**
 * A section rule that scales to the terminal.
 *
 * @param {string} title
 * @param {object} [opts]
 * @param {string} [opts.accent] one of the hues, or a base colour
 */
export function rule(title, { accent = hue.violet } = {}) {
  const width = Math.min(columns() - 2, 64);
  const label = ` ${title} `;
  const dashes = Math.max(0, width - label.length - 2);
  return [
    "",
    paint("╭─", accent) + paint(label, color.bold) + paint("─".repeat(dashes) + "╮", accent),
  ];
}

/** A progress bar that stays readable without colour. */
export function bar(done, total, width = 24) {
  const filled = total === 0 ? 0 : Math.round((done / total) * width);
  return (
    paint("█".repeat(filled), hue.violet) + paint("░".repeat(Math.max(0, width - filled)), color.gray)
  );
}

export { hue };
