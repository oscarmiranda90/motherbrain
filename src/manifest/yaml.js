/**
 * A deliberately small YAML writer/reader for frontmatter.
 *
 * Mother Brain has zero runtime dependencies on purpose: it is meant to be
 * cloned and run, on any machine, years from now, without an install step
 * resolving a tree of packages. Frontmatter is a closed, known shape — strings,
 * numbers, booleans, flat arrays, and one level of nesting — so a full YAML
 * implementation would buy nothing here.
 *
 * Anything outside that shape is rejected loudly rather than mis-serialized.
 */

const NEEDS_QUOTES = /^$|^[\s>|@`*&!%#{}[\],?:-]|[:#]\s|\s$|^(true|false|null|yes|no|on|off|~)$|^[\d.+-]+$/i;

function scalar(value) {
  if (value === null || value === undefined) return "null";
  if (typeof value === "boolean") return String(value);
  if (typeof value === "number") {
    if (!Number.isFinite(value)) throw new Error("Non-finite number in frontmatter");
    return String(value);
  }
  const s = String(value);
  if (s.includes("\n")) {
    // Fold multi-line strings into a literal block.
    return `|\n${s
      .split("\n")
      .map((l) => `    ${l}`)
      .join("\n")}`;
  }
  if (NEEDS_QUOTES.test(s)) return `"${s.replace(/\\/g, "\\\\").replace(/"/g, '\\"')}"`;
  return s;
}

function emit(value, indent, lines) {
  const pad = "  ".repeat(indent);

  if (Array.isArray(value)) {
    if (value.length === 0) return "[]";
    for (const item of value) {
      if (item && typeof item === "object" && !Array.isArray(item)) {
        // A list of maps: the first key rides the dash, the rest align under
        // it. The previous shape put a bare `-` on its own line with keys
        // over-indented, which the reader could not tell apart from a nested
        // map — every item after the first was silently lost.
        const pairs = Object.entries(item);
        if (pairs.length === 0) {
          lines.push(`${pad}- {}`);
          continue;
        }
        for (const [index, [k, v]] of pairs.entries()) {
          const prefix = index === 0 ? `${pad}- ` : `${pad}  `;
          lines.push(`${prefix}${k}: ${scalar(v)}`);
        }
      } else {
        lines.push(`${pad}- ${scalar(item)}`);
      }
    }
    return undefined;
  }

  if (value && typeof value === "object") {
    const keys = Object.keys(value);
    if (keys.length === 0) return "{}";
    for (const [k, v] of Object.entries(value)) {
      const rendered = emit(v, indent + 1, lines);
      if (rendered !== undefined) lines.push(`${pad}  ${k}: ${rendered}`);
      else lines.splice(lines.length, 0); // nested block already emitted
    }
    return undefined;
  }

  return scalar(value);
}

/** Serialize a flat-ish object to YAML frontmatter body (no `---` fences). */
export function toYaml(obj, order = null) {
  const keys = order
    ? order.filter((k) => k in obj).concat(Object.keys(obj).filter((k) => !order.includes(k)))
    : Object.keys(obj);

  const out = [];
  for (const key of keys) {
    if (key.startsWith("_")) continue; // private scan data stays out of the file
    const value = obj[key];

    if (Array.isArray(value)) {
      if (value.length === 0) {
        out.push(`${key}: []`);
        continue;
      }
      out.push(`${key}:`);
      const lines = [];
      emit(value, 1, lines);
      out.push(...lines);
      continue;
    }

    if (value && typeof value === "object") {
      const entries = Object.entries(value);
      if (entries.length === 0) {
        out.push(`${key}: {}`);
        continue;
      }
      out.push(`${key}:`);
      for (const [k, v] of entries) {
        if (Array.isArray(v)) {
          if (v.length === 0) {
            out.push(`  ${k}: []`);
          } else {
            out.push(`  ${k}:`);
            for (const item of v) out.push(`    - ${scalar(item)}`);
          }
        } else if (v && typeof v === "object") {
          out.push(`  ${k}:`);
          for (const [k2, v2] of Object.entries(v)) {
            out.push(`    ${k2}: ${scalar(v2)}`);
          }
        } else {
          out.push(`  ${k}: ${scalar(v)}`);
        }
      }
      continue;
    }

    out.push(`${key}: ${scalar(value)}`);
  }

  return out.join("\n");
}

