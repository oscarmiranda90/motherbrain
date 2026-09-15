/**
 * The picking page.
 *
 * `brain scan` already does this in the terminal. This exists because choosing
 * 120 folders is more comfortable with a mouse, real checkboxes and a search
 * box than with arrow keys.
 *
 * It writes nothing. The browser cannot touch the manifest — it hands back a
 * command you paste, or a JSON file you feed to `brain add --from`. That keeps
 * the whole tool a folder of files you can clone and read in ten years, rather
 * than an app that has to be running to tell the truth.
 *
 * Kept separate from `render.js` on purpose: that page is the catalog of what
 * your brain already holds, this one is a setup task you run occasionally.
 * One page trying to be both ends up bad at both.
 */

const ESCAPES = { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" };

function esc(value) {
  return String(value ?? "").replace(/[&<>"']/g, (c) => ESCAPES[c]);
}

/** Inline data safely: `</script>` inside it must not end the tag. */
function inlineJson(data) {
  return JSON.stringify(data)
    .replace(/</g, "\\u003c")
    .replace(/>/g, "\\u003e")
    .replace(/\u2028/g, "\\u2028")
    .replace(/\u2029/g, "\\u2029");
}

/**
 * Build the payload the page needs: one flat row per folder, already ordered
 * as a tree, carrying only what a human needs to decide.
 *
 * @param {Array<object>} rows   output of `buildTree`, enriched with git facts
 * @param {object} options
 * @param {string[]} options.roots      directories that were scanned
 * @param {Set<string>} options.known   paths already in the manifest
 */
export function buildPickPayload(rows, { roots = [], known = new Set() } = {}) {
  const base = roots[0] ?? "";

  return {
    generated: new Date().toISOString(),
    roots,
    rows: rows.map((row) => {
      const relative =
        base && row.path.startsWith(`${base}/`) ? row.path.slice(base.length + 1) : row.path;

      return {
        path: row.path,
        relative,
        name: row.name ?? row.dirName,
        depth: row.depth ?? 0,
        role: row.role ?? "project",
        kind: row.kind ?? "unknown",
        ecosystems: row.ecosystems ?? [],
        frameworks: row.frameworks ?? [],
        inherited: Boolean(row.frameworksInherited),
        docs: row.docs ?? [],
        deploy: row.deploy ?? [],
        description: row.description ?? null,
        git: {
          isRepo: Boolean(row.git?.isRepo),
          remote: row.git?.remote ?? null,
          public: Boolean(row.git?.likelyOpenSource),
          lastCommit: row.git?.lastCommit ?? null,
          commits: row.git?.commits ?? 0,
        },
        known: known.has(row.path),
        // Whole projects start checked; their internal parts do not. Selecting
        // both would catalog the same work twice.
        checked: (row.depth ?? 0) === 0 && !known.has(row.path),
      };
    }),
  };
}

export function renderPickPage(payload) {
  const totals = {
    all: payload.rows.length,
    projects: payload.rows.filter((r) => r.depth === 0).length,
    known: payload.rows.filter((r) => r.known).length,
  };

  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Mother Brain — pick projects</title>
<style>
  :root {
    color-scheme: light dark;
    --bg: #fbfbfa;
    --panel: #ffffff;
    --border: #e6e4e0;
    --text: #1a1a18;
    --muted: #6b6a66;
    --faint: #98968f;
    --accent: #2f5fd8;
    --accent-soft: #eaf0fd;
    --green: #1f7a45;
    --amber: #9a6200;
    --magenta: #8a3ea8;
    --radius: 10px;
    --mono: ui-monospace, SFMono-Regular, "SF Mono", Menlo, monospace;
    --sans: -apple-system, BlinkMacSystemFont, "Segoe UI", Inter, system-ui, sans-serif;
  }
  @media (prefers-color-scheme: dark) {
    :root {
      --bg: #141413;
      --panel: #1c1c1a;
      --border: #2e2e2b;
      --text: #ecebe8;
      --muted: #a3a19b;
      --faint: #74726c;
      --accent: #7fa4f5;
      --accent-soft: #1e2a42;
      --green: #6cc48d;
      --amber: #e0a955;
      --magenta: #c78fdd;
    }
  }
  * { box-sizing: border-box; }
  body {
    margin: 0;
    background: var(--bg);
    color: var(--text);
    font: 15px/1.5 var(--sans);
    -webkit-font-smoothing: antialiased;
  }
  .wrap { max-width: 1100px; margin: 0 auto; padding: 28px 20px 160px; }

  h1 { margin: 0 0 4px; font-size: 21px; font-weight: 650; letter-spacing: -0.01em; }
  .sub { color: var(--muted); font-size: 13px; margin-bottom: 20px; }
  .sub code { font-family: var(--mono); font-size: 12px; }

  .controls { display: flex; flex-wrap: wrap; gap: 8px; margin-bottom: 14px; }
  input[type="search"] {
    flex: 1 1 260px; min-width: 0; padding: 9px 12px;
    border: 1px solid var(--border); border-radius: var(--radius);
    background: var(--panel); color: var(--text); font: inherit; font-size: 14px;
  }
  input[type="search"]:focus { outline: 2px solid var(--accent); outline-offset: -1px; }
  button {
    padding: 9px 14px; border: 1px solid var(--border); border-radius: var(--radius);
    background: var(--panel); color: var(--text); font: inherit; font-size: 13px; cursor: pointer;
  }
  button:hover { border-color: var(--accent); color: var(--accent); }
  button.primary { background: var(--accent); border-color: var(--accent); color: #fff; font-weight: 550; }
  button.primary:hover { opacity: 0.9; color: #fff; }

  .facets { display: flex; flex-wrap: wrap; gap: 6px; margin-bottom: 16px; }
  .chip {
    border: 1px solid var(--border); background: var(--panel); color: var(--muted);
    border-radius: 999px; padding: 3px 11px; font-size: 12px; cursor: pointer; font-family: var(--mono);
  }
  .chip[aria-pressed="true"] { background: var(--accent); border-color: var(--accent); color: #fff; }
  .chip i { font-style: normal; opacity: 0.6; margin-left: 4px; }

  ul.rows { list-style: none; margin: 0; padding: 0; border: 1px solid var(--border); border-radius: var(--radius); overflow: hidden; background: var(--panel); }
  li.row { display: flex; gap: 10px; align-items: baseline; padding: 8px 12px; border-top: 1px solid var(--border); }
  li.row:first-child { border-top: 0; }
  li.row.checked { background: var(--accent-soft); }
  li.row.is-known { opacity: 0.62; }
  li.group {
    border-top: 1px solid var(--border); padding: 7px 12px;
    font-family: var(--mono); font-size: 11.5px; letter-spacing: 0.03em;
    color: var(--faint); background: var(--bg); text-transform: uppercase;
  }
  li.row input { margin: 0; accent-color: var(--accent); flex: none; width: 15px; height: 15px; position: relative; top: 2px; }
  .body { min-width: 0; flex: 1; }
  .name { font-weight: 560; font-size: 14px; }
  .name .dim { font-weight: 400; color: var(--faint); }
  .meta { font-size: 12px; color: var(--muted); font-family: var(--mono); margin-top: 1px; word-break: break-word; }
  .tag { color: var(--accent); }
  .role { color: var(--magenta); }
  .known { color: var(--magenta); font-family: var(--mono); font-size: 11px; }
  .nogit { color: var(--faint); }
  .path { color: var(--faint); font-size: 11.5px; font-family: var(--mono); }
  .indent { display: inline-block; color: var(--faint); font-family: var(--mono); white-space: pre; }
  .empty { padding: 36px 12px; text-align: center; color: var(--muted); }

  .bar {
    position: fixed; bottom: 0; left: 0; right: 0;
    background: var(--panel); border-top: 1px solid var(--border);
    padding: 12px 20px; display: flex; flex-wrap: wrap; gap: 10px; align-items: center;
  }
  .bar .count { font-weight: 600; margin-right: auto; font-size: 14px; }
  .bar .count span { color: var(--muted); font-weight: 400; font-size: 13px; }
  .out {
    max-width: 1100px; margin: 0 auto; width: 100%;
    font-family: var(--mono); font-size: 12px; background: var(--bg);
    border: 1px solid var(--border); border-radius: 8px; padding: 10px;
    white-space: pre-wrap; word-break: break-all; max-height: 140px; overflow: auto;
  }
  .hidden { display: none !important; }
  .hint { color: var(--muted); font-size: 12.5px; }
</style>
</head>
<body>
<div class="wrap">
  <h1>Pick what belongs in the brain</h1>
  <div class="sub">
    ${totals.all} folders found · ${totals.projects} whole projects · ${totals.known} already catalogued.
    This page writes nothing — it hands you a command to run.
  </div>

  <div class="controls">
    <input type="search" id="q" placeholder="Search name, framework, path…" autocomplete="off">
    <button type="button" id="all">All</button>
    <button type="button" id="none">None</button>
    <button type="button" id="top">Whole projects only</button>
    <button type="button" id="toggleParts">Hide internal parts</button>
  </div>

  <div class="facets" id="facets"></div>

  <ul class="rows" id="rows"></ul>
  <div class="empty hidden" id="empty">Nothing matches that filter.</div>
</div>

<div class="bar">
  <div class="count" id="count"></div>
  <button type="button" id="copy" class="primary">Copy command</button>
  <button type="button" id="show">Show command</button>
  <div class="out hidden" id="out"></div>
</div>

<script id="pick-data" type="application/json">${inlineJson(payload)}</script>
<script>
(() => {
  const data = JSON.parse(document.getElementById("pick-data").textContent);
  const rows = data.rows;

  const elRows = document.getElementById("rows");
  const elEmpty = document.getElementById("empty");
  const elCount = document.getElementById("count");
  const elOut = document.getElementById("out");
  const elFacets = document.getElementById("facets");
  const q = document.getElementById("q");

  const active = new Set();
  let hideParts = false;

  const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => (
    { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]
  ));

  // Facets from what was actually found, most common first.
  const counts = new Map();
  for (const row of rows) {
    for (const label of [...row.frameworks, ...row.ecosystems]) {
      counts.set(label, (counts.get(label) || 0) + 1);
    }
  }
  for (const [label, n] of [...counts.entries()].sort((a, b) => b[1] - a[1]).slice(0, 18)) {
    const chip = document.createElement("button");
    chip.type = "button";
    chip.className = "chip";
    chip.setAttribute("aria-pressed", "false");
    chip.innerHTML = esc(label) + "<i>" + n + "</i>";
    chip.addEventListener("click", () => {
      if (active.has(label)) active.delete(label); else active.add(label);
      chip.setAttribute("aria-pressed", String(active.has(label)));
      render();
    });
    elFacets.append(chip);
  }

  function matches(row) {
    if (hideParts && row.depth > 0) return false;

    const term = q.value.trim().toLowerCase();
    if (term) {
      const hay = [
        row.name, row.relative, row.kind, row.role, row.description,
        row.frameworks.join(" "), row.ecosystems.join(" "), row.docs.join(" "),
      ].join(" ").toLowerCase();
      if (!hay.includes(term)) return false;
    }

    if (active.size) {
      const built = new Set([...row.frameworks, ...row.ecosystems]);
      for (const needed of active) if (!built.has(needed)) return false;
    }
    return true;
  }

  const ROLE_LABEL = {
    platform: "platform folder",
    package: "sub-package",
    nested: "inside project",
  };

  function metaFor(row) {
    const bits = [];

    const built = row.frameworks.length ? row.frameworks : row.ecosystems;
    if (built.length) {
      const shown = built.slice(0, 5).join(" · ");
      const extra = built.length > 5 ? " +" + (built.length - 5) : "";
      bits.push('<span class="tag">' + esc(shown + extra) + (row.inherited ? " (from its parts)" : "") + "</span>");
    } else {
      bits.push('<span class="nogit">unknown stack</span>');
    }

    if (ROLE_LABEL[row.role]) bits.push('<span class="role">' + ROLE_LABEL[row.role] + "</span>");

    if (row.git.isRepo) {
      bits.push(row.git.public ? "public repo" : "git");
      if (row.git.lastCommit) bits.push(esc(row.git.lastCommit));
      if (row.git.commits) bits.push(row.git.commits + "c");
    } else {
      bits.push('<span class="nogit">no git</span>');
    }

    if (row.deploy.length) bits.push(esc(row.deploy.join("+")));
    if (row.docs.length) bits.push(esc(row.docs.slice(0, 2).join("+")));

    return bits.join(" · ");
  }

  function render() {
    const visible = rows.filter(matches);
    elRows.replaceChildren();

    let lastGroup = null;
    for (const row of visible) {
      // Group heading: the folder that contains this project, for top-level rows.
      if (row.depth === 0) {
        const cut = row.relative.lastIndexOf("/");
        const group = cut > 0 ? row.relative.slice(0, cut) : null;
        if (group !== lastGroup) {
          lastGroup = group;
          if (group) {
            const li = document.createElement("li");
            li.className = "group";
            li.textContent = group;
            elRows.append(li);
          }
        }
      }

      const li = document.createElement("li");
      li.className = "row" + (row.checked ? " checked" : "") + (row.known ? " is-known" : "");

      const box = document.createElement("input");
      box.type = "checkbox";
      box.checked = row.checked;
      box.addEventListener("change", () => {
        row.checked = box.checked;
        li.classList.toggle("checked", box.checked);
        updateCount();
      });

      const body = document.createElement("div");
      body.className = "body";
      const indent = row.depth > 0
        ? '<span class="indent">' + "│ ".repeat(row.depth - 1) + "└ " + "</span>"
        : "";
      body.innerHTML =
        '<div class="name">' + indent + esc(row.name) +
          (row.known ? ' <span class="known">already in brain</span>' : "") +
          (row.description ? ' <span class="dim">— ' + esc(row.description) + "</span>" : "") +
        "</div>" +
        '<div class="meta">' + metaFor(row) + "</div>" +
        '<div class="path">' + esc(row.relative) + "</div>";

      li.append(box, body);
      elRows.append(li);
    }

    elEmpty.classList.toggle("hidden", visible.length > 0);
    updateCount();
  }

  function selected() {
    return rows.filter((r) => r.checked);
  }

  function command() {
    const picked = selected();
    if (picked.length === 0) return "";
    // Quote every path: real directories contain spaces.
    return "brain add " + picked.map((r) => "'" + r.path.replace(/'/g, "'\\\\''") + "'").join(" \\\\\\n  ");
  }

  function updateCount() {
    const picked = selected();
    const refresh = picked.filter((r) => r.known).length;
    elCount.innerHTML =
      picked.length + " selected " +
      "<span>of " + rows.length + " folders" + (refresh ? " · " + refresh + " will refresh" : "") + "</span>";
    if (!elOut.classList.contains("hidden")) elOut.textContent = command() || "nothing selected";
  }

  document.getElementById("all").addEventListener("click", () => {
    for (const row of rows) if (matches(row)) row.checked = true;
    render();
  });
  document.getElementById("none").addEventListener("click", () => {
    for (const row of rows) if (matches(row)) row.checked = false;
    render();
  });
  document.getElementById("top").addEventListener("click", () => {
    for (const row of rows) row.checked = row.depth === 0 && !row.known;
    render();
  });
  const partsBtn = document.getElementById("toggleParts");
  partsBtn.addEventListener("click", () => {
    hideParts = !hideParts;
    partsBtn.textContent = hideParts ? "Show internal parts" : "Hide internal parts";
    render();
  });

  document.getElementById("show").addEventListener("click", () => {
    elOut.classList.toggle("hidden");
    elOut.textContent = command() || "nothing selected";
  });

  document.getElementById("copy").addEventListener("click", async (event) => {
    const cmd = command();
    if (!cmd) return;
    const button = event.currentTarget;
    const restore = button.textContent;
    try {
      await navigator.clipboard.writeText(cmd);
      button.textContent = "Copied — paste it in your terminal";
    } catch {
      // Clipboard is blocked on file:// in some browsers; show it instead so
      // the user can still select it by hand.
      elOut.classList.remove("hidden");
      elOut.textContent = cmd;
      button.textContent = "Select the command below";
    }
    setTimeout(() => { button.textContent = restore; }, 2600);
  });

  q.addEventListener("input", render);
  render();
})();
</script>
</body>
</html>
`;
}
