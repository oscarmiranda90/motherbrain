/**
 * The ingest briefing.
 *
 * Writing a project's dossier needs two different kinds of work:
 *
 *   1. *collecting* the material — git history, entry points, dependencies,
 *      the data model, the docs. Mechanical, repeatable, identical every run.
 *   2. *judging* it — what problem this solves, which decision mattered, what
 *      transfers to other work. Only a model can do that.
 *
 * Mixing the two into one prompt gives inconsistent results at needless cost:
 * the agent re-invents how to explore a repository every single time. So this
 * module does all of (1) in plain code and hands over a briefing, leaving the
 * agent only (2).
 *
 * The briefing is also an artifact in its own right — reusable by any other
 * ingestion path later.
 */

import { readdir, readFile, stat } from "node:fs/promises";
import { join, basename, extname, relative } from "node:path";
import { execFile } from "node:child_process";
import { promisify } from "node:util";

const run = promisify(execFile);

const SKIP = new Set([
  "node_modules",
  ".git",
  "build",
  "dist",
  "out",
  "target",
  ".next",
  ".nuxt",
  ".dart_tool",
  ".gradle",
  "Pods",
  "vendor",
  "lib",
  "coverage",
  ".venv",
  "venv",
  "__pycache__",
  ".turbo",
  ".cache",
  "android",
  "ios",
  "macos",
  "windows",
  "linux",
  "web",
  "assets",
  "images",
  "fonts",
  ".expo",
]);

/** Files that tend to define a project's shape. */
const ENTRY_HINTS = [
  /^(main|index|app|server|cli)\.(js|ts|jsx|tsx|mjs|py|go|rs|dart)$/i,
  /^main\.dart$/i,
  /^app\.(tsx|jsx|vue|svelte)$/i,
  /^(layout|page)\.(tsx|jsx)$/i,
  /^__main__\.py$/i,
  /^manage\.py$/i,
];

/**
 * Generated files masquerading as source.
 *
 * `worker-configuration.d.ts` is 578KB of Cloudflare type definitions; listing
 * it as the largest source file points a writer at machine output instead of
 * at the project. Size is a good proxy for substance only once generated code
 * is excluded.
 */
const GENERATED = [
  /worker-configuration\.d\.ts$/i,
  /\.g\.dart$/i,
  /\.freezed\.dart$/i,
  /\.gr\.dart$/i,
  /\.pb\.(dart|ts|js|go)$/i,
  /\.generated\.[a-z]+$/i,
  /(^|\/)generated\//i,
  /\.min\.(js|css)$/i,
  /-lock\.(json|yaml)$/i,
  /\.d\.ts$/i,
  /(^|\/)__generated__\//i,
  /(^|\/)migrations?\/.*\.(js|ts)$/i,
];

function isGenerated(path) {
  return GENERATED.some((re) => re.test(path));
}

/** Names that usually carry the domain model. */
const MODEL_HINTS = [
  /schema\.(prisma|sql|ts|js|graphql)$/i,
  /^(models?|entities|domain|types)\.(ts|js|py|dart|go|rs)$/i,
  /migrations?$/i,
  /firestore\.rules$/i,
  /\.sql$/i,
];

async function git(cwd, args) {
  try {
    const { stdout } = await run("git", ["-C", cwd, ...args], {
      timeout: 10_000,
      maxBuffer: 4 * 1024 * 1024,
    });
    return stdout.trim();
  } catch {
    return null;
  }
}

async function readCapped(path, limit) {
  try {
    const text = await readFile(path, "utf8");
    if (text.length <= limit) return { text, truncated: false };
    return { text: text.slice(0, limit), truncated: true };
  } catch {
    return null;
  }
}

/**
 * Walk a project collecting a file inventory, without descending into
 * dependency or build trees.
 */