/** Wrap frontmatter + body into a complete Markdown document. */
export function buildDocument(frontmatter, body, order = null) {
  return `---\n${toYaml(frontmatter, order)}\n---\n\n${body.trimEnd()}\n`;
}

// --- Reading ---------------------------------------------------------------

function parseScalar(raw) {
  const s = raw.trim();
  if (s === "" || s === "null" || s === "~") return null;
  if (s === "true") return true;
  if (s === "false") return false;
  if (s === "[]") return [];
  if (s === "{}") return ({});
  if (/^-?\d+$/.test(s)) return Number.parseInt(s, 10);
  if (/^-?\d*\.\d+$/.test(s)) return Number.parseFloat(s);
  if (/^".*"$/.test(s)) {
    return s.slice(1, -1).replace(/\\"/g, '"').replace(/\\\\/g, "\\");
  }
  if (/^'.*'$/.test(s)) return s.slice(1, -1);
  return s;
}

/**
 * Parse frontmatter of the shape this module writes. Returns
 * `{ frontmatter, body }`; a document with no frontmatter yields an empty object.
 */
export function parseDocument(text) {
  if (!text.startsWith("---")) return { frontmatter: {}, body: text };

  const end = text.indexOf("\n---", 3);
  if (end === -1) return { frontmatter: {}, body: text };

  const head = text.slice(4, end);
  // `buildDocument` writes a blank line after the closing fence; strip every
  // leading newline so a round-trip returns the body exactly as authored.
  const body = text.slice(end + 4).replace(/^[\r\n]+/, "");
  const frontmatter = {};

  const lines = head.split("\n");
  let i = 0;

  while (i < lines.length) {
    const line = lines[i];
    if (!line.trim() || /^\s*#/.test(line)) {
      i += 1;
      continue;
    }

    const top = line.match(/^([\w.-]+):\s*(.*)$/);
    if (!top) {
      i += 1;
      continue;
    }

    const [, key, rest] = top;

    if (rest.trim() !== "") {
      frontmatter[key] = parseScalar(rest);
      i += 1;
      continue;
    }

    // Block value: either a list or a nested map.
    const block = [];
    i += 1;
    while (i < lines.length && /^\s+\S/.test(lines[i])) {
      block.push(lines[i]);
      i += 1;
    }

    if (block.length === 0) {
      frontmatter[key] = null;
      continue;
    }

    if (block[0].trim().startsWith("- ")) {
      // A list. Each `- ` starts an item; lines that follow without a dash
      // belong to it, which is how a list of maps is distinguished from a list
      // of scalars.
      const items = [];
      let current = null;

      for (const raw of block) {
        const trimmed = raw.trim();
        if (trimmed.startsWith("- ")) {
          if (current) items.push(current);
          const rest = trimmed.slice(2);
          const pair = rest.match(/^([\w.-]+):\s*(.*)$/);
          current = pair
            ? { kind: "map", value: { [pair[1]]: parseScalar(pair[2]) } }
            : { kind: "scalar", value: parseScalar(rest) };
          continue;
        }
        // A continuation line only means something inside a map item.
        const pair = trimmed.match(/^([\w.-]+):\s*(.*)$/);
        if (current?.kind === "map" && pair) {
          current.value[pair[1]] = parseScalar(pair[2]);
        }
      }
      if (current) items.push(current);

      frontmatter[key] = items.map((item) => item.value);
      continue;
    }

    const nested = {};
    let j = 0;
    while (j < block.length) {
      const m = block[j].match(/^\s+([\w.-]+):\s*(.*)$/);
      if (!m) {
        j += 1;
        continue;
      }
      const [, k, v] = m;
      if (v.trim() !== "") {
        nested[k] = parseScalar(v);
        j += 1;
        continue;
      }
      const sub = [];
      const baseIndent = block[j].match(/^\s*/)[0].length;
      j += 1;
      while (j < block.length && block[j].match(/^\s*/)[0].length > baseIndent) {
        sub.push(block[j]);
        j += 1;
      }
      nested[k] = sub
        .filter((l) => l.trim().startsWith("- "))
        .map((l) => parseScalar(l.trim().slice(2)));
      if (nested[k].length === 0) nested[k] = null;
    }
    frontmatter[key] = nested;
  }

  return { frontmatter, body };
}
