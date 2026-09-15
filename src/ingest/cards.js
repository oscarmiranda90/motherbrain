/**
 * The card pass.
 *
 * Filling a brain project by project, each with a full dossier, is the
 * expensive way round — and it leaves the catalogue useless until the last one
 * is done. The two-tier schema exists precisely so that does not have to
 * happen: a ~120-word card per project makes `index.capabilities`,
 * `index.patterns` and `index.related` work, which is what answers "what have
 * I built", a CV, or an idea bank. Dossiers are for the few projects someone
 * later wants an article about.
 *
 * So this collects a *small* briefing for every unwritten project and puts them
 * in one document. Measured on a real 22-project drive, the documentation those
 * projects carry totals about 17,000 words — the whole batch fits in one pass,
 * where the deep briefing for a single project runs 20,000 characters on its
 * own.
 *
 * What a card needs is what a project *is*. That comes from the author's own
 * docs, the shape of the tree, and the dependency list. It does not need the
 * largest source files, the full manifests, or forty commit subjects.
 */

import { readFile, readdir, stat } from "node:fs/promises";
import { join, extname } from "node:path";

/** Characters of the author's own prose to include per project. */
const DOC_BUDGET = 2_400;

/** Directories that say something about what a project contains. */
const SHAPE_SKIP = new Set([
  "node_modules",
  ".git",
  "build",
  "dist",
  "out",
  ".next",
  ".dart_tool",
  "Pods",
  "vendor",
  "coverage",
  ".venv",
  "__pycache__",
  ".turbo",
  ".cache",
  "ios",
  "android",
  "macos",
  "windows",
  "linux",
  "web",
]);

async function readCapped(path, limit) {
  try {
    const text = await readFile(path, "utf8");
    return { text: text.slice(0, limit), truncated: text.length > limit };
  } catch {
    return null;
  }
}

/**
 * The parts of a tree that hint at what a project does: top-level folders, and
 * one level inside the directory that holds the source.
 */
async function shape(root) {
  const top = [];
  let inner = [];

  try {
    for (const entry of await readdir(root, { withFileTypes: true })) {
      if (entry.name.startsWith(".") || SHAPE_SKIP.has(entry.name)) continue;
      top.push(entry.isDirectory() ? `${entry.name}/` : entry.name);
    }
  } catch {
    return { top, inner };
  }

  // `lib/`, `src/` and `app/` are where a project's own vocabulary lives —
  // screen names, service names — which is often the fastest way to see what
  // something does.
  for (const dir of ["lib", "src", "app"]) {
    if (!top.includes(`${dir}/`)) continue;
    try {
      const entries = await readdir(join(root, dir), { withFileTypes: true });
      inner = entries
        .filter((e) => !e.name.startsWith("."))
        .map((e) => (e.isDirectory() ? `${dir}/${e.name}/` : `${dir}/${e.name}`))
        .slice(0, 40);
      break;
    } catch {
      /* unreadable */
    }
  }

  return { top: top.sort(), inner: inner.sort() };
}

/** Dependency names only — versions do not help decide what a project is. */
async function dependencies(root, ecosystems = []) {
  const names = [];

  if (ecosystems.includes("node")) {
    const read = await readCapped(join(root, "package.json"), 20_000);
    if (read) {
      try {
        const pkg = JSON.parse(read.text);
        names.push(...Object.keys({ ...(pkg.dependencies ?? {}) }));
      } catch {
        /* malformed */
      }
    }
  }

  if (ecosystems.includes("flutter") || ecosystems.includes("dart")) {
    const read = await readCapped(join(root, "pubspec.yaml"), 20_000);
    if (read) {
      const block = read.text.split(/^dev_dependencies:/m)[0];
      for (const match of block.matchAll(/^\s{2}([a-z0-9_]+):/gm)) {
        if (match[1] !== "sdk" && match[1] !== "flutter") names.push(match[1]);
      }
    }
  }

  return [...new Set(names)].slice(0, 30);
}

/**
 * Collect a small briefing for one project.
 *
 * @param {object} entry a manifest entry
 */
export async function collectCardBrief(entry) {
  const root = entry.source?.path;
  if (!root) throw new Error(`entry ${entry.id} has no source.path`);

  try {
    await stat(root);
  } catch {
    return { id: entry.id, name: entry.name, missing: true };
  }

  const docs = [];
  let spent = 0;
  for (const doc of entry.documents ?? []) {
    if (!/\.(md|markdown|txt)$/i.test(doc.path)) continue;
    const remaining = DOC_BUDGET - spent;
    if (remaining <= 200) break;
    const read = await readCapped(join(root, doc.path), remaining);
    if (!read) continue;
    docs.push({ file: doc.path, ...read });
    spent += read.text.length;
  }

  return {
    id: entry.id,
    name: entry.name,
    kind: entry.kind,
    ecosystem: entry.ecosystem ?? [],
    frameworks: entry.frameworks ?? [],
    deploy: entry.source?.deploy ?? [],
    remote: entry.source?.remote ?? null,
    commits: entry.source?.commits ?? 0,
    started: entry.started ?? null,
    last_active: entry.last_active ?? null,
    images: (entry.images ?? []).length,
    tagline: entry.tagline ?? null,
    shape: await shape(root),
    dependencies: await dependencies(root, entry.ecosystem),
    docs,
  };
}

/**
 * Render one batch document covering every project.
 *
 * One document rather than one file each, because the point is a single pass:
 * an agent reads all of it and writes all the cards, and the relationships
 * between projects — which ones share a capability, which are versions of the
 * same idea — only become visible when they are side by side.
 */