async function inventory(root, maxDepth = 4) {
  const files = [];
  const byExtension = new Map();
  let directories = 0;

  async function walk(dir, depth) {
    if (depth > maxDepth) return;
    let entries;
    try {
      entries = await readdir(dir, { withFileTypes: true });
    } catch {
      return;
    }
    directories += 1;

    for (const entry of entries) {
      if (entry.name.startsWith(".") && entry.name !== ".github") continue;
      const full = join(dir, entry.name);

      if (entry.isDirectory()) {
        if (SKIP.has(entry.name)) continue;
        await walk(full, depth + 1);
        continue;
      }

      const ext = extname(entry.name).toLowerCase();
      byExtension.set(ext, (byExtension.get(ext) ?? 0) + 1);

      let size = 0;
      try {
        size = (await stat(full)).size;
      } catch {
        /* unreadable */
      }

      files.push({ path: relative(root, full), name: entry.name, ext, size });
    }
  }

  await walk(root, 0);
  return { files, byExtension, directories };
}

/**
 * Collect everything a writer needs about one project.
 *
 * @param {object} entry   the manifest entry (for its `source.path`)
 * @param {object} [opts]
 * @param {number} [opts.docBudget=12000]  max characters of docs to include
 */
export async function collectBrief(entry, opts = {}) {
  const root = entry.source?.path;
  if (!root) throw new Error(`entry ${entry.id} has no source.path`);

  const docBudget = opts.docBudget ?? 12_000;
  const { files, byExtension, directories } = await inventory(root);

  // --- docs: the author's own words come first ---------------------------
  const docs = [];
  let spent = 0;
  for (const name of entry.source?.docs ?? []) {
    const remaining = docBudget - spent;
    if (remaining <= 500) break;
    const read = await readCapped(join(root, name), remaining);
    if (!read) continue;
    docs.push({ file: name, ...read });
    spent += read.text.length;
  }

  // --- entry points ------------------------------------------------------
  const entryPoints = files
    .filter((f) => ENTRY_HINTS.some((re) => re.test(f.name)))
    .slice(0, 12)
    .map((f) => f.path);

  // --- domain model ------------------------------------------------------
  const modelFiles = files
    .filter((f) => MODEL_HINTS.some((re) => re.test(f.name) || re.test(f.path)))
    .slice(0, 10)
    .map((f) => f.path);

  // --- largest source files: usually where the substance is --------------
  const CODE_EXT = new Set([
    ".ts", ".tsx", ".js", ".jsx", ".mjs", ".dart", ".py", ".go", ".rs",
    ".swift", ".kt", ".java", ".rb", ".php", ".vue", ".svelte",
  ]);
  const biggest = files
    .filter((f) => CODE_EXT.has(f.ext) && !isGenerated(f.path))
    .sort((a, b) => b.size - a.size)
    .slice(0, 15)
    .map((f) => ({ path: f.path, size: f.size }));

  // --- top-level shape ---------------------------------------------------
  let topLevel = [];
  try {
    const entries = await readdir(root, { withFileTypes: true });
    topLevel = entries
      .filter((e) => !e.name.startsWith("."))
      .map((e) => (e.isDirectory() ? `${e.name}/` : e.name))
      .sort();
  } catch {
    /* unreadable */
  }

  // --- git: what the history says about how this was built ---------------
  const history = { commits: [], span: null, cadence: null, files_changed: null };
  if (entry.source?.git) {
    const log = await git(root, ["log", "--format=%cs\t%s", "--max-count=40"]);
    if (log) {
      history.commits = log
        .split("\n")
        .filter(Boolean)
        .map((line) => {
          const [date, ...rest] = line.split("\t");
          return { date, subject: rest.join("\t") };
        });
    }
    const first = await git(root, ["log", "--reverse", "--format=%cs", "--max-count=1"]);
    const last = await git(root, ["log", "-1", "--format=%cs"]);
    if (first && last) history.span = { first, last };

    const changed = await git(root, [
      "log",
      "--format=",
      "--name-only",
      "--max-count=60",
    ]);
    if (changed) {
      const counts = new Map();
      for (const file of changed.split("\n").filter(Boolean)) {
        counts.set(file, (counts.get(file) ?? 0) + 1);
      }
      history.files_changed = [...counts.entries()]
        .sort((a, b) => b[1] - a[1])
        .slice(0, 12)
        .map(([file, n]) => ({ file, touches: n }));
    }
  }

  // --- dependency manifests, verbatim ------------------------------------
  const manifests = [];
  for (const name of [
    "package.json",
    "pubspec.yaml",
    "go.mod",
    "Cargo.toml",
    "pyproject.toml",
    "requirements.txt",
    "composer.json",
    "Gemfile",
  ]) {
    const read = await readCapped(join(root, name), 6_000);
    if (read) manifests.push({ file: name, ...read });
  }

  // --- scripts: how the project is actually run --------------------------
  let scripts = null;
  const pkg = manifests.find((m) => m.file === "package.json");
  if (pkg) {
    try {
      scripts = JSON.parse(pkg.text).scripts ?? null;
    } catch {
      /* malformed */
    }
  }

  const extensions = [...byExtension.entries()]
    .filter(([ext]) => ext)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 12)
    .map(([ext, n]) => ({ ext, files: n }));

  return {
    id: entry.id,
    name: entry.name,
    path: root,
    known: {
      kind: entry.kind,
      ecosystem: entry.ecosystem ?? [],
      frameworks: entry.frameworks ?? [],
      deploy: entry.source?.deploy ?? [],
      remote: entry.source?.remote ?? null,
      structure: entry.source?.structure ?? "project",
      part_of: entry.source?.part_of ?? null,
    },
    shape: {
      top_level: topLevel,
      directories,
      file_count: files.length,
      extensions,
    },
    entry_points: entryPoints,
    domain_model: modelFiles,
    largest_source_files: biggest,
    scripts,
    manifests,
    docs,
    docs_skipped: entry.source?.docsSkipped ?? [],
    images: Array.isArray(entry.images) ? entry.images : [],
    history,
    collected: new Date().toISOString(),
  };
}

