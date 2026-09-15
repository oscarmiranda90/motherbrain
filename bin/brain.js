#!/usr/bin/env node
/**
 * Mother Brain CLI.
 *
 * Writing happens here, in the terminal, because cataloging is filesystem work:
 * it needs to walk a disk, read git, and write files. The dashboard stays a
 * read-only view so the manifest never needs a server to stay true.
 *
 * The scan shows folders and says what each one is. It does not decide which
 * ones matter — that is the user's call, and no heuristic has the context to
 * make it for them.
 */

import { mkdir, readFile, stat, writeFile } from "node:fs/promises";
import { resolve, dirname, join } from "node:path";

import { fileURLToPath } from "node:url";
import process from "node:process";

import { scan } from "../src/scan/index.js";
import { defaultChecked, groupLabel } from "../src/scan/tree.js";
import { describeStructure } from "../src/scan/classify.js";
import {
  addProjects,
  brainPaths,
  ensureBrain,
  narrativeGaps,
  pathExists,
  readEntries,
  refreshEntries,
  migrateAll,
} from "../src/manifest/store.js";
import { collectBrief, renderBrief } from "../src/ingest/brief.js";
import { collectCardBrief, renderCardBatch } from "../src/ingest/cards.js";
import { placeImage, publishedExtension, INSTALL_HINT } from "../src/media/optimise.js";
import { buildBundle } from "../src/manifest/bundle.js";
import { redactBundle, redactProject } from "../src/manifest/publish.js";
import { query, facetValues, FILTERS, TOGGLES } from "../src/manifest/query.js";
import { diagnose, summarise, refreshable } from "../src/manifest/doctor.js";
import { findSites } from "../src/scan/deploy.js";
import { renderDashboard } from "../src/dashboard/render.js";
import { buildWikiPayload, renderWiki } from "../src/dashboard/wiki.js";
import { buildPickPayload, renderPickPage } from "../src/dashboard/pick.js";
import { multiselect, ask, paint, color, fit } from "../src/ui/multiselect.js";
import { banner, bar, hue } from "../src/ui/brand.js";

const __dirname = dirname(fileURLToPath(import.meta.url));
const BRAIN_ROOT = process.env.MOTHERBRAIN_ROOT ?? resolve(__dirname, "..");

// --- helpers ---------------------------------------------------------------

function log(...args) {
  console.log(...args);
}

function heading(text) {
  log("");
  log(paint(text, color.bold));
  log(paint("─".repeat(Math.min(text.length, 60)), color.gray));
}

function parseArgs(argv) {
  const args = { _: [], flags: {} };
  for (let i = 0; i < argv.length; i += 1) {
    const token = argv[i];
    if (token.startsWith("--")) {
      const [key, inline] = token.slice(2).split("=");
      if (inline !== undefined) {
        args.flags[key] = inline;
      } else if (argv[i + 1] && !argv[i + 1].startsWith("-")) {
        args.flags[key] = argv[++i];
      } else {
        args.flags[key] = true;
      }
    } else if (token.startsWith("-") && token.length > 1) {
      args.flags[token.slice(1)] = true;
    } else {
      args._.push(token);
    }
  }
  return args;
}

async function loadConfig(root) {
  const paths = brainPaths(root);
  try {
    return JSON.parse(await readFile(paths.config, "utf8"));
  } catch {
    return { roots: [], maxDepth: 4 };
  }
}

async function saveConfig(root, config) {
  const paths = brainPaths(root);
  await writeFile(paths.config, `${JSON.stringify(config, null, 2)}\n`, "utf8");
}

function relativeTo(base, target) {
  const b = resolve(base);
  const t = resolve(target);
  return t.startsWith(`${b}/`) ? t.slice(b.length + 1) : t;
}

/** Labels for a folder's structural role, when it is not a standalone project. */
const ROLE_LABEL = {
  platform: "platform folder",
  package: "sub-package",
  nested: "inside project",
};

/**
 * One line of facts about a folder: what it is built with, and what git knows.
 * No verdict — the user reads the facts and decides.
 */
function describeRow(row) {
  const bits = [describeStructure(row)];

  if (row.role !== "project" && ROLE_LABEL[row.role]) {
    bits.push(paint(ROLE_LABEL[row.role], color.magenta));
  }
  if (row.git?.isRepo) {
    bits.push(row.git.likelyOpenSource ? "public repo" : "git");
    if (row.git.lastCommit) bits.push(row.git.lastCommit);
  } else {
    bits.push(paint("no git", color.gray));
  }
  if (row.deploy?.length) bits.push(row.deploy.join("+"));
  if (row.docs?.length) bits.push(row.docs.slice(0, 2).join("+"));

  return bits.filter(Boolean).join(" · ");
}

// --- commands --------------------------------------------------------------

async function cmdInit() {
  const root = BRAIN_ROOT;
  heading("Mother Brain — setup");

  log("Mother Brain catalogs what you have built: one entry per project,");
  log("with stack, architecture, what it solves, and links. Files on disk,");
  log("readable by you and by any agent you point at them.");
  log("");

  const config = await loadConfig(root);
  const suggested = config.roots?.[0] ?? process.env.HOME ?? ".";

  const answer = await ask(
    "Which directory holds your projects? (comma-separated for several)",
    suggested,
  );
  const roots = answer
    .split(",")
    .map((r) => resolve(r.trim().replace(/^~/, process.env.HOME ?? "~")))
    .filter(Boolean);

  const missing = [];
  for (const r of roots) {
    if (!(await pathExists(r))) missing.push(r);
  }
  if (missing.length) {
    log(paint(`\nThese paths do not exist: ${missing.join(", ")}`, color.red));
    return 1;
  }

  // Depth used to be a question. It was a bad one: nobody knows how deep their
  // own projects sit, a low answer silently hides work, and the honest default
  // costs about three seconds more on a full drive. So the scanner decides.
  config.roots = roots;
  delete config.maxDepth;
  await ensureBrain(root);
  await saveConfig(root, config);

  log(paint(`\nSaved to ${relativeTo(root, brainPaths(root).config)}`, color.dim));
  log("");
  log(`Next: ${paint("brain pick", color.cyan)}   — choose in the browser`);
  log(`  or: ${paint("brain scan", color.cyan)}   — choose in the terminal`);
  return 0;
}

