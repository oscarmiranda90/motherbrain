/**
 * A dependency-free multi-select list for the terminal.
 *
 * Everything is on one screen, pre-sorted by relevance and pre-checked by the
 * scanner's confidence, so the user's job is to *confirm* a ranking — not to
 * discover one item at a time. That is the whole reason this exists instead of
 * a yes/no prompt per project.
 *
 * Renders only as many rows as the terminal can hold, and scrolls.
 */

import { stdin, stdout } from "node:process";

const KEY = {
  UP: "[A",
  DOWN: "[B",
  RIGHT: "[C",
  LEFT: "[D",
  PAGE_UP: "[5~",
  PAGE_DOWN: "[6~",
  HOME: "[H",
  END: "[F",
  ENTER: "\r",
  ENTER_N: "\n",
  SPACE: " ",
  CTRL_C: "",
  CTRL_D: "",
  ESC: "",
};

export const color = {
  reset: "[0m",
  dim: "[2m",
  bold: "[1m",
  green: "[32m",
  yellow: "[33m",
  red: "[31m",
  cyan: "[36m",
  magenta: "[35m",
  gray: "[90m",
  inverse: "[7m",
};

const supportsColor =
  stdout.isTTY && process.env.NO_COLOR === undefined && process.env.TERM !== "dumb";

export function paint(text, ...styles) {
  if (!supportsColor) return text;
  return styles.join("") + text + color.reset;
}

/** Truncate to a visible width, accounting for the ellipsis. */
export function fit(text, width) {
  const s = String(text ?? "");
  if (s.length <= width) return s;
  if (width <= 1) return s.slice(0, width);
  return `${s.slice(0, width - 1)}…`;
}

/**
 * Present a checkbox list and resolve with the selected items.
 *
 * @template T
 * @param {object} config
 * @param {string} config.title
 * @param {string} [config.hint]
 * @param {Array<{ value: T, label: string, detail?: string, checked?: boolean, group?: string, depth?: number }>} config.items
 * @returns {Promise<T[]|null>} selected values, or null if the user aborted
 */