export function renderCardBatch(briefs) {
  const out = [];
  const p = (...lines) => out.push(...lines);
  const present = briefs.filter((b) => !b.missing);
  const missing = briefs.filter((b) => b.missing);

  p("# Card pass", "");
  p(
    `${present.length} projects need a card. Everything needed to write them is`,
    "below — you should not have to open a repository for this pass.",
    "",
  );

  p("## What to write", "");
  p(
    "For each project, write into `projects/<id>.md`:",
    "",
    "1. The `## Card` section: **under 120 words**, factual, self-contained.",
    "   What it is, who uses it, what it does, and how it is built at a glance.",
    "   No stack list — the frontmatter already carries that. No claims about",
    "   quality or significance. A reader who sees nothing else should know what",
    "   the project is and whether it is relevant to them.",
    "2. `tagline`: one factual line a stranger understands.",
    "3. `kind`, `status`, `domain`, `capabilities`, `patterns`, `tags` — only",
    "   where the material below supports them.",
    "4. A one-line `summary` for each document listed under `documents`.",
    "5. `narrative_status: card`",
    "",
    "Leave the dossier sections as they are. They are written later, per",
    "project, for the few that someone wants an article about.",
    "",
  );

  p("### Rules", "");
  p(
    "- **Never invent.** No metric the project does not state, no users it does",
    "  not have, no feature that is planned rather than built. If the material",
    "  below does not say, leave the field empty and say so in your report.",
    "- **Describe, do not assess.** Report what the software does, not whether",
    "  the work was good.",
    "- **Reuse vocabulary.** Before inventing a capability or pattern, check",
    "  what other projects already use — an index whose every value appears",
    "  once indexes nothing.",
    "- A project whose material is too thin for an honest card should get a",
    "  short factual one (\"A Flutter app; no documentation beyond a scaffold",
    "  README\") rather than an invented one. Say which ones those were.",
    "",
  );

  // A shared vocabulary list, so twenty cards do not invent twenty synonyms.
  const caps = new Set();
  const pats = new Set();
  for (const b of present) {
    for (const f of b.frameworks) caps.add(f);
  }
  p("### Vocabulary already in use", "");
  p(
    "Capabilities: `asset-generation`, `video-pipeline`, `image-generation`,",
    "`audio-processing`, `text-generation`, `payments`, `authentication`,",
    "`realtime-sync`, `offline-first`, `geolocation`, `push-notifications`,",
    "`scraping`, `search`, `scheduling`, `reporting`, `file-upload`,",
    "`pdf-generation`, `ocr`, `chat`, `multiplayer`, `procedural-generation`",
    "",
    "Patterns: `browser-local-processing`, `two-pass-llm`, `queue-backed-jobs`,",
    "`repository-pattern`, `state-machine`, `offline-first`, `edge-rendering`,",
    "`static-generation`, `optimistic-ui`, `worker-offloading`,",
    "`monorepo-workspaces`, `serverless-functions`, `feature-sliced`",
    "",
  );

  p("---", "");

  for (const brief of present) {
    p(`## ${brief.name}`, "");
    p(`Entry: \`projects/${brief.id}.md\``, "");

    const facts = [];
    facts.push(`kind: ${brief.kind ?? "unknown"}`);
    if (brief.ecosystem.length) facts.push(`ecosystem: ${brief.ecosystem.join(", ")}`);
    if (brief.frameworks.length) facts.push(`frameworks: ${brief.frameworks.join(", ")}`);
    if (brief.deploy.length) facts.push(`deploy: ${brief.deploy.join(", ")}`);
    if (brief.remote) facts.push(`remote: ${brief.remote}`);
    if (brief.commits) facts.push(`commits: ${brief.commits}`);
    if (brief.started) {
      facts.push(`active: ${brief.started}${brief.last_active && brief.last_active !== brief.started ? ` to ${brief.last_active}` : ""}`);
    }
    if (brief.images) facts.push(`images proposed: ${brief.images}`);
    if (brief.tagline) facts.push(`existing tagline: ${brief.tagline}`);
    p(facts.map((f) => `- ${f}`).join("\n"), "");

    if (brief.shape.top.length) {
      p("Top level:", "");
      p("```");
      p(brief.shape.top.join("  "));
      p("```", "");
    }
    if (brief.shape.inner.length) {
      p("Inside:", "");
      p("```");
      p(brief.shape.inner.join("  "));
      p("```", "");
    }
    if (brief.dependencies.length) {
      p(`Dependencies: ${brief.dependencies.join(", ")}`, "");
    }

    if (brief.docs.length) {
      for (const doc of brief.docs) {
        p(`### ${brief.id} — ${doc.file}${doc.truncated ? " (truncated)" : ""}`, "");
        p(doc.text.trim(), "");
      }
    } else {
      p("*No documentation in this project. Write the card from the shape and", "");
      p("dependencies above, and say in your report that it was thin.*", "");
    }

    p("---", "");
  }

  if (missing.length) {
    p("## Paths that no longer exist", "");
    p("These entries point at directories that are gone or unmounted:", "");
    for (const b of missing) p(`- ${b.id}`);
    p("");
  }

  p("## When you are done", "");
  p(
    "Run `brain build`, then report: how many cards you wrote, which projects",
    "had material too thin for more than a bare card, and which fields you left",
    "empty because the material did not support them.",
    "",
  );

  return out.join("\n");
}
