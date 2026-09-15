/**
 * Dashboard renderer: one self-contained HTML file.
 *
 * Read-only by design. The manifest is files on disk, and a dashboard that
 * could write to it would need a server — which would turn a folder you can
 * clone and read in ten years into an app that must be running. So this view
 * ships the bundle inline and does filtering in the browser. No build, no
 * server, no network.
 */

const ESCAPES = { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" };

function esc(value) {
  return String(value ?? "").replace(/[&<>"']/g, (c) => ESCAPES[c]);
}

/** Inline the bundle safely: `</script>` inside data must not end the tag. */
function inlineJson(data) {
  return JSON.stringify(data)
    .replace(/</g, "\\u003c")
    .replace(/>/g, "\\u003e")
    .replace(/\u2028/g, "\\u2028")
    .replace(/\u2029/g, "\\u2029");
}

export async function renderDashboard(bundle) {
  const generated = new Date(bundle.generated).toISOString().slice(0, 10);

  return `<!doctype html>
<html lang="en" data-theme="auto">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Mother Brain</title>
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
    --green: #1f7a45;
    --amber: #9a6200;
    --gray: #75736d;
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
      --green: #6cc48d;
      --amber: #e0a955;
      --gray: #8b8984;
    }
  }
  * { box-sizing: border-box; }
  body {
    margin: 0;
    padding: 0;
    background: var(--bg);
    color: var(--text);
    font: 15px/1.55 var(--sans);
    -webkit-font-smoothing: antialiased;
  }
  .wrap { max-width: 1180px; margin: 0 auto; padding: 32px 20px 80px; }

  header { margin-bottom: 28px; }
  h1 {
    margin: 0 0 4px;
    font-size: 22px;
    letter-spacing: -0.01em;
    font-weight: 650;
  }
  .sub { color: var(--muted); font-size: 13px; }

  .stats {
    display: grid;
    grid-template-columns: repeat(auto-fit, minmax(130px, 1fr));
    gap: 10px;
    margin: 20px 0 24px;
  }
  .stat {
    background: var(--panel);
    border: 1px solid var(--border);
    border-radius: var(--radius);
    padding: 12px 14px;
  }
  .stat b { display: block; font-size: 22px; font-weight: 640; letter-spacing: -0.02em; }
  .stat span { color: var(--muted); font-size: 12px; text-transform: uppercase; letter-spacing: 0.04em; }

  .controls {
    display: flex;
    flex-wrap: wrap;
    gap: 8px;
    align-items: center;
    margin-bottom: 18px;
  }
  input[type="search"] {
    flex: 1 1 240px;
    min-width: 0;
    padding: 9px 12px;
    border: 1px solid var(--border);
    border-radius: var(--radius);
    background: var(--panel);
    color: var(--text);
    font: inherit;
    font-size: 14px;
  }
  input[type="search"]:focus { outline: 2px solid var(--accent); outline-offset: -1px; }
  select {
    padding: 9px 10px;
    border: 1px solid var(--border);
    border-radius: var(--radius);
    background: var(--panel);
    color: var(--text);
    font: inherit;
    font-size: 13px;
  }

  .facets { display: flex; flex-wrap: wrap; gap: 6px; margin-bottom: 20px; }
  .chip {
    border: 1px solid var(--border);
    background: var(--panel);
    color: var(--muted);
    border-radius: 999px;
    padding: 4px 11px;
    font-size: 12px;
    cursor: pointer;
    font-family: var(--mono);
  }
  .chip[aria-pressed="true"] {
    background: var(--accent);
    border-color: var(--accent);
    color: #fff;
  }
  .chip i { font-style: normal; opacity: 0.6; margin-left: 4px; }

  .grid { display: grid; gap: 12px; grid-template-columns: repeat(auto-fill, minmax(330px, 1fr)); }
  .card {
    background: var(--panel);
    border: 1px solid var(--border);
    border-radius: var(--radius);
    padding: 16px 16px 14px;
    display: flex;
    flex-direction: column;
    gap: 9px;
  }
  .card h2 { margin: 0; font-size: 16px; font-weight: 620; letter-spacing: -0.01em; }
  .tagline { color: var(--muted); font-size: 13.5px; margin: 0; }
  .meta { display: flex; flex-wrap: wrap; gap: 6px; align-items: center; font-size: 11.5px; }
  .tag {
    font-family: var(--mono);
    border: 1px solid var(--border);
    border-radius: 5px;
    padding: 1px 6px;
    color: var(--muted);
  }
  .dot { width: 7px; height: 7px; border-radius: 50%; display: inline-block; }
  .s-live, .s-shipped { background: var(--green); }
  .s-wip, .s-prototype { background: var(--amber); }
  .s-paused, .s-archived, .s-idea { background: var(--gray); }
  .status { font-family: var(--mono); color: var(--muted); }
  .links { display: flex; gap: 10px; font-size: 12.5px; margin-top: auto; padding-top: 4px; }
  .links a { color: var(--accent); text-decoration: none; }
  .links a:hover { text-decoration: underline; }
  .gap {
    font-size: 11.5px;
    color: var(--amber);
    font-family: var(--mono);
  }
  details summary {
    cursor: pointer;
    font-size: 12.5px;
    color: var(--muted);
    font-family: var(--mono);
  }
  details[open] summary { margin-bottom: 8px; }
  .prose { font-size: 13.5px; color: var(--text); }
  .prose h3 { font-size: 12px; text-transform: uppercase; letter-spacing: 0.05em; color: var(--faint); margin: 12px 0 3px; }
  .prose p { margin: 0 0 6px; }
  .empty { color: var(--muted); padding: 40px 0; text-align: center; }
  footer { margin-top: 44px; color: var(--faint); font-size: 12px; font-family: var(--mono); }
  footer code { background: var(--panel); border: 1px solid var(--border); border-radius: 4px; padding: 1px 5px; }
</style>
</head>
<body>
<div class="wrap">
  <header>
    <h1>Mother Brain</h1>
    <div class="sub">${bundle.counts.projects} projects · generated ${esc(generated)} · read-only view</div>
  </header>

  <div class="stats">
    <div class="stat"><b>${bundle.counts.projects}</b><span>catalogued</span></div>
    <div class="stat"><b>${bundle.counts.documented}</b><span>documented</span></div>
    <div class="stat"><b>${bundle.counts.public}</b><span>public</span></div>
    <div class="stat"><b>${bundle.counts.shipped}</b><span>shipped</span></div>
  </div>

  <div class="controls">
    <input type="search" id="q" placeholder="Search name, stack, prose…" autocomplete="off">
    <select id="sort">
      <option value="recent">Most recent</option>
      <option value="name">Name</option>
      <option value="status">Status</option>
    </select>
    <select id="narrative">
      <option value="all">All entries</option>
      <option value="done">Documented</option>
      <option value="todo">Needs prose</option>
    </select>
  </div>

  <div class="facets" id="facets"></div>
  <div class="grid" id="grid"></div>
  <div class="empty" id="empty" hidden>Nothing matches those filters.</div>

  <footer>
    Source of truth is <code>projects/*.md</code>. This page and <code>brain.json</code> are generated —
    run <code>brain build</code> to refresh.
  </footer>
</div>

<script id="brain-data" type="application/json">${inlineJson(bundle)}</script>
<script>
(() => {
  const bundle = JSON.parse(document.getElementById("brain-data").textContent);
  const projects = bundle.projects;
  const active = new Set();

  const grid = document.getElementById("grid");
  const empty = document.getElementById("empty");
  const facetBar = document.getElementById("facets");
  const q = document.getElementById("q");
  const sortSel = document.getElementById("sort");
  const narrSel = document.getElementById("narrative");

  // Facets: frameworks first, since they carry the most information, then any
  // ecosystem that no framework rule already covers (Go, Rust, WordPress…).
  const frameworkNames = new Set(Object.keys(bundle.index.frameworks || {}));
  const facetCounts = { ...(bundle.index.frameworks || {}) };
  for (const [eco, count] of Object.entries(bundle.index.ecosystem || {})) {
    if (!frameworkNames.has(eco)) facetCounts[eco] = count;
  }
  const facets = Object.entries(facetCounts)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 16);

  for (const [name, count] of facets) {
    const chip = document.createElement("button");
    chip.className = "chip";
    chip.type = "button";
    chip.setAttribute("aria-pressed", "false");
    chip.innerHTML = name + "<i>" + count + "</i>";
    chip.addEventListener("click", () => {
      if (active.has(name)) active.delete(name); else active.add(name);
      chip.setAttribute("aria-pressed", String(active.has(name)));
      render();
    });
    facetBar.append(chip);
  }

  const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => (
    { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]
  ));

  function matches(p) {
    const term = q.value.trim().toLowerCase();
    if (term) {
      const haystack = [
        p.name, p.tagline, p.kind, p.status, p.architecture, p.domain,
        (p.frameworks || []).join(" "), (p.ecosystem || []).join(" "),
        (p.tags || []).join(" "), p.narrative.text,
      ].join(" ").toLowerCase();
      if (!haystack.includes(term)) return false;
    }
    if (active.size) {
      const built = new Set([...(p.frameworks || []), ...(p.ecosystem || [])]);
      for (const needed of active) if (!built.has(needed)) return false;
    }
    const mode = narrSel.value;
    if (mode === "done" && !p.narrative.complete) return false;
    if (mode === "todo" && p.narrative.complete) return false;
    return true;
  }

  const STATUS_ORDER = ["live", "shipped", "wip", "prototype", "paused", "idea", "archived"];

  function sorted(list) {
    const mode = sortSel.value;
    return [...list].sort((a, b) => {
      if (mode === "name") return (a.name || "").localeCompare(b.name || "");
      if (mode === "status") {
        const d = STATUS_ORDER.indexOf(a.status) - STATUS_ORDER.indexOf(b.status);
        if (d !== 0) return d;
        return (a.name || "").localeCompare(b.name || "");
      }
      return String(b.last_active || "").localeCompare(String(a.last_active || ""));
    });
  }

  function card(p) {
    const el = document.createElement("article");
    el.className = "card";

    const links = [];
    if (p.links?.site) links.push('<a href="' + esc(p.links.site) + '" target="_blank" rel="noopener">site</a>');
    if (p.links?.repo) links.push('<a href="' + esc(p.links.repo) + '" target="_blank" rel="noopener">repo</a>');
    if (p.links?.demo) links.push('<a href="' + esc(p.links.demo) + '" target="_blank" rel="noopener">demo</a>');

    const sections = Object.entries(p.narrative.sections || {})
      .filter(([, text]) => text && text.trim())
      .map(([h, text]) => "<h3>" + esc(h) + "</h3><p>" + esc(text).slice(0, 700) + "</p>")
      .join("");

    el.innerHTML = [
      "<h2>" + esc(p.name) + "</h2>",
      p.tagline ? '<p class="tagline">' + esc(p.tagline) + "</p>" : "",
      '<div class="meta">',
      '<span class="dot s-' + esc(p.status) + '"></span>',
      '<span class="status">' + esc(p.status || "—") + "</span>",
      p.kind ? '<span class="tag">' + esc(p.kind) + "</span>" : "",
      (p.frameworks && p.frameworks.length ? p.frameworks : (p.ecosystem || []))
        .slice(0, 5).map((s) => '<span class="tag">' + esc(s) + "</span>").join(""),
      "</div>",
      p.narrative.complete ? "" : '<div class="gap">' + p.narrative.todos + " section" + (p.narrative.todos === 1 ? "" : "s") + " need prose</div>",
      sections ? "<details><summary>Read</summary><div class=\\"prose\\">" + sections + "</div></details>" : "",
      links.length ? '<div class="links">' + links.join("") + "</div>" : "",
    ].join("");

    return el;
  }

  function render() {
    const list = sorted(projects.filter(matches));
    grid.replaceChildren(...list.map(card));
    empty.hidden = list.length > 0;
  }

  q.addEventListener("input", render);
  sortSel.addEventListener("change", render);
  narrSel.addEventListener("change", render);
  render();
})();
</script>
</body>
</html>
`;
}