async function cmdScan(args) {
  const root = BRAIN_ROOT;
  const config = await loadConfig(root);

  const roots = args._.length
    ? args._.map((r) => resolve(r.replace(/^~/, process.env.HOME ?? "~")))
    : config.roots;

  if (!roots?.length) {
    log(paint("No roots configured. Run `brain init` first,", color.yellow));
    log(paint("or pass a path: `brain scan ~/code`", color.yellow));
    return 1;
  }

  const maxDepth = args.flags.depth
    ? Number.parseInt(args.flags.depth, 10)
    : (config.maxDepth ?? undefined);
  const quiet = Boolean(args.flags.json);

  if (!quiet) {
    heading("Scanning");
    log(paint(roots.join("\n"), color.dim));
    log("");
  }

  let spinnerState = 0;
  const spinner = ["⠋", "⠙", "⠹", "⠸", "⠼", "⠴", "⠦", "⠧", "⠇", "⠏"];

  const rows = await scan(roots, {
    maxDepth,
    onProgress: (stage, detail) => {
      if (quiet || !process.stdout.isTTY) return;
      const frame = spinner[spinnerState++ % spinner.length];
      const line = `${frame} ${stage} ${fit(detail, (process.stdout.columns ?? 80) - 12)}`;
      process.stdout.write(`\r[2K${paint(line, color.dim)}`);
    },
  });

  if (!quiet && process.stdout.isTTY) process.stdout.write("\r[2K");

  if (args.flags.json) {
    log(JSON.stringify(rows, null, 2));
    return 0;
  }

  if (rows.length === 0) {
    log(paint("No project folders found. Try a different root or a deeper scan.", color.yellow));
    return 0;
  }

  // Already-catalogued paths are shown but pre-unchecked: re-adding is a
  // refresh, and that should be deliberate.
  const existing = await readEntries(root);
  const known = new Set(existing.map((e) => e.source?.path).filter(Boolean));

  const topLevel = rows.filter((r) => r.depth === 0).length;
  const parts = rows.length - topLevel;

  let lastGroup = null;
  const items = rows.map((row) => {
    const already = known.has(row.path);
    const group = groupLabel(row, roots[0]);
    const showGroup = group && group !== lastGroup;
    if (showGroup) lastGroup = group;

    const marker = already ? `${paint("✓", color.magenta)} ` : "";

    return {
      value: row,
      depth: row.depth,
      checked: already ? false : defaultChecked(row),
      label: `${marker}${row.name}`,
      detail: describeRow(row),
      group: showGroup ? group : undefined,
    };
  });

  const selected = await multiselect({
    title: `${topLevel} projects · ${parts} internal folders shown beneath them`,
    hint: "Whole projects are checked; their internal parts are not. Check anything you want catalogued on its own. ✓ = already in the brain.",
    items,
  });

  if (selected === null) {
    log(paint("\nCancelled. Nothing written.", color.yellow));
    return 130;
  }

  if (selected.length === 0) {
    log(paint("\nNothing selected. Nothing written.", color.yellow));
    return 0;
  }

  log("");
  const results = await addProjects(root, selected);

  heading(`Added ${results.created.length} · refreshed ${results.refreshed.length}`);
  for (const item of results.created) {
    log(`${paint("+", color.green)} ${item.name}  ${paint(relativeTo(root, item.path), color.dim)}`);
  }
  for (const item of results.refreshed) {
    log(`${paint("~", color.cyan)} ${item.name}  ${paint(relativeTo(root, item.path), color.dim)}`);
  }

  await buildBundle(root);
  const entries = await readEntries(root);
  const gaps = entries.filter((e) => !narrativeGaps(e).complete);

  log("");
  log(paint(`brain.json rebuilt — ${entries.length} projects`, color.dim));

  if (gaps.length) {
    log("");
    log(`${paint(String(gaps.length), color.yellow)} entries have no prose yet.`);
    log(
      `A framework list is not what a CV or a post needs — the ${paint('"why I built this"', color.bold)} is.`,
    );
    log("");
    log(`Fill them with an agent:  ${paint("/mother-brain write", color.cyan)}`);
    log(
      `Or by hand:               ${paint(`${relativeTo(root, brainPaths(root).projects)}/*.md`, color.cyan)}`,
    );
  }

  return 0;
}

/**
 * Resolve one directory into a scanned project record, or null.
 *
 * The scan runs as a tree even though only one row is wanted: a workspace root
 * declares nothing but its workspace, and only the tree pass lets it inherit
 * the frameworks its `apps/*` actually use. Without that, `brain add` would
 * store a thinner description than the picking screen showed.
 */
async function resolveProject(target) {
  const found = await scan([target], { maxDepth: 3, includeRoot: true });
  const match = found.find((p) => resolve(p.path) === target);
  if (match) return match;

  // The markers may sit deeper, when `target` is a container folder.
  return found.find((p) => p.depth === 0) ?? null;
}

async function cmdAdd(args) {
  const root = BRAIN_ROOT;

  // `brain pick` hands back a command with many paths, so this takes a list.
  let targets = args._.length ? args._.map((p) => resolve(p)) : [process.cwd()];

  if (args.flags.from) {
    // A selection exported from the picking page.
    const raw = await readFile(resolve(String(args.flags.from)), "utf8");
    const parsed = JSON.parse(raw);
    const fromFile = Array.isArray(parsed) ? parsed : (parsed.paths ?? parsed.selected ?? []);
    if (!Array.isArray(fromFile) || fromFile.length === 0) {
      log(paint("That file lists no paths.", color.yellow));
      return 1;
    }
    targets = fromFile.map((p) => resolve(String(p)));
  }

  heading(targets.length === 1 ? `Sending to brain: ${targets[0]}` : `Sending ${targets.length} projects to brain`);

  const projects = [];
  const skipped = [];

  for (const target of targets) {
    if (!(await pathExists(target))) {
      skipped.push({ target, why: "no such path" });
      continue;
    }
    const project = await resolveProject(target);
    if (!project) {
      skipped.push({ target, why: "no recognizable project marker" });
      continue;
    }
    projects.push(project);
  }

  if (projects.length === 0) {
    for (const { target, why } of skipped) {
      log(`${paint("!", color.red)} ${target} — ${why}`);
    }
    log(paint("Expected one of: package.json, pubspec.yaml, go.mod, Cargo.toml, …", color.dim));
    return 1;
  }

  const results = await addProjects(root, projects);
  const byPath = new Map(projects.map((p) => [p.path, p]));

  for (const item of results.created) {
    const project = byPath.get(item.sourcePath) ?? projects.find((p) => p.name === item.name);
    log(
      `${paint("+", color.green)} ${item.name}  ${paint(project ? describeStructure(project) : "", color.dim)}`,
    );
  }
  for (const item of results.refreshed) {
    const project = byPath.get(item.sourcePath) ?? projects.find((p) => p.name === item.name);
    log(
      `${paint("~", color.cyan)} ${item.name}  ${paint(project ? describeStructure(project) : "", color.dim)}`,
    );
  }
  for (const { target, why } of skipped) {
    log(`${paint("!", color.yellow)} ${relativeTo(root, target)} — ${why}`);
  }

  await buildBundle(root);

  const entries = await readEntries(root);
  const written = new Set([...results.created, ...results.refreshed].map((i) => i.id));
  const gaps = entries.filter((e) => written.has(e.id) && !narrativeGaps(e).complete);

  if (gaps.length) {
    log("");
    log(
      `${paint(String(gaps.length), color.yellow)} ${gaps.length === 1 ? "entry needs" : "entries need"} prose.`,
    );
    log(paint("Run `/mother-brain write` in an agent to fill them from the code.", color.dim));
  }

  return 0;
}

async function cmdPick(args) {
  const root = BRAIN_ROOT;
  const config = await loadConfig(root);

  const roots = args._.length
    ? args._.map((r) => resolve(r.replace(/^~/, process.env.HOME ?? "~")))
    : config.roots;

  if (!roots?.length) {
    log(paint("No roots configured. Run `brain init` first,", color.yellow));
    log(paint("or pass a path: `brain pick ~/code`", color.yellow));
    return 1;
  }

  const maxDepth = args.flags.depth
    ? Number.parseInt(args.flags.depth, 10)
    : (config.maxDepth ?? undefined);

  heading("Scanning");
  log(paint(roots.join("\n"), color.dim));
  log("");

  let spinnerState = 0;
  const spinner = ["⠋", "⠙", "⠹", "⠸", "⠼", "⠴", "⠦", "⠧", "⠇", "⠏"];

  const rows = await scan(roots, {
    maxDepth,
    onProgress: (stage, detail) => {
      if (!process.stdout.isTTY) return;
      const frame = spinner[spinnerState++ % spinner.length];
      process.stdout.write(
        `\r[2K${paint(`${frame} ${stage} ${fit(detail, (process.stdout.columns ?? 80) - 12)}`, color.dim)}`,
      );
    },
  });

  if (process.stdout.isTTY) process.stdout.write("\r[2K");

  if (rows.length === 0) {
    log(paint("No project folders found. Try a different root or a deeper scan.", color.yellow));
    return 0;
  }

  const existing = await readEntries(root);
  const known = new Set(existing.map((e) => e.source?.path).filter(Boolean));

  const payload = buildPickPayload(rows, { roots, known });
  const out = join(brainPaths(root).root, "pick.html");
  await writeFile(out, renderPickPage(payload), "utf8");

  const topLevel = rows.filter((r) => r.depth === 0).length;

  log(
    `${rows.length} folders · ${topLevel} whole projects${known.size ? ` · ${known.size} already catalogued` : ""}`,
  );
  log("");
  log(`${paint("Open:", color.bold)} ${out}`);
  log("");
  log("Tick what belongs, hit Copy command, and paste it back here.");
  log(paint("The page writes nothing — the terminal does.", color.dim));

  if (args.flags.open !== false) {
    const { execFile } = await import("node:child_process");
    const opener =
      process.platform === "darwin" ? "open" : process.platform === "win32" ? "start" : "xdg-open";
    execFile(opener, [out], () => {});
  }

  return 0;
}

async function cmdBuild() {
  const root = BRAIN_ROOT;
  const bundle = await buildBundle(root);
  const html = await renderDashboard(bundle);
  await writeFile(brainPaths(root).dashboard, html, "utf8");

  heading("Built");
  log(
    `${bundle.counts.projects} projects → ${paint("brain.json", color.cyan)} + ${paint("api/projects/", color.cyan)} + ${paint("index.html", color.cyan)}`,
  );
  log(
    paint(
      `${bundle.counts.carded} carded · ${bundle.counts.documented} full dossiers · ${bundle.counts.public} public`,
      color.dim,
    ),
  );
  return 0;
}

/**
 * The card pass: one light briefing covering every project that lacks a card.
 *
 * This is the cheap path, and it should be the usual one. A card per project
 * makes the catalogue and its cross-project indexes work, which is what
 * answers "what have I built", a CV, or an idea bank. Deep dossiers are for
 * the few projects someone later wants an article about.
 */
async function cmdCards(args, entries, root) {
  const targets = args.flags.all
    ? entries.filter((e) => !e.card_written)
    : entries.filter((e) => {
        const gaps = narrativeGaps(e);
        // An entry with a full dossier has a card already.
        return !gaps.complete && e.narrative_status !== "reviewed";
      });

  if (targets.length === 0) {
    log(paint("Every entry already has a card.", color.green));
    return 0;
  }

  heading(`Collecting one briefing for ${targets.length} projects`);

  const briefs = [];
  for (const entry of targets) {
    try {
      briefs.push(await collectCardBrief(entry));
    } catch (error) {
      log(`${paint("!", color.yellow)} ${entry.id} — ${error.message}`);
    }
  }

  const briefDir = join(brainPaths(root).root, ".motherbrain", "briefs");
  await mkdir(briefDir, { recursive: true });
  const file = join(briefDir, "card-pass.md");
  const document = renderCardBatch(briefs);
  await writeFile(file, document, "utf8");

  const present = briefs.filter((b) => !b.missing).length;
  const gone = briefs.length - present;
  const words = document.split(/\s+/).filter(Boolean).length;

  log(
    `${paint("→", color.green)} ${present} projects · ${paint(`${words.toLocaleString()} words`, color.dim)}`,
  );
  if (gone) log(`${paint("!", color.yellow)} ${gone} point at paths that no longer exist`);
  log("");
  log(`One document: ${paint(relativeTo(root, file), color.cyan)}`);
  log("");
  log("Hand it to a coding agent with the skill in skill/SKILL.md. It reads");
  log("everything in one pass and writes a card into each entry — no repository");
  log("needs opening, because the material is already in the document.");
  log("");
  log(paint("Cards make the catalogue and its cross-project indexes work.", color.dim));
  log(paint("Full dossiers come later, per project, via `brain ingest <id>`.", color.dim));
  return 0;
}

async function cmdIngest(args) {
  const root = BRAIN_ROOT;
  const entries = await readEntries(root);

  if (entries.length === 0) {
    log(paint("Brain is empty. Run `brain pick` first.", color.yellow));
    return 1;
  }

  if (args.flags.cards) return cmdCards(args, entries, root);

  let targets;
  if (args.flags.all) {
    targets = entries.filter((e) => !narrativeGaps(e).complete);
  } else if (args._.length) {
    const wanted = new Set(args._);
    targets = entries.filter((e) => wanted.has(e.id));
    const missing = [...wanted].filter((id) => !entries.some((e) => e.id === id));
    for (const id of missing) log(`${paint("!", color.yellow)} no entry with id ${id}`);
  } else {
    log(paint("Which project? Pass an id, or --all for every unwritten entry.", color.yellow));
    log("");
    for (const entry of entries.filter((e) => !narrativeGaps(e).complete).slice(0, 12)) {
      log(`  ${entry.id}`);
    }
    return 1;
  }

  if (targets.length === 0) {
    log(paint("Nothing to ingest — every entry already has a write-up.", color.green));
    return 0;
  }

  const briefDir = join(brainPaths(root).root, ".motherbrain", "briefs");
  await mkdir(briefDir, { recursive: true });

  heading(`Collecting ${targets.length} ${targets.length === 1 ? "briefing" : "briefings"}`);

  const written = [];
  for (const entry of targets) {
    try {
      const brief = await collectBrief(entry);
      const file = join(briefDir, `${entry.id}.md`);
      await writeFile(file, renderBrief(brief), "utf8");
      written.push({ id: entry.id, file, docs: brief.docs.length, files: brief.shape.file_count });
      log(
        `${paint("→", color.green)} ${entry.id.padEnd(26)} ${paint(`${brief.shape.file_count} files · ${brief.docs.length} docs · ${brief.entry_points.length} entry points`, color.dim)}`,
      );
    } catch (error) {
      log(`${paint("!", color.red)} ${entry.id} — ${error.message}`);
    }
  }

  if (written.length === 0) return 1;

  log("");
  log(`Briefings in ${paint(relativeTo(root, briefDir), color.cyan)}`);
  log("");
  log("These are maps, not summaries. Hand one to whichever coding agent you");
  log("use, along with the skill in skill/SKILL.md, and it writes the entry");
  log(`into ${paint("projects/<id>.md", color.cyan)} from the briefing and the files it names.`);
  return 0;
}

async function cmdMigrate() {
  const root = BRAIN_ROOT;
  heading("Upgrading entries to the current schema");
  log(paint("Adds missing fields and sections. Never edits what you wrote.", color.dim));
  log("");

  const changed = await migrateAll(root);

  if (changed.length === 0) {
    log(paint("Every entry is already current.", color.green));
    return 0;
  }

  for (const item of changed) log(`${paint("~", color.cyan)} ${item.name}`);
  await buildBundle(root);

  log("");
  log(paint(`${changed.length} upgraded · brain.json rebuilt`, color.dim));
  log("");
  log(`Next: ${paint("brain ingest --all", color.cyan)}  — collect briefings for the new sections`);
  return 0;
}

async function cmdQuery(args) {
  const root = BRAIN_ROOT;
  const bundle = await buildBundle(root);

  // Anything not a known flag is a free-text term, so `brain query video`
  // works without remembering a flag name.
  const filters = {};
  const toggles = [];
  for (const [name, value] of Object.entries(args.flags)) {
    if (value === true) toggles.push(name);
    else filters[name] = String(value);
  }
  const text = args._.join(" ").trim() || undefined;

  const sort = filters.sort;
  const limit = filters.limit ? Number.parseInt(filters.limit, 10) : undefined;
  delete filters.sort;
  delete filters.limit;
  const wantsJson = toggles.includes("json");
  const jsonIndex = toggles.indexOf("json");
  if (jsonIndex !== -1) toggles.splice(jsonIndex, 1);

  const { results, applied, unknown } = query(bundle.projects, {
    text,
    filters,
    toggles,
    sort,
    limit,
  });

  if (unknown.length) {
    log(paint(`Unknown filter: ${unknown.join(", ")}`, color.red));
    log("");
    log(`Filters:  ${paint(Object.keys(FILTERS).map((f) => `--${f}`).join("  "), color.dim)}`);
    log(`Flags:    ${paint(Object.keys(TOGGLES).map((t) => `--${t}`).join("  "), color.dim)}`);
    return 1;
  }

  if (wantsJson) {
    log(JSON.stringify(results, null, 2));
    return 0;
  }

  heading(
    applied.length
      ? `${results.length} of ${bundle.projects.length} — ${applied.join(" · ")}`
      : `${results.length} projects`,
  );

  if (results.length === 0) {
    log(paint("Nothing matches.", color.yellow));
    // A bare "no results" is unhelpful; show what the catalogue does contain
    // for whichever facet was filtered on.
    for (const name of Object.keys(filters)) {
      const values = facetValues(bundle.projects, name);
      if (values.length === 0) continue;
      log("");
      log(`${paint(name, color.bold)} values in this brain:`);
      log(
        paint(
          "  " + values.slice(0, 14).map((v) => `${v.value} (${v.count})`).join("  ·  "),
          color.dim,
        ),
      );
    }
    return 0;
  }

  for (const project of results) {
    const marks = [
      project.dossier?.complete ? paint("●", color.green) : paint("○", color.yellow),
      project.links?.repo ? paint("↗", hue.steel) : " ",
    ].join("");
    const built = (project.frameworks ?? []).slice(0, 3).join("/");
    log(
      `${marks} ${(project.name ?? "").padEnd(26)} ${paint((project.status ?? "—").padEnd(10), color.dim)} ${paint(built, color.dim)}`,
    );
    if (project.tagline) log(paint(`     ${fit(project.tagline, 76)}`, color.gray));
  }

  log("");
  log(
    paint(
      `● full dossier   ○ card only   ↗ public repo      ${results.length} shown`,
      color.dim,
    ),
  );
  return 0;
}

async function cmdDoctor(args) {
  const root = BRAIN_ROOT;
  const entries = await readEntries(root);

  if (entries.length === 0) {
    log(paint("Brain is empty — nothing to check.", color.yellow));
    return 0;
  }

  heading(`Checking ${entries.length} entries`);

  const findings = await diagnose(entries);
  const counts = summarise(findings);

  if (findings.length === 0) {
    log(paint("Everything checks out.", color.green));
    return 0;
  }

  const icon = { error: paint("✕", color.red), warning: paint("!", color.yellow), note: paint("·", color.gray) };
  let lastId = null;
  for (const finding of findings) {
    if (finding.id !== lastId) {
      log("");
      log(paint(finding.id, color.bold));
      lastId = finding.id;
    }
    log(`  ${icon[finding.severity]} ${finding.problem}`);
    log(paint(`    ${finding.fix}`, color.dim));
  }

  log("");
  log(
    [
      counts.error ? paint(`${counts.error} to fix`, color.red) : null,
      counts.warning ? paint(`${counts.warning} drifting`, color.yellow) : null,
      counts.note ? paint(`${counts.note} worth a look`, color.gray) : null,
    ]
      .filter(Boolean)
      .join(" · "),
  );

  const canRefresh = refreshable(findings);
  if (canRefresh.length && !args.flags.fix) {
    log("");
    log(
      `${canRefresh.length} ${canRefresh.length === 1 ? "entry" : "entries"} can be repaired mechanically: ${paint("brain doctor --fix", color.cyan)}`,
    );
  }

  if (args.flags.fix && canRefresh.length) {
    log("");
    log(paint("Refreshing machine facts — prose is untouched.", color.dim));
    // Only the entries that actually drifted. A repair that rewrites the whole
    // catalogue to fix one entry is not a repair.
    const results = await refreshEntries(root, scan, canRefresh);
    await buildBundle(root);
    for (const entry of results.refreshed) log(`${paint("~", color.cyan)} ${entry.id}`);
    log("");
    log(paint("Re-run `brain doctor` to see what remains.", color.dim));
  }

  // Errors mean the catalogue points at something that is not there, which is
  // worth a non-zero exit so a CI step or a hook can notice.
  return counts.error > 0 ? 1 : 0;
}

async function cmdSites(args) {
  const root = BRAIN_ROOT;
  const entries = await readEntries(root);
  const targets = args._.length
    ? entries.filter((e) => args._.includes(e.id))
    : entries.filter((e) => !e.links?.site);

  if (targets.length === 0) {
    log(paint("Every entry already has a site link.", color.green));
    return 0;
  }

  heading(`Looking for published URLs in ${targets.length} projects`);
  log(paint("Candidates only — nothing is written until you confirm.", color.dim));

  let found = 0;
  for (const entry of targets) {
    const path = entry.source?.path;
    if (!path || !(await pathExists(path))) continue;

    const sites = await findSites(path);
    if (sites.length === 0) continue;

    found += 1;
    log("");
    log(paint(entry.id, color.bold));
    for (const site of sites) {
      const tint = { high: color.green, medium: color.yellow, low: color.gray }[site.confidence];
      log(`  ${paint(site.url, tint)}`);
      log(paint(`    ${site.source} · ${site.confidence} confidence`, color.dim));
    }
  }

  if (found === 0) {
    log("");
    log(paint("No candidate URLs found in any configuration.", color.dim));
    return 0;
  }

  log("");
  log("To accept one, set it in the entry:");
  log(paint("  links:", color.dim));
  log(paint("    site: https://…", color.dim));
  log("");
  log(
    paint(
      "A wrong URL on a public page is worse than a missing one, so these are",
      color.dim,
    ),
  );
  log(paint("proposals — check the address actually serves the project.", color.dim));
  return 0;
}

/**
 * Write the update instruction into the agent files a developer already keeps.
 *
 * A brain only stays useful if it is updated when work actually happens, and
 * nobody remembers to run a catalogue command after shipping a feature. Their
 * coding agent does read `CLAUDE.md`, `AGENTS.md` or `SOUL.md` on every task,
 * so the instruction belongs there — written once, by consent, into files they
 * own.
 */
async function cmdHook(args) {
  const root = BRAIN_ROOT;
  const target = resolve(args._[0] ?? process.cwd());

  if (!(await pathExists(target))) {
    log(paint(`No such path: ${target}`, color.red));
    return 1;
  }

  const brainPath = brainPaths(root).root;
  // Paired markers, so running this twice is a no-op and a developer can find
  // and delete the block by searching for one word.
  const marker = "<!-- motherbrain -->";
  const endMarker = "<!-- /motherbrain -->";
  const snippet = [
    marker,
    "",
    "## Keeping the project catalogue current",
    "",
    "After finishing anything that changes what this project *is* — a shipped",
    "feature, a new dependency, an architectural decision, a deployment —",
    "update its entry in the Mother Brain catalogue:",
    "",
    "```bash",
    `brain add ${target}   # refreshes structure, never touches prose`,
    "```",
    "",
    "Then, if what the project does or how it works has changed, edit its entry",
    `at \`${brainPath}/projects/<id>.md\` and run \`brain build\`.`,
    "",
    "Describe, do not assess: what the software does, not whether the work was",
    "good. Never record a metric the project does not state.",
    endMarker,
  ].join("\n");

  // Only files the developer already keeps. Creating an agent file they never
  // asked for would be putting our instructions in their project uninvited.
  const candidates = ["CLAUDE.md", "AGENTS.md", "SOUL.md", ".cursorrules", "GEMINI.md"];
  const found = [];
  for (const name of candidates) {
    if (await pathExists(join(target, name))) found.push(name);
  }

  heading(`Agent files in ${relativeTo(root, target)}`);

  if (found.length === 0) {
    log(paint("None found.", color.yellow));
    log("");
    log("This writes into a file you already keep — it will not create one.");
    log(`Looked for: ${paint(candidates.join(", "), color.dim)}`);
    log("");
    log("Create the one your agent reads, then run this again.");
    return 1;
  }

  let changed = 0;
  for (const name of found) {
    const file = join(target, name);
    const existing = await readFile(file, "utf8");

    if (existing.includes(marker)) {
      log(`${paint("=", color.gray)} ${name}  ${paint("already hooked", color.dim)}`);
      continue;
    }
    if (args.flags["dry-run"]) {
      log(`${paint("+", color.cyan)} ${name}  ${paint("would be appended", color.dim)}`);
      continue;
    }

    await writeFile(file, `${existing.trimEnd()}\n\n${snippet}\n`, "utf8");
    log(`${paint("+", color.green)} ${name}`);
    changed += 1;
  }

  if (args.flags["dry-run"]) {
    log("");
    log(paint("Dry run — nothing written.", color.dim));
    log("");
    log(snippet);
    return 0;
  }

  if (changed) {
    log("");
    log("Your agent will now refresh this project's entry when it finishes");
    log("meaningful work. The block is marked, so running this again is safe.");
  }

  // --- the git hook, which catches what an agent forgets ----------------
  if (args.flags.git) {
    const gitDir = join(target, ".git");
    if (!(await pathExists(gitDir))) {
      log("");
      log(paint("Not a git repository — skipping the commit hook.", color.yellow));
      return changed ? 0 : 1;
    }

    const hookPath = join(gitDir, "hooks", "post-commit");
    const line = `brain add "${target}" >/dev/null 2>&1 || true`;
    const banner = "# motherbrain: keep this project's catalogue entry current";
    const existing = (await pathExists(hookPath)) ? await readFile(hookPath, "utf8") : null;

    if (existing?.includes("motherbrain")) {
      log("");
      log(`${paint("=", color.gray)} post-commit  ${paint("already installed", color.dim)}`);
      return 0;
    }

    if (args.flags["dry-run"]) {
      log("");
      log(`${paint("+", color.cyan)} .git/hooks/post-commit  ${paint("would be appended", color.dim)}`);
      log(paint(`    ${line}`, color.dim));
      return 0;
    }

    // Append rather than overwrite: a repository may already have a hook, and
    // clobbering someone's tooling to install ours would be indefensible.
    const body = existing
      ? `${existing.trimEnd()}\n\n${banner}\n${line}\n`
      : `#!/bin/sh\n\n${banner}\n${line}\n`;

    await writeFile(hookPath, body, "utf8");
    const { chmod } = await import("node:fs/promises");
    await chmod(hookPath, 0o755);

    log("");
    log(`${paint("+", color.green)} .git/hooks/post-commit`);
    log(
      paint(
        "    Structure refreshes on every commit. It never touches your prose,",
        color.dim,
      ),
    );
    log(paint("    and a failure is swallowed so it cannot block a commit.", color.dim));
  }

  return 0;
}

/**
 * Where the brain stands and what to do next.
 *
 * A new user's hardest question is not how a command works, it is which one to
 * run. Without this they are left to infer the order from a help screen, and
 * the expensive path — a deep dossier per project — reads as the obvious one.
 */
async function cmdStatus() {
  const root = BRAIN_ROOT;
  const config = await loadConfig(root);
  const entries = await readEntries(root);

  let version = null;
  try {
    version = JSON.parse(await readFile(join(__dirname, "..", "package.json"), "utf8")).version;
  } catch {
    /* no package file reachable */
  }
  for (const line of banner({ version })) log(line);

  if (entries.length === 0) {
    log("Nothing catalogued yet.");
    log("");
    if (!config.roots?.length) {
      log(`Next: ${paint("brain init", color.cyan)}    point it at your project directories`);
    } else {
      log(`Next: ${paint("brain pick", color.cyan)}    choose projects in the browser`);
      log(`  or: ${paint("brain scan", color.cyan)}    choose them in the terminal`);
    }
    return 0;
  }

  const carded = entries.filter((e) => {
    const body = e._body ?? "";
    const card = body.split(/^##\s+Card\s*$/m)[1] ?? "";
    const text = card.split(/^##\s+/m)[0] ?? "";
    return text.replace(/<!--[\s\S]*?-->/g, "").trim().length > 0;
  });
  const documented = entries.filter((e) => narrativeGaps(e).complete);
  const publishable = entries.filter((e) => e.visibility === "public");
  const missingPath = [];
  for (const entry of entries) {
    if (entry.source?.path && !(await pathExists(entry.source.path))) missingPath.push(entry.id);
  }

  log(`  ${paint(String(entries.length), color.bold)} projects catalogued`);
  log("");
  log(`  cards      ${bar(carded.length, entries.length)}  ${carded.length}/${entries.length}`);
  log(`  dossiers   ${bar(documented.length, entries.length)}  ${documented.length}/${entries.length}`);
  log("");
  log(
    paint(
      `  ${publishable.length} marked public — those are what \`brain publish\` includes.`,
      color.dim,
    ),
  );

  if (missingPath.length) {
    log("");
    log(
      paint(
        `${missingPath.length} ${missingPath.length === 1 ? "entry points" : "entries point"} at a path that is gone or unmounted: ${missingPath.slice(0, 4).join(", ")}${missingPath.length > 4 ? "…" : ""}`,
        color.yellow,
      ),
    );
  }

  log("");
  log(paint("Next", color.bold));

  const withoutCard = entries.length - carded.length;
  if (withoutCard > 0) {
    log(`  ${paint("brain ingest --cards", color.cyan)}`);
    log(
      `    One briefing covering all ${withoutCard} ${withoutCard === 1 ? "project" : "projects"} without a card.`,
    );
    log(paint("    A card is what makes the catalogue and its indexes work —", color.dim));
    log(paint("    enough for a CV, an idea bank, or \"what have I built\".", color.dim));
  } else if (documented.length < entries.length) {
    log(`  ${paint("brain ingest <id>", color.cyan)}`);
    log("    A deep briefing for one project's full dossier.");
    log(paint("    Worth doing for a project someone wants an article about.", color.dim));
  } else {
    log(`  ${paint("brain publish --out public/", color.cyan)}`);
    log("    Every entry is written. Publish the encyclopedia.");
  }

  if (carded.length > 0) {
    log("");
    log(`  ${paint("brain publish --out public/", color.cyan)}`);
    log("    Publishable now — unwritten entries appear as stubs, not errors.");
  }

  return 0;
}

async function cmdRefresh() {
  const root = BRAIN_ROOT;
  heading("Refreshing machine facts");
  log(paint("Prose and human judgement are never touched.", color.dim));
  log("");

  // An entry written under an older schema is missing the card and the
  // cross-project fields, which would make it invisible to the two-tier
  // catalogue. Fold that in rather than making it a separate chore.
  const upgraded = await migrateAll(root);
  if (upgraded.length) {
    log(paint(`${upgraded.length} entries upgraded to the current schema`, color.dim));
    log("");
  }

  const results = await refreshEntries(root, scan);

  for (const item of results.refreshed) {
    log(`${paint("~", color.cyan)} ${item.name}`);
  }
  for (const item of results.missing) {
    log(`${paint("!", color.yellow)} ${item.id} — path is gone: ${item.path}`);
  }

  await buildBundle(root);
  log("");
  log(paint(`${results.refreshed.length} refreshed · brain.json rebuilt`, color.dim));

  if (results.missing.length) {
    log(
      paint(
        `${results.missing.length} entries point at paths that no longer exist — moved, or on an unmounted disk.`,
        color.yellow,
      ),
    );
  }
  return 0;
}

async function cmdPublish(args) {
  const root = BRAIN_ROOT;
  const out = resolve(String(args.flags.out ?? join(brainPaths(root).root, "public")));
  const includePrivate = Boolean(args.flags["include-private"]);

  const local = await buildBundle(root);
  // Image sources live in the projects themselves, which the public bundle no
  // longer records — so the mapping is captured before redaction.
  const entryPaths = new Map(
    (await readEntries(root)).map((e) => [e.id, e.source?.path]).filter(([, p]) => Boolean(p)),
  );

  // A heavy image is re-encoded on the way out, which changes its extension.
  // The bundle has to carry the final name or the markup points at nothing.
  for (const project of local.projects) {
    const projectRoot = entryPaths.get(project.id);
    for (const image of project.images ?? []) {
      if (!projectRoot) continue;
      let bytes = 0;
      try {
        bytes = (await stat(join(projectRoot, image.path))).size;
      } catch {
        continue;
      }
      image.published_extension = await publishedExtension(image.path, bytes);
    }
  }

  const { bundle, withheld } = redactBundle(local, {
    includePrivate,
    title: args.flags.title ? String(args.flags.title) : undefined,
    author: args.flags.author ? String(args.flags.author) : undefined,
  });

  if (bundle.projects.length === 0) {
    log(paint("Nothing is marked public, so there is nothing to publish.", color.yellow));
    log("");
    log("Publishing is opt-in per project. Set `visibility: public` in the");
    log(`entries you want on the page — ${paint("projects/<id>.md", color.cyan)}.`);
    return 1;
  }

  await mkdir(join(out, "api", "projects"), { recursive: true });
  await writeFile(join(out, "brain.json"), `${JSON.stringify(bundle, null, 2)}\n`, "utf8");

  // Dossiers are redacted individually: the local copies still carry paths.
  const { readFile: rf } = await import("node:fs/promises");
  const source = join(brainPaths(root).root, "api", "projects");
  const dossiers = new Map();
  let copied = 0;
  for (const project of bundle.projects) {
    try {
      const full = JSON.parse(await rf(join(source, `${project.id}.json`), "utf8"));
      const safe = redactProject(full);
      dossiers.set(project.id, safe);
      await writeFile(
        join(out, "api", "projects", `${project.id}.json`),
        `${JSON.stringify(safe, null, 2)}\n`,
        "utf8",
      );
      copied += 1;
    } catch {
      /* a dossier that cannot be read is simply not published */
    }
  }

  // Confirmed images are placed into the output, re-encoded when they exceed
  // the page budget, and referenced by their published path — so the page is
  // self-contained and no repository path appears in the markup.
  const media = { copied: 0, optimised: 0, saved: 0, skipped: [] };
  for (const project of bundle.projects) {
    const source = local.projects.find((p) => p.id === project.id);
    const originals = source?.images ?? [];
    const projectRoot = entryPaths.get(project.id);
    if (!projectRoot) continue;

    for (const [index, image] of (project.images ?? []).entries()) {
      const from = originals[index]?.path;
      if (!from) continue;
      const result = await placeImage({
        from: join(projectRoot, from),
        to: join(out, image.src),
      });

      if (!result.ok) {
        media.skipped.push({ path: from, reason: result.reason });
        continue;
      }
      if (result.action === "optimised") {
        media.optimised += 1;
        media.saved += (result.was ?? 0) - (result.bytes ?? 0);
      } else {
        media.copied += 1;
      }
    }
  }

  // The published page is an encyclopedia, not the maintenance dashboard: a
  // reader wants articles, not a grid with "needs prose" warnings.
  const html = renderWiki(buildWikiPayload(bundle, dossiers));
  await writeFile(join(out, "index.html"), html, "utf8");

  heading("Published");
  log(`${out}`);
  log("");
  log(`  brain.json              ${paint(`${bundle.projects.length} projects + cards`, color.dim)}`);
  log(`  api/projects/*.json     ${paint(`${copied} dossiers, fetched on demand`, color.dim)}`);
  log(`  index.html              ${paint("the encyclopedia — an article per project", color.dim)}`);
  const placed = media.copied + media.optimised;
  if (placed) {
    const detail = media.optimised
      ? `${placed} images · ${media.optimised} re-encoded, ${(media.saved / 1024 / 1024).toFixed(1)}MB saved`
      : `${placed} ${placed === 1 ? "image" : "images"}`;
    log(`  media/                  ${paint(detail, color.dim)}`);
  }
  log("");

  log(paint("Withheld from the published copy:", color.bold));
  if (withheld.length) {
    log(
      `  ${withheld.length} ${withheld.length === 1 ? "project" : "projects"} not marked public — ${withheld.map((w) => w.name).join(", ")}`,
    );
  } else if (includePrivate) {
    log(paint("  nothing — --include-private was passed", color.yellow));
  } else {
    log("  no non-public projects to withhold");
  }
  log("  every filesystem path, on every entry and inside the prose");
  log("  no source code or credentials are ever included");

  if (media.skipped.length) {
    log("");
    log(
      paint(
        `${media.skipped.length} confirmed ${media.skipped.length === 1 ? "image was" : "images were"} left out:`,
        color.yellow,
      ),
    );
    for (const item of media.skipped) log(`  ${item.path} — ${item.reason}`);
    if (media.skipped.some((i) => i.reason === "no image encoder available")) {
      log("");
      log(paint(`  ${INSTALL_HINT}`, color.dim));
    }
  }
  log("");

  log("Static files — serve them anywhere:");
  log(paint("  GitHub Pages · Cloudflare Pages · Netlify · S3 · any web root", color.dim));
  log("");
  log("A shareable page for people, and an API for agents, from the same files:");
  log(paint("  people   → <url>/", color.dim));
  log(paint("  n8n      → HTTP GET <url>/brain.json", color.dim));
  log(paint("  ChatGPT  → give it the URL", color.dim));
  log(paint("  agents   → fetch the catalogue, then the dossiers it picks", color.dim));
  return 0;
}

async function cmdList(args) {
  const root = BRAIN_ROOT;
  const entries = await readEntries(root);

  if (entries.length === 0) {
    log(paint("Brain is empty. Run `brain scan`.", color.yellow));
    return 0;
  }

  if (args.flags.json) {
    log(JSON.stringify(entries.map(({ _body, _file, ...e }) => e), null, 2));
    return 0;
  }

  heading(`${entries.length} projects`);
  for (const entry of entries) {
    const gaps = narrativeGaps(entry);
    const mark = gaps.complete ? paint("●", color.green) : paint("○", color.yellow);
    const built = (entry.frameworks ?? entry.ecosystem ?? []).slice(0, 3).join("/");
    log(
      `${mark} ${(entry.name ?? "").padEnd(28)} ${paint((entry.status ?? "—").padEnd(10), color.dim)} ${paint(built, color.dim)}`,
    );
  }

  const gaps = entries.filter((e) => !narrativeGaps(e).complete).length;
  if (gaps) {
    log("");
    log(paint(`${gaps} have no prose yet — ○ marks them.`, color.dim));
  }
  return 0;
}

async function cmdDashboard(args) {
  const root = BRAIN_ROOT;
  const bundle = await buildBundle(root);
  const html = await renderDashboard(bundle);
  const out = brainPaths(root).dashboard;
  await writeFile(out, html, "utf8");

  log(`${paint("Dashboard:", color.bold)} ${out}`);

  if (args.flags.open) {
    const { execFile } = await import("node:child_process");
    const opener =
      process.platform === "darwin" ? "open" : process.platform === "win32" ? "start" : "xdg-open";
    execFile(opener, [out], () => {});
  } else {
    log(paint("Add --open to open it in your browser.", color.dim));
  }
  return 0;
}

async function cmdHelp() {
  let version = null;
  try {
    version = JSON.parse(await readFile(join(__dirname, "..", "package.json"), "utf8")).version;
  } catch {
    /* running from somewhere without the package file */
  }
  for (const line of banner({ version })) log(line);

  log(`
${paint("mother brain", color.bold)} — a manifest of everything you have built

${paint("Setup", color.bold)}
  brain init                 point it at the directories that hold your projects
  brain scan [path...]       pick what belongs, in the terminal
  brain pick [path...]       pick in the browser instead — hands back a command

${paint("Filling the brain", color.bold)}
  brain add [path...]        send projects to the brain (defaults to cwd)
  brain add --from sel.json  send a selection exported from the picking page
  brain ingest --cards       one light briefing for every project (start here)
  brain ingest <id|--all>    a deep briefing for one project's full dossier
  brain list                 what is catalogued, and what still needs a write-up
  brain status               what is done, what is next

${paint("Keeping it current", color.bold)}
  brain refresh              re-read git and structure; never touches your prose
  brain migrate              add fields and sections from a newer schema
  brain build                regenerate brain.json + api/ + dashboard
  brain dashboard --open     build and open the read-only dashboard

${paint("Asking the brain things", color.bold)}
  brain query [text]         filter the catalogue (alias: q)
                             --framework --capability --pattern --kind --status
                             --has-dossier --no-card --public --json
  brain doctor [--fix]       find drift: stale entries, dead paths, gaps
  brain sites [id...]        look for published URLs in deploy configs

${paint("Keeping it current automatically", color.bold)}
  brain hook [path]          add the update instruction to CLAUDE.md / AGENTS.md
                             so your agent refreshes the entry as it works
  brain hook --git [path]    also install a post-commit hook that refreshes it

${paint("Serving it to agents", color.bold)}
  brain wiki --out public/   build the encyclopedia (alias of publish)
  brain publish [--out dir]  static files for any host — no server needed
  brain.json                 the catalogue: every project + a short card
  api/projects/<id>.json     one project's full dossier, fetched on demand
  brain scan --json          every folder found, with structure, as JSON
  brain list --json          the manifest as JSON

${paint("Flags", color.bold)}
  --depth N                  override how deep to scan (it decides on its own)
  --cards                    the cheap pass: a card per project, in one batch
  --all                      ingest every entry that still needs a write-up
  --out DIR                  where publish writes (default: public/)
  --include-private          publish non-public entries too (off by default)
  --title / --author         name the published page
  --json                     machine-readable output
  --open                     open the dashboard after building

The scan reports what each folder is — Next.js, Flutter, WordPress, Go — and
shows internal parts indented under their project. What is worth cataloguing is
your call, not the scanner's.

Entries live in ${paint("projects/<id>.md", color.cyan)} — YAML frontmatter for filtering,
Markdown prose for the part a CV or a post actually needs.
`);
  return 0;
}

// --- entry point -----------------------------------------------------------

const COMMANDS = {
  init: cmdInit,
  scan: cmdScan,
  pick: cmdPick,
  add: cmdAdd,
  send: cmdAdd, // "send to brain"
  ingest: cmdIngest,
  status: cmdStatus,
  query: cmdQuery,
  q: cmdQuery,
  doctor: cmdDoctor,
  sites: cmdSites,
  hook: cmdHook,
  refresh: cmdRefresh,
  migrate: cmdMigrate,
  publish: cmdPublish,
  // `wiki` is what people call the published encyclopedia, so it answers to
  // that name as well as to the verb that describes the mechanism.
  wiki: cmdPublish,
  build: cmdBuild,
  list: cmdList,
  ls: cmdList,
  dashboard: cmdDashboard,
  help: cmdHelp,
};

async function main() {
  // Parse the whole tail first: `brain --version` has no command, so choosing
  // one before reading the flags would treat "--version" as the command name.
  const args = parseArgs(process.argv.slice(2));

  if (args.flags.version || args.flags.v) {
    const pkg = JSON.parse(await readFile(join(__dirname, "..", "package.json"), "utf8"));
    log(pkg.version);
    return 0;
  }

  const command = args._.shift() ?? "help";
  if (args.flags.help || args.flags.h) return cmdHelp();

  const handler = COMMANDS[command];
  if (!handler) {
    log(paint(`Unknown command: ${command}`, color.red));
    return cmdHelp();
  }

  return (await handler(args)) ?? 0;
}

/**
 * Exit without truncating output.
 *
 * `process.exit()` kills the process immediately, before a pipe's buffer has
 * drained — so `brain scan --json | jq` lost everything past 64KB while the
 * same command redirected to a file was complete. Setting `exitCode` lets Node
 * flush and exit on its own.
 */
function finish(code) {
  process.exitCode = code ?? 0;
}

main()
  .then(finish)
  .catch((error) => {
    console.error(paint(`\n${error.message}`, color.red));
    if (process.env.DEBUG) console.error(error.stack);
    finish(1);
  });