/**
 * Render a briefing as Markdown for an agent to read.
 *
 * Markdown rather than JSON because the agent's job here is to read and judge,
 * and prose-shaped input produces better judgement than a deeply nested object.
 */
export function renderBrief(brief) {
  const out = [];
  const p = (...lines) => out.push(...lines);

  p(`# Ingest briefing: ${brief.name}`, "");
  p(`Path: \`${brief.path}\``);
  p(`Collected: ${brief.collected.slice(0, 10)}`, "");

  p("## What the scanner already knows", "");
  p(`- kind: ${brief.known.kind}`);
  p(`- ecosystem: ${brief.known.ecosystem.join(", ") || "—"}`);
  p(`- frameworks: ${brief.known.frameworks.join(", ") || "—"}`);
  if (brief.known.deploy.length) p(`- deploy: ${brief.known.deploy.join(", ")}`);
  if (brief.known.remote) p(`- remote: ${brief.known.remote}`);
  if (brief.known.structure !== "project") {
    p(`- structure: ${brief.known.structure}${brief.known.part_of ? ` of ${brief.known.part_of}` : ""}`);
  }
  p("");

  p("## Shape", "");
  p(`${brief.shape.file_count} files across ${brief.shape.directories} directories.`, "");
  p("Top level:", "");
  p("```");
  p(brief.shape.top_level.join("  ") || "(empty)");
  p("```", "");
  if (brief.shape.extensions.length) {
    p(
      "By extension: " +
        brief.shape.extensions.map((e) => `${e.ext} ${e.files}`).join(", "),
      "",
    );
  }

  if (brief.entry_points.length) {
    p("## Entry points", "");
    for (const file of brief.entry_points) p(`- \`${file}\``);
    p("");
  }

  if (brief.domain_model.length) {
    p("## Domain model / schema files", "");
    for (const file of brief.domain_model) p(`- \`${file}\``);
    p("");
  }

  if (brief.largest_source_files.length) {
    p("## Largest source files", "");
    p("Where the substance usually is — read these before writing.", "");
    for (const f of brief.largest_source_files) {
      p(`- \`${f.path}\` (${(f.size / 1024).toFixed(1)}KB)`);
    }
    p("");
  }

  if (brief.scripts) {
    p("## Scripts", "");
    p("```json");
    p(JSON.stringify(brief.scripts, null, 2));
    p("```", "");
  }

  if (brief.history.span) {
    p("## History", "");
    p(`Active from ${brief.history.span.first} to ${brief.history.span.last}.`, "");
    if (brief.history.files_changed?.length) {
      p("Most-touched files (recent 60 commits):", "");
      for (const f of brief.history.files_changed) p(`- \`${f.file}\` — ${f.touches}`);
      p("");
    }
    if (brief.history.commits.length) {
      p("Recent commit subjects:", "");
      p("```");
      for (const c of brief.history.commits.slice(0, 30)) p(`${c.date}  ${c.subject}`);
      p("```", "");
    }
  }

  if (brief.manifests.length) {
    p("## Dependency manifests", "");
    for (const m of brief.manifests) {
      p(`### ${m.file}${m.truncated ? " (truncated)" : ""}`, "");
      p("```");
      p(m.text.trim());
      p("```", "");
    }
  }

  if (brief.docs.length) {
    p("## The author's own documentation", "");
    p(
      "Their words outrank anything inferred from the code. Summarise what each",
      "one contains; the full text travels with the entry.",
      "",
    );
    for (const d of brief.docs) {
      p(`### ${d.file}${d.truncated ? " (truncated)" : ""}`, "");
      p(d.text.trim(), "");
    }
  }

  if (brief.images?.length) {
    const pending = brief.images.filter((i) => !i.confirmed);
    p("## Images awaiting the author's confirmation", "");
    p(
      "Found in directories that conventionally hold material made for an",
      "audience. **None of these are published yet.** A screenshot can expose a",
      "customer's name, an email or a token in a URL bar, and no text search",
      "will catch it — only a person looking at the picture will.",
      "",
      "Show this list to the author. For each one they approve, set",
      "`confirmed: true` and write an `alt` describing what it shows.",
      "",
    );
    for (const image of brief.images) {
      const size = image.bytes ? ` (${(image.bytes / 1024).toFixed(0)}KB)` : "";
      const mark = image.confirmed ? "[confirmed]" : "[ ]";
      const heavy = image.needs_optimising ? " — re-encoded on publish" : "";
      p(`- ${mark} \`${image.path}\`${size}${heavy}`);
    }
    if (pending.length) {
      p("", `${pending.length} awaiting review.`, "");
    } else {
      p("");
    }
  }

  if (brief.docs_skipped?.length) {
    p("## Documents not carried", "");
    p(
      "Working artifacts rather than descriptions of the project. If one of",
      "these does describe the project, the author can add it to",
      "`include_docs` for this entry.",
      "",
    );
    for (const d of brief.docs_skipped) p(`- \`${d.path}\` — ${d.reason}`);
    p("");
  }

  p("---", "");
  p("## Your task", "");
  p(
    "Read the files named above — this briefing is a map, not a substitute for",
    "the code. Then fill the entry's sections, and write a one-line summary of",
    "what each document contains.",
    "",
    "**Describe, do not assess.** Every section asks for something a reader can",
    "verify by opening the repository: what the software does, how it is",
    "assembled, what state it is in. Not which decisions were good, not what",
    "lesson it teaches. Whoever consumes this brain will draw their own",
    "conclusions with their own prompts — the job here is to give them facts",
    "accurate enough to reason over.",
    "",
    "**Never invent.** No metric the project does not state, no users it does",
    "not have, no feature that is planned rather than built. Record absence as",
    "absence: \"no test suite\" and \"no usage data\" are findings.",
    "",
    "**Document summaries are inventories, not reviews.** \"Colour tokens,",
    "typography, screen specifications\" — what is inside, so a reader can",
    "decide whether to open it. The documents themselves travel in full, so the",
    "summary never needs to substitute for them.",
    "",
    "Ask the author what only they know: whether it shipped, who uses it, why it",
    "was abandoned, what it earned.",
    "",
  );

  return out.join("\n");
}
