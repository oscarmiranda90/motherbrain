/**
 * The published view: an encyclopedia of someone's work.
 *
 * This is a different artifact from `render.js`, which is a control panel for
 * the person maintaining the brain — grid of cards, filters, "needs prose"
 * warnings. Useful locally, wrong in public: a reader does not care which of
 * your entries are unfinished, and a dashboard does not read like a body of
 * work.
 *
 * So this renders an article per project, a contents index, and cross-links —
 * an encyclopedia you can hand someone as a URL. Same files, same publish
 * boundary; only the presentation differs.
 *
 * Still one self-contained HTML file with no network calls, because the whole
 * point is that it can sit on any static host, forever, and keep working.
 */

const ESCAPES = { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" };

function esc(value) {
  return String(value ?? "").replace(/[&<>"']/g, (c) => ESCAPES[c]);
}

function inlineJson(data) {
  return JSON.stringify(data)
    .replace(/</g, "\\u003c")
    .replace(/>/g, "\\u003e")
    .replace(/\u2028/g, "\\u2028")
    .replace(/\u2029/g, "\\u2029");
}

/**
 * Merge the catalogue with the dossiers, so the page carries full articles.
 *
 * A published brain is small — the whole point of the two-tier split is that
 * agents fetch dossiers on demand — but a *reader* clicking between projects
 * should never wait on a request, and a static host cannot serve a partial
 * page. So the wiki inlines everything it has.
 *
 * @param {object} bundle             the redacted public bundle
 * @param {Map<string,object>} dossiers  id -> redacted full project
 */
export function buildWikiPayload(bundle, dossiers = new Map()) {
  return {
    title: bundle.title ?? "Project brain",
    author: bundle.author ?? null,
    generated: bundle.generated,
    counts: bundle.counts ?? {},
    index: bundle.index ?? {},
    projects: bundle.projects.map((project) => {
      const full = dossiers.get(project.id);
      return {
        ...project,
        sections: full?.dossier?.sections ?? {},
      };
    }),
  };
}

export function renderWiki(payload) {
  const year = new Date(payload.generated ?? Date.now()).getFullYear();

  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${esc(payload.title)}</title>
<meta name="description" content="${esc(
    `${payload.counts.projects ?? 0} projects: what each one is, the problem it solves, and how it is built.`,
  )}">
<style>
  :root {
    color-scheme: light dark;
    --bg: #fbfbf9;
    --panel: #ffffff;
    --border: #e3e1dc;
    --rule: #ece9e4;
    --text: #17171a;
    --muted: #5f5e5a;
    --faint: #91908a;
    --link: #1f4fd8;
    --accent: #1f4fd8;
    --mark: #fdf3d3;
    --serif: "Iowan Old Style", "Palatino Linotype", Palatino, Georgia, "Times New Roman", serif;
    --sans: -apple-system, BlinkMacSystemFont, "Segoe UI", Inter, system-ui, sans-serif;
    --mono: ui-monospace, SFMono-Regular, "SF Mono", Menlo, monospace;
  }
  @media (prefers-color-scheme: dark) {
    :root {
      --bg: #131314;
      --panel: #1a1a1b;
      --border: #2d2d2e;
      --rule: #262627;
      --text: #eceae6;
      --muted: #a6a49e;
      --faint: #74736e;
      --link: #86a6f7;
      --accent: #86a6f7;
      --mark: #3a331c;
    }
  }
  * { box-sizing: border-box; }
  html { scroll-behavior: smooth; }
  body {
    margin: 0;
    background: var(--bg);
    color: var(--text);
    font: 17px/1.62 var(--serif);
    -webkit-font-smoothing: antialiased;
    /* A single long token — a path, a package name — must never be able to
       widen the page and push every other line off-screen. */
    overflow-wrap: break-word;
  }

  /* --- layout: contents rail + article column ------------------------- */
  .shell { display: grid; grid-template-columns: 250px minmax(0, 1fr); gap: 0; }
  @media (max-width: 860px) { .shell { grid-template-columns: 1fr; } }

  .rail {
    position: sticky; top: 0; align-self: start;
    height: 100vh; overflow-y: auto;
    border-right: 1px solid var(--border);
    padding: 26px 18px 40px;
    background: var(--panel);
  }
  @media (max-width: 860px) {
    /* The rail is navigation for a long page. On a phone it would fill the
       first screen before the reader saw a single word, so it moves below the
       articles and stops being sticky. */
    .shell { display: flex; flex-direction: column; }
    .rail {
      position: static; height: auto; order: 2;
      border-right: 0; border-top: 1px solid var(--border);
      padding: 22px 18px 40px;
    }
    /* A flex child starts at min-width:auto, so it refuses to shrink below its
       content's width — and .inner asks for 44rem. On a 420px screen that
       pushed every line past the right edge. Both levels need the override. */
    .col { order: 1; padding-bottom: 20px; min-width: 0; width: 100%; }
    .inner { max-width: 100%; }
  }
  .rail h2 {
    font: 600 11px/1.4 var(--sans);
    letter-spacing: 0.09em; text-transform: uppercase;
    color: var(--faint); margin: 20px 0 7px;
  }
  .rail h2:first-of-type { margin-top: 14px; }
  .rail ol { list-style: none; margin: 0; padding: 0; }
  .rail li { margin: 0 0 1px; }
  .rail a {
    display: block; padding: 3px 7px; margin-left: -7px;
    border-radius: 5px; color: var(--text); text-decoration: none;
    font: 14px/1.4 var(--sans);
  }
  .rail a:hover { background: var(--rule); }
  .rail a.on { background: var(--mark); font-weight: 600; }
  .rail .n { color: var(--faint); font-size: 12px; }

  .col { padding: 0 0 120px; min-width: 0; }
  .inner { max-width: 44rem; margin: 0 auto; padding: 0 22px; min-width: 0; }

  /* --- masthead -------------------------------------------------------- */
  header.top { padding: 62px 0 30px; border-bottom: 1px solid var(--border); margin-bottom: 40px; }
  header.top h1 { font-size: 2.35rem; line-height: 1.12; margin: 0 0 10px; letter-spacing: -0.02em; font-weight: 600; }
  header.top .by { font: 15px/1.5 var(--sans); color: var(--muted); }
  header.top .stats { font: 13px/1.6 var(--sans); color: var(--faint); margin-top: 14px; }
  header.top .lede { margin: 18px 0 0; color: var(--muted); font-size: 1.02rem; }

  /* --- search ---------------------------------------------------------- */
  .find { margin: 0 0 34px; }
  .find input {
    width: 100%; padding: 10px 13px;
    font: 15px var(--sans); color: var(--text);
    background: var(--panel); border: 1px solid var(--border); border-radius: 8px;
  }
  .find input:focus { outline: 2px solid var(--accent); outline-offset: -1px; }

  /* --- articles -------------------------------------------------------- */
  article { padding: 0 0 18px; margin: 0 0 50px; border-bottom: 1px solid var(--rule); scroll-margin-top: 18px; }
  article:last-of-type { border-bottom: 0; }
  article h2 {
    font-size: 1.62rem; line-height: 1.2; margin: 0 0 6px;
    letter-spacing: -0.015em; font-weight: 600;
  }
  article h2 a { color: inherit; text-decoration: none; }
  article h2 a:hover { color: var(--link); }
  .tagline { color: var(--muted); font-size: 1.05rem; margin: 0 0 14px; font-style: italic; }

  .facts {
    font: 13px/1.85 var(--sans); color: var(--muted);
    border-left: 2px solid var(--border); padding: 2px 0 2px 13px; margin: 0 0 20px;
  }
  .facts b { color: var(--text); font-weight: 600; }
  .facts > div {
    display: grid; grid-template-columns: 104px minmax(0, 1fr); gap: 0 10px;
  }
  .facts .k {
    color: var(--faint); font-size: 12px;
    letter-spacing: 0.02em; text-transform: uppercase;
    /* The longest label is ARCHITECTURE. In a 92px column it broke across two
       lines mid-word, which reads as a rendering fault rather than a label. */
    overflow-wrap: normal; word-break: keep-all; hyphens: none;
  }
  /* A long value — a framework list, an architecture sentence — must wrap
     under its label rather than pushing the row past the screen edge. */
  .facts .v { min-width: 0; overflow-wrap: anywhere; }
  @media (max-width: 560px) {
    .facts > div { grid-template-columns: minmax(0, 1fr); gap: 0; }
    .facts .k { margin-top: 6px; }
  }

  .lead { font-size: 1.08rem; margin: 0 0 22px; }

  section.part { margin: 0 0 20px; }
  section.part h3 {
    font: 600 11.5px/1.4 var(--sans);
    letter-spacing: 0.085em; text-transform: uppercase;
    color: var(--faint); margin: 0 0 6px;
  }
  section.part p { margin: 0 0 10px; }
  section.part p:last-child { margin-bottom: 0; }
  section.part ul { margin: 0 0 10px; padding-left: 20px; }
  section.part li { margin: 0 0 4px; }
  .prose code, section.part code, .lead code {
    font: 0.86em var(--mono); background: var(--rule);
    padding: 1px 4px; border-radius: 4px; overflow-wrap: anywhere;
  }
  section.part strong, .lead strong { color: var(--text); font-weight: 650; }

  .chips { display: flex; flex-wrap: wrap; gap: 5px; margin: 0 0 16px; }
  .chip {
    font: 12px var(--mono); color: var(--muted);
    border: 1px solid var(--border); border-radius: 999px; padding: 2px 9px;
    text-decoration: none;
  }
  .chip:hover { border-color: var(--accent); color: var(--accent); }

  .links { font: 14px var(--sans); margin: 18px 0 0; display: flex; flex-wrap: wrap; gap: 16px; }
  .links a { color: var(--link); text-decoration: none; }
  .links a:hover { text-decoration: underline; }
  .links a::after { content: " ↗"; font-size: 11px; opacity: 0.55; }

  .seealso { font: 13.5px/1.7 var(--sans); color: var(--muted); margin: 16px 0 0; }
  .seealso a { color: var(--link); text-decoration: none; }
  .seealso a:hover { text-decoration: underline; }

  .stub { font: 13.5px/1.6 var(--sans); color: var(--faint); font-style: italic; }
  /* Floated beside the prose it illustrates, the way an encyclopedia does it.
     A phone-shaped screenshot is tall, so the width is modest and the text
     wraps around rather than being pushed down the page. */
  figure.shot {
    float: right; clear: right;
    width: 172px; margin: 4px 0 14px 20px;
  }
  figure.shot img {
    display: block; width: 100%; height: auto;
    border: 1px solid var(--border); border-radius: 8px;
    background: var(--panel);
  }
  figure.shot figcaption {
    font: 11.5px/1.45 var(--sans); color: var(--faint); margin-top: 6px;
  }
  /* The opening picture sits beside the facts table and reads as the article's
     infobox, so it carries more weight than an in-text illustration. */
  figure.shot.lead-shot { width: 244px; margin-top: 0; }
  /* A section must not have its heading pulled up beside a previous float. */
  section.part { clear: none; }
  article { overflow: hidden; }
  @media (max-width: 700px) {
    /* At phone width a 172px float leaves too little room for a line of text,
       so pictures become full-width blocks in reading order. */
    figure.shot, figure.shot.lead-shot {
      float: none; width: 100%; max-width: 320px; margin: 0 auto 18px;
    }
    figure.shot figcaption { text-align: center; }
  }
  ul.docs { list-style: none; margin: 0; padding: 0; font: 13.5px/1.75 var(--sans); }
  ul.docs code { font: 12.5px var(--mono); color: var(--text); }
  ul.docs .n { color: var(--faint); font-size: 12px; }

  mark { background: var(--mark); color: inherit; padding: 0 1px; }
  .none { padding: 40px 0; color: var(--muted); font: 15px var(--sans); }
  footer {
    border-top: 1px solid var(--border); margin-top: 36px; padding: 22px 0 0;
    font: 12.5px/1.7 var(--sans); color: var(--faint);
  }
  footer code { font-family: var(--mono); font-size: 11.5px; }
  .hidden { display: none !important; }
</style>
</head>
<body>
<div class="shell">
  <nav class="rail" id="rail" aria-label="Contents"></nav>
  <div class="col">
    <div class="inner">
      <header class="top">
        <h1>${esc(payload.title)}</h1>
        ${payload.author ? `<div class="by">by ${esc(payload.author)}</div>` : ""}
        <p class="lede">What each project is, the problem it solves, and how it is built.</p>
        <div class="stats" id="stats"></div>
      </header>

      <div class="find">
        <input type="search" id="q" placeholder="Search projects, ideas, frameworks…" autocomplete="off">
      </div>

      <main id="main"></main>
      <div class="none hidden" id="none">Nothing matches that search.</div>

      <footer>
        Generated from a Mother Brain manifest${payload.generated ? ` · ${esc(payload.generated.slice(0, 10))}` : ""}.
        Machine-readable at <code>brain.json</code>.
        No source code, credentials, or file paths are published.
        <br>© ${year}${payload.author ? ` ${esc(payload.author)}` : ""}
      </footer>
    </div>
  </div>
</div>

<script id="wiki-data" type="application/json">${inlineJson(payload)}</script>
<script>
(() => {
  const data = JSON.parse(document.getElementById("wiki-data").textContent);
  const projects = data.projects;

  const main = document.getElementById("main");
  const rail = document.getElementById("rail");
  const none = document.getElementById("none");
  const stats = document.getElementById("stats");
  const q = document.getElementById("q");

  const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => (
    { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]
  ));

  const byId = new Map(projects.map((p) => [p.id, p]));

  // Order the encyclopedia by how much it can actually tell a reader, then by
  // recency. A written-up project earns the top of the page.
  const depth = (p) => Object.keys(p.sections || {}).length + (p.card ? 1 : 0);
  const ordered = [...projects].sort((a, b) => {
    const d = depth(b) - depth(a);
    if (d !== 0) return d;
    return String(b.last_active || "").localeCompare(String(a.last_active || ""));
  });

  const c = data.counts || {};
  stats.textContent = [
    (c.projects || 0) + " projects",
    c.documented ? c.documented + " written up" : null,
    c.shipped ? c.shipped + " shipped" : null,
  ].filter(Boolean).join(" · ");

  // Section order follows how a reader wants it, not alphabetical.
  const ORDER = [
    "What it is", "The problem", "What it proposes", "Architecture",
    "Notable decisions", "Hard problems", "Transferable insight", "Outcome",
  ];

  // The entries are Markdown, so the small subset that actually appears in
  // them has to be rendered. Escaping first and formatting after means no
  // authored text can inject markup: the tags below are the only ones the
  // page can produce.
  function inline(text) {
    return esc(text)
      .replace(/\`([^\`]+)\`/g, "<code>$1</code>")
      .replace(/\\*\\*([^*]+)\\*\\*/g, "<strong>$1</strong>")
      .replace(/(^|[\\s(])\\*([^*\\s][^*]*)\\*(?=[\\s.,;:)]|$)/g, "$1<em>$2</em>");
  }

  function paragraphs(text) {
    const blocks = String(text).split(/\\n\\s*\\n/).map((s) => s.trim()).filter(Boolean);

    return blocks
      .map((block) => {
        const lines = block.split("\\n").map((l) => l.trim());

        // A bullet list, which the dossier uses for constraints and
        // requirements.
        if (lines.every((l) => /^[-*]\\s+/.test(l))) {
          return "<ul>" + lines.map((l) => "<li>" + inline(l.replace(/^[-*]\\s+/, "")) + "</li>").join("") + "</ul>";
        }

        // A paragraph that opens with a bold lead-in reads as a labelled
        // item, which is how "What it does" is written.
        return "<p>" + inline(lines.join(" ")) + "</p>";
      })
      .join("");
  }

  function facts(p) {
    const rows = [];
    const add = (k, v) => {
      if (v) rows.push('<div><span class="k">' + k + '</span><span class="v">' + v + "</span></div>");
    };

    add("Type", p.kind && p.kind !== "unknown" ? "<b>" + esc(p.kind) + "</b>" : null);
    add("Status", p.status ? "<b>" + esc(p.status) + "</b>" : null);
    // Two rows, not one with a fallback. Showing frameworks and only falling
    // back to the ecosystem when it was empty meant a Flutter project that
    // also used Firebase read "Built with: Firebase, Riverpod" — the
    // toolchain, the first thing a reader wants, missing entirely.
    // (No backticks in here: this comment lives inside a template literal.)
    add("Toolchain", (p.ecosystem || []).length ? esc(p.ecosystem.join(", ")) : null);
    add("Built with", (p.frameworks || []).length ? esc(p.frameworks.join(", ")) : null);
    add("Architecture", p.architecture ? esc(p.architecture) : null);
    add("Domain", p.domain ? esc(p.domain) : null);
    add("Does", (p.capabilities || []).length ? esc(p.capabilities.join(", ")) : null);

    const span = p.started && p.last_active && p.started !== p.last_active
      ? esc(p.started) + " – " + esc(p.last_active)
      : esc(p.last_active || p.started || "");
    add("Active", span || null);

    return rows.length ? '<div class="facts">' + rows.join("") + "</div>" : "";
  }

  function article(p) {
    const el = document.createElement("article");
    el.id = p.id;

    const sections = p.sections || {};
    const written = ORDER.filter((h) => sections[h]);
    const extra = Object.keys(sections).filter((h) => !ORDER.includes(h));

    // An encyclopedia floats a picture beside the prose it illustrates, rather
    // than stacking every image at the end. Images name the section they
    // belong to; the rest open the article, like an infobox.
    const byHeading = new Map();
    const opening = [];
    for (const img of p.images || []) {
      if (img.section && sections[img.section]) {
        if (!byHeading.has(img.section)) byHeading.set(img.section, []);
        byHeading.get(img.section).push(img);
      } else {
        opening.push(img);
      }
    }

    const figure = (img, extraClass) =>
      '<figure class="shot' + (extraClass ? " " + extraClass : "") + '">' +
      '<img loading="lazy" decoding="async" src="' + esc(img.src) +
      '" alt="' + esc(img.alt || p.name) + '">' +
      (img.alt ? "<figcaption>" + esc(img.alt) + "</figcaption>" : "") +
      "</figure>";

    const parts = [];
    parts.push('<h2><a href="#' + esc(p.id) + '">' + esc(p.name) + "</a></h2>");
    if (p.tagline) parts.push('<p class="tagline">' + esc(p.tagline) + "</p>");

    // The opening image sits beside the facts and the lead, the way an
    // infobox does: it is the picture of the thing itself.
    if (opening.length) parts.push(figure(opening[0], "lead-shot"));
    parts.push(facts(p));

    // The card is the lead paragraph — it was written to stand alone.
    if (p.card) parts.push('<div class="lead">' + paragraphs(p.card) + "</div>");

    // Any further unplaced images follow the lead, still floated.
    for (const img of opening.slice(1)) parts.push(figure(img));

    for (const heading of [...written, ...extra]) {
      const illustrations = (byHeading.get(heading) || []).map((img) => figure(img)).join("");
      parts.push(
        '<section class="part"><h3>' + esc(heading) + "</h3>" +
        illustrations +
        paragraphs(sections[heading]) + "</section>"
      );
    }

    if (!p.card && written.length === 0) {
      parts.push('<p class="stub">This entry has not been written up yet.</p>');
    }

    const tags = [...(p.capabilities || []), ...(p.patterns || []), ...(p.tags || [])];
    if (tags.length) {
      parts.push('<div class="chips">' +
        tags.map((t) => '<a class="chip" href="#" data-term="' + esc(t) + '">' + esc(t) + "</a>").join("") +
        "</div>");
    }

    const links = [];
    if (p.links?.site) links.push('<a href="' + esc(p.links.site) + '" rel="noopener">Website</a>');
    if (p.links?.demo) links.push('<a href="' + esc(p.links.demo) + '" rel="noopener">Demo</a>');
    if (p.links?.repo) links.push('<a href="' + esc(p.links.repo) + '" rel="noopener">Source</a>');
    if (p.links?.docs) links.push('<a href="' + esc(p.links.docs) + '" rel="noopener">Docs</a>');
    if (links.length) parts.push('<div class="links">' + links.join("") + "</div>");

    // The author's own documents, as an inventory. The full text is in the
    // dossier for agents; a reader gets to see what exists and how long it is.
    const docs = (p.documents || []).filter((d) => !d.missing);
    if (docs.length) {
      parts.push(
        '<section class="part"><h3>Documents</h3><ul class="docs">' +
          docs
            .map((d) => {
              const words = d.words ? ' <span class="n">' + d.words + " words</span>" : "";
              const summary = d.summary ? " — " + esc(d.summary) : "";
              return "<li><code>" + esc(d.path) + "</code>" + words + summary + "</li>";
            })
            .join("") +
          "</ul></section>",
      );
    }

    const related = (p.relates_to || []).filter((id) => byId.has(id));
    if (related.length) {
      parts.push('<div class="seealso"><b>See also:</b> ' +
        related.map((id) => '<a href="#' + esc(id) + '">' + esc(byId.get(id).name) + "</a>").join(", ") +
        "</div>");
    }

    el.innerHTML = parts.join("");
    return el;
  }

  // Highlights whichever entry the reader is currently on. Declared before
  // render(), which re-observes the freshly built articles on every pass.
  const spy = new IntersectionObserver((entries) => {
    for (const entry of entries) {
      if (!entry.isIntersecting) continue;
      for (const a of rail.querySelectorAll("a.on")) a.classList.remove("on");
      const link = rail.querySelector('[data-id="' + entry.target.id + '"]');
      if (link) link.classList.add("on");
    }
  }, { rootMargin: "-10% 0px -80% 0px" });

  function matches(p) {
    const term = q.value.trim().toLowerCase();
    if (!term) return true;
    const hay = [
      p.name, p.tagline, p.kind, p.status, p.architecture, p.domain, p.card,
      (p.frameworks || []).join(" "), (p.ecosystem || []).join(" "),
      (p.capabilities || []).join(" "), (p.patterns || []).join(" "),
      (p.tags || []).join(" "), Object.values(p.sections || {}).join(" "),
    ].join(" ").toLowerCase();
    return hay.includes(term);
  }

  function buildRail(visible) {
    const parts = ['<h2>Contents</h2><ol>'];
    for (const p of visible) {
      parts.push('<li><a href="#' + esc(p.id) + '" data-id="' + esc(p.id) + '">' + esc(p.name) + "</a></li>");
    }
    parts.push("</ol>");

    // Facets double as navigation: click a framework, see those projects.
    //
    // The ecosystem is listed separately from the frameworks because they
    // answer different questions: the toolchain a project is written for
    // (flutter, node, python) versus the libraries chosen inside it
    // (Firebase, Riverpod, React). Reading only the frameworks index hid the
    // single most important fact about every Flutter project on the page —
    // ten of nineteen, and the rail never said Flutter once.
    const groups = data.index || {};
    for (const [label, key] of [
      ["By capability", "capabilities"],
      ["By pattern", "patterns"],
      ["Toolchain", "ecosystem"],
      ["Built with", "frameworks"],
    ]) {
      const group = groups[key];
      if (!group || Object.keys(group).length === 0) continue;
      const rows = Object.entries(group)
        .filter(([, ids]) => ids.length > 1)
        .sort((a, b) => b[1].length - a[1].length)
        .slice(0, 12);
      if (rows.length === 0) continue;
      parts.push("<h2>" + label + "</h2><ol>");
      for (const [name, ids] of rows) {
        parts.push('<li><a href="#" data-term="' + esc(name) + '">' + esc(name) +
          ' <span class="n">' + ids.length + "</span></a></li>");
      }
      parts.push("</ol>");
    }

    rail.innerHTML = parts.join("");
  }

  function render() {
    const visible = ordered.filter(matches);
    main.replaceChildren(...visible.map(article));
    none.classList.toggle("hidden", visible.length > 0);
    buildRail(visible);
    // Re-observe after every render: the articles are new elements.
    for (const el of main.querySelectorAll("article")) spy.observe(el);
  }

  // Clicking a facet anywhere filters to it.
  document.addEventListener("click", (event) => {
    const link = event.target.closest("[data-term]");
    if (!link) return;
    event.preventDefault();
    q.value = link.dataset.term;
    render();
    window.scrollTo({ top: 0, behavior: "smooth" });
  });

  q.addEventListener("input", render);
  render();

  if (location.hash) {
    const target = document.getElementById(location.hash.slice(1));
    if (target) target.scrollIntoView();
  }
})();
</script>
</body>
</html>
`;
}