export function multiselect({ title, hint, items }) {
  if (!stdin.isTTY) {
    throw new Error(
      "multiselect requires an interactive terminal. Use `brain scan --json` and `brain add` in non-interactive contexts.",
    );
  }

  const state = items.map((item) => ({ ...item, checked: Boolean(item.checked) }));
  let cursor = 0;
  let offset = 0;
  let filter = "";
  let filterMode = false;

  const visible = () =>
    filter
      ? state.filter((i) =>
          `${i.label} ${i.detail ?? ""}`.toLowerCase().includes(filter.toLowerCase()),
        )
      : state;

  function rowsAvailable() {
    const rows = stdout.rows ?? 24;
    // title + hint + filter line + footer + breathing room
    return Math.max(5, rows - 8);
  }

  function render(firstPaint = false) {
    const list = visible();
    const height = rowsAvailable();

    if (cursor >= list.length) cursor = Math.max(0, list.length - 1);
    if (cursor < offset) offset = cursor;
    if (cursor >= offset + height) offset = cursor - height + 1;

    const lines = [];
    const selectedCount = state.filter((i) => i.checked).length;

    lines.push(paint(title, color.bold));
    if (hint) lines.push(paint(hint, color.dim));
    lines.push(
      paint(
        `${selectedCount} of ${state.length} selected` +
          (filter ? `   filter: ${filter}` : ""),
        color.cyan,
      ),
    );
    lines.push("");

    const slice = list.slice(offset, offset + height);
    const width = Math.max(40, (stdout.columns ?? 100) - 4);

    let lastGroup = null;
    for (const [index, item] of slice.entries()) {
      const absolute = offset + index;
      const isCursor = absolute === cursor;

      if (item.group && item.group !== lastGroup) {
        lines.push(paint(`  ${item.group}`, color.gray, color.bold));
        lastGroup = item.group;
      }

      const box = item.checked ? paint("◉", color.green) : paint("○", color.gray);
      const pointer = isCursor ? paint("❯", color.cyan) : " ";

      // Indentation shows the structure on disk: a nested row is part of the
      // project above it, not a separate thing competing for attention.
      const depth = item.depth ?? 0;
      const indent = depth > 0 ? paint(`${"│ ".repeat(depth - 1)}└ `, color.gray) : "";
      const indentWidth = depth > 0 ? depth * 2 : 0;

      const labelWidth = Math.max(12, Math.floor(width * 0.42) - indentWidth);
      const label = fit(item.label, labelWidth).padEnd(labelWidth);
      const detail = fit(item.detail ?? "", Math.max(0, width - labelWidth - indentWidth - 6));

      const row = `${pointer} ${box} ${indent}${isCursor ? paint(label, color.bold) : label} ${paint(detail, color.dim)}`;
      lines.push(row);
    }

    if (list.length === 0) {
      lines.push(paint("  nothing matches that filter", color.yellow));
    }

    const more = list.length - (offset + slice.length);
    if (more > 0) lines.push(paint(`  … ${more} more below`, color.gray));

    lines.push("");
    lines.push(
      paint(
        filterMode
          ? "type to filter · enter apply filter · esc clear"
          : "↑↓ move · space toggle · a all · n none · i invert · t top-level · / filter · enter confirm · q cancel",
        color.dim,
      ),
    );

    if (!firstPaint) {
      stdout.write(`[${renderedLines}A`);
      stdout.write("[0J");
    }
    renderedLines = lines.length;
    stdout.write(`${lines.join("\n")}\n`);
  }

  let renderedLines = 0;

  return new Promise((resolve) => {
    const wasRaw = stdin.isRaw;
    stdin.setRawMode(true);
    stdin.resume();
    stdin.setEncoding("utf8");
    stdout.write("[?25l"); // hide cursor

    function cleanup() {
      stdout.write("[?25h"); // show cursor
      stdin.setRawMode(Boolean(wasRaw));
      stdin.pause();
      stdin.removeListener("data", onData);
    }

    function finish(result) {
      cleanup();
      resolve(result);
    }

    function onData(key) {
      const list = visible();

      if (filterMode) {
        if (key === KEY.ENTER || key === KEY.ENTER_N) {
          filterMode = false;
        } else if (key === KEY.ESC) {
          filter = "";
          filterMode = false;
        } else if (key === "") {
          filter = filter.slice(0, -1);
        } else if (key === KEY.CTRL_C) {
          return finish(null);
        } else if (key >= " " && key <= "~") {
          filter += key;
        }
        cursor = 0;
        offset = 0;
        return render();
      }

      switch (key) {
        case KEY.CTRL_C:
        case KEY.CTRL_D:
        case "q":
          return finish(null);

        case KEY.ENTER:
        case KEY.ENTER_N:
          return finish(state.filter((i) => i.checked).map((i) => i.value));

        case KEY.UP:
        case "k":
          cursor = cursor > 0 ? cursor - 1 : Math.max(0, list.length - 1);
          break;

        case KEY.DOWN:
        case "j":
          cursor = cursor < list.length - 1 ? cursor + 1 : 0;
          break;

        case KEY.PAGE_UP:
          cursor = Math.max(0, cursor - rowsAvailable());
          break;

        case KEY.PAGE_DOWN:
          cursor = Math.min(list.length - 1, cursor + rowsAvailable());
          break;

        case KEY.HOME:
          cursor = 0;
          break;

        case KEY.END:
          cursor = Math.max(0, list.length - 1);
          break;

        case KEY.SPACE: {
          const item = list[cursor];
          if (item) item.checked = !item.checked;
          break;
        }

        case "a":
          for (const item of list) item.checked = true;
          break;

        case "n":
          for (const item of list) item.checked = false;
          break;

        case "i":
          for (const item of list) item.checked = !item.checked;
          break;

        case "t":
          // Back to the structural default: whole projects, not their parts.
          for (const item of list) item.checked = (item.depth ?? 0) === 0;
          break;

        case "/":
          filterMode = true;
          break;

        default:
          break;
      }

      render();
    }

    stdin.on("data", onData);
    render(true);
  });
}

/** Single-line text prompt. Resolves with the trimmed answer (or the default). */
export function ask(question, fallback = "") {
  return new Promise((resolve) => {
    if (!stdin.isTTY) return resolve(fallback);

    const suffix = fallback ? paint(` (${fallback})`, color.dim) : "";
    stdout.write(`${paint("?", color.cyan)} ${question}${suffix} `);

    const wasRaw = stdin.isRaw;
    if (wasRaw) stdin.setRawMode(false);
    stdin.resume();
    stdin.setEncoding("utf8");

    let buffer = "";
    function onData(chunk) {
      buffer += chunk;
      const newline = buffer.indexOf("\n");
      if (newline === -1) return;
      stdin.removeListener("data", onData);
      stdin.pause();
      const answer = buffer.slice(0, newline).trim();
      resolve(answer || fallback);
    }
    stdin.on("data", onData);
  });
}

/** Yes/no confirmation. */
export async function confirm(question, fallback = true) {
  const answer = await ask(`${question} ${fallback ? "[Y/n]" : "[y/N]"}`, fallback ? "y" : "n");
  return /^y(es)?$/i.test(answer);
}
