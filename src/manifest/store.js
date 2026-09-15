/**
 * Reading and writing the manifest.
 *
 * `projects/<id>.md` is the source of truth. Nothing else in Mother Brain may
 * be the only home of a fact: the JSON bundle, the dashboard and any memory
 * backend are all derived and safe to delete.
 *
 * Writes never clobber a human's prose. An existing entry keeps its body and
 * every field a person may have edited; only machine-owned facts refresh.
 */

import { mkdir, readdir, readFile, writeFile, stat } from "node:fs/promises";
import { join, resolve } from "node:path";

import { buildDocument, parseDocument } from "./yaml.js";
import {
  FRONTMATTER_FIELDS,
  ALL_SECTIONS,
  RETIRED_SECTIONS,
  entryFromScan,
} from "./schema.js";

/**
 * Fields the scanner owns and may overwrite on re-sync. Everything else — the
 * prose, the status, the architecture, anything a person decided — is theirs,
 * and a refresh must never touch it.
 */
const MACHINE_OWNED = new Set([
  "source",
  "last_active",
  "started",
  "ecosystem",
  "frameworks",
]);

/**
 * Merge freshly discovered image proposals into an entry.
 *
 * A refresh must never undo a decision the author made by looking at a
 * picture: confirmations and alt text survive, new candidates arrive
 * unconfirmed, and a file that has since been deleted from the project drops
 * out. This is why `images` is not simply machine-owned.
 */
function mergeImages(existing, discovered) {
  const previous = new Map(
    (Array.isArray(existing) ? existing : [])
      .filter((image) => image && image.path)
      .map((image) => [image.path, image]),
  );

  const merged = (discovered ?? []).map((candidate) => {
    const before = previous.get(candidate.path);
    if (!before) return candidate;
    return {
      ...candidate,
      alt: before.alt ?? candidate.alt ?? null,
      confirmed: before.confirmed === true,
    };
  });

  // A path the author confirmed by hand, outside what discovery proposes,
  // stays: they named it deliberately.
  const discoveredPaths = new Set(merged.map((image) => image.path));
  for (const [path, image] of previous) {
    if (discoveredPaths.has(path) || image.confirmed !== true) continue;
    merged.push(image);
  }

  return merged.sort((a, b) => a.path.localeCompare(b.path));
}

/**
 * Bring an entry written under an older schema up to the current one.
 *
 * Adds missing frontmatter fields and missing body sections, and never removes
 * or reorders what a human already wrote. An entry that predates the card/
 * dossier split would otherwise stay invisible to the two-tier bundle.
 */
export function migrateEntry(entry) {
  const frontmatter = { ...entry };
  delete frontmatter._file;
  delete frontmatter._body;

  for (const [field, empty] of [
    ["capabilities", []],
    ["patterns", []],
    ["relates_to", []],
    ["highlights", []],
    ["tags", []],
    ["metrics", {}],
    ["documents", []],
    ["images", []],
  ]) {
    if (frontmatter[field] === undefined || frontmatter[field] === null) {
      frontmatter[field] = empty;
    }
  }

  // `narrative_status` gained a vocabulary; the old "draft"/"written" values
  // map onto the tier they actually describe.
  const status = frontmatter.narrative_status;
  if (status === "draft") frontmatter.narrative_status = "card";
  else if (status === "written") frontmatter.narrative_status = "dossier";

  // Documents the scanner found, seeded so the ingest step has a list to
  // summarise. Paths already declared keep whatever summary they carry.
  if (Array.isArray(frontmatter.documents) && frontmatter.documents.length === 0) {
    const found = entry.source?.docs ?? [];
    frontmatter.documents = found.map((path) => ({ path, summary: null }));
  }

  // Image proposals are seeded by `brain refresh`, which re-scans; migration
  // only makes sure the field exists so a confirmation has somewhere to go.
  if (!Array.isArray(frontmatter.images)) frontmatter.images = [];

  // Sections were retired, so prose written under them is no longer carried.
  // An entry that loses content is no longer fully written up, and saying so
  // is what sends it back through ingest rather than leaving a gap unnoticed.
  const hadRetired = [...(entry._body ?? "").matchAll(/^##\s+(.+)$/gm)].some((m) =>
    RETIRED_SECTIONS.has(m[1].trim()),
  );
  if (hadRetired && frontmatter.narrative_status === "reviewed") {
    frontmatter.narrative_status = "dossier";
  }

  const body = mergeSections(entry._body ?? "");
  return { frontmatter, body };
}

/**
 * Rebuild a body so every schema section is present, in schema order, without
 * altering a single word a human wrote.
 *
 * Appending missing sections at the end was wrong: `Outcome` closes the
 * dossier, so a later schema adding `Hard problems` would strand it in the
 * middle. Anything the author added that the schema does not know about is
 * kept, after the known sections, rather than silently dropped.
 */
function mergeSections(body) {
  const matches = [...body.matchAll(/^##\s+(.+)$/gm)];

  // Everything before the first heading — the title, a tagline quote — leads.
  const preamble = (matches.length ? body.slice(0, matches[0].index) : body).trimEnd();

  const existing = new Map();
  for (const [index, match] of matches.entries()) {
    const heading = match[1].trim();
    const start = match.index + match[0].length;
    const end = index + 1 < matches.length ? matches[index + 1].index : body.length;
    existing.set(heading, body.slice(start, end).trim());
  }

  const known = new Set(ALL_SECTIONS.map((s) => s.heading));
  const parts = preamble ? [preamble, ""] : [];

  for (const section of ALL_SECTIONS) {
    parts.push(`## ${section.heading}`, "");
    const content = existing.get(section.heading);
    if (content) {
      parts.push(content, "");
    } else {
      const budget = section.target_words ? ` (~${section.target_words} words)` : "";
      parts.push(`<!-- TODO${budget}: ${section.prompt} -->`, "");
    }
  }

  // Headings the author invented are theirs and stay. Headings that were once
  // our defaults are not: keeping them would leave every entry carrying both
  // the retired prompts and the current ones.
  for (const [heading, content] of existing) {
    if (known.has(heading) || RETIRED_SECTIONS.has(heading)) continue;
    parts.push(`## ${heading}`, "", content, "");
  }

  return parts.join("\n");
}

/**
 * Apply `migrateEntry` to every entry on disk.
 */
export async function migrateAll(root) {
  const entries = await readEntries(root);
  const changed = [];

  for (const entry of entries) {
    const before = await readFile(entry._file, "utf8");
    const { frontmatter, body } = migrateEntry(entry);
    const after = buildDocument(frontmatter, body, FRONTMATTER_FIELDS);
    if (after === before) continue;
    await writeFile(entry._file, after, "utf8");
    changed.push({ id: entry.id, name: entry.name });
  }

  return changed;
}

/**
 * Re-read machine-owned facts for every catalogued project, leaving prose and
 * human judgement untouched. Safe to run from a git hook or CI — which is how
 * a brain stays current without anyone remembering to update it.
 */
export async function refreshEntries(root, scan, only = null) {
  const entries = await readEntries(root);
  const results = { refreshed: [], missing: [] };
  // `brain doctor --fix` repairs named entries. Rewriting the whole catalogue
  // to fix one of them would touch twenty-five files that had nothing wrong,
  // and a repair that reaches further than the problem is not a repair.
  const wanted = only ? new Set(only) : null;

  for (const entry of entries) {
    if (wanted && !wanted.has(entry.id)) continue;

    const path = entry.source?.path;
    if (!path) continue;

    const found = await scan([path], { maxDepth: 3, includeRoot: true });
    const project = found.find((p) => p.path === path);

    if (!project) {
      results.missing.push({ id: entry.id, path });
      continue;
    }

    const fresh = entryFromScan(project, { today: entry.added_to_brain });
    const merged = { ...entry };
    for (const key of MACHINE_OWNED) {
      if (fresh[key] !== undefined && fresh[key] !== null) merged[key] = fresh[key];
    }

    // Documents and images are discovered, but both carry human judgement —
    // a document's summary and an image's confirmation — so they merge rather
    // than overwrite.
    merged.images = mergeImages(entry.images, fresh.images);

    const previousDocs = new Map(
      (Array.isArray(entry.documents) ? entry.documents : [])
        .filter((doc) => doc && doc.path)
        .map((doc) => [doc.path, doc]),
    );
    merged.documents = (fresh.documents ?? []).map((doc) => ({
      path: doc.path,
      summary: previousDocs.get(doc.path)?.summary ?? null,
    }));

    delete merged._file;
    delete merged._body;
    await writeFile(
      entry._file,
      buildDocument(merged, entry._body ?? "", FRONTMATTER_FIELDS),
      "utf8",
    );
    results.refreshed.push({ id: entry.id, name: entry.name });
  }

  return results;
}

export function brainPaths(root) {
  const base = resolve(root);
  return {
    root: base,
    projects: join(base, "projects"),
    bundle: join(base, "brain.json"),
    config: join(base, "brain.config.json"),
    dashboard: join(base, "index.html"),
  };
}

export async function ensureBrain(root) {
  const paths = brainPaths(root);
  await mkdir(paths.projects, { recursive: true });
  return paths;
}

/** Render the Markdown body for a fresh entry: prompts an agent can fill. */
export function renderBody(entry, seed = {}) {
  const parts = [`# ${entry.name}`, ""];

  if (entry.tagline) {
    parts.push(`> ${entry.tagline}`, "");
  }

  for (const section of ALL_SECTIONS) {
    parts.push(`## ${section.heading}`, "");
    const provided = seed[section.heading];
    if (provided) {
      parts.push(provided.trim(), "");
    } else {
      const budget = section.target_words ? ` (~${section.target_words} words)` : "";
      parts.push(`<!-- TODO${budget}: ${section.prompt} -->`, "");
    }
  }

  return parts.join("\n");
}

/**
 * Write (or refresh) one project entry.
 *
 * @param {string} root         brain root
 * @param {object} entry        a schema entry
 * @param {object} [opts]
 * @param {string} [opts.body]  body to use for a brand-new entry
 * @returns {Promise<{ path: string, created: boolean }>}
 */
export async function writeEntry(root, entry, opts = {}) {
  const paths = await ensureBrain(root);
  const file = join(paths.projects, `${entry.id}.md`);

  let existing = null;
  try {
    existing = await readFile(file, "utf8");
  } catch {
    /* new entry */
  }

  if (!existing) {
    const body = opts.body ?? renderBody(entry);
    await writeFile(file, buildDocument(entry, body, FRONTMATTER_FIELDS), "utf8");
    return { path: file, created: true };
  }

  // Refresh: machine facts win, human fields and prose are preserved.
  const { frontmatter, body } = parseDocument(existing);
  const merged = { ...entry, ...frontmatter };
  for (const key of MACHINE_OWNED) {
    if (entry[key] !== undefined && entry[key] !== null) merged[key] = entry[key];
  }
  // A human who filled the narrative outranks the scanner's guess.
  if (frontmatter.narrative_status && frontmatter.narrative_status !== "missing") {
    merged.narrative_status = frontmatter.narrative_status;
  }

  await writeFile(file, buildDocument(merged, body, FRONTMATTER_FIELDS), "utf8");
  return { path: file, created: false };
}

/** Read every entry in the manifest. */
export async function readEntries(root) {
  const paths = brainPaths(root);
  let files;
  try {
    files = await readdir(paths.projects);
  } catch {
    return [];
  }

  const entries = [];
  for (const file of files) {
    if (!file.endsWith(".md")) continue;
    const full = join(paths.projects, file);
    try {
      const text = await readFile(full, "utf8");
      const { frontmatter, body } = parseDocument(text);
      entries.push({
        ...frontmatter,
        id: frontmatter.id ?? file.replace(/\.md$/, ""),
        _file: full,
        _body: body,
      });
    } catch {
      /* unreadable entry — skip rather than fail the whole read */
    }
  }
  return entries.sort((a, b) => (a.name ?? "").localeCompare(b.name ?? ""));
}

/** Count how much prose is still a TODO, per entry. */
export function narrativeGaps(entry) {
  const body = entry._body ?? "";
  const todos = [...body.matchAll(/<!--\s*TODO/g)].length;
  return { todos, complete: todos === 0 };
}

/** Add scanned projects to the manifest, skipping ones already present. */
export async function addProjects(root, projects, opts = {}) {
  const existing = await readEntries(root);
  const byPath = new Map(
    existing.map((e) => [e.source?.path, e]).filter(([p]) => Boolean(p)),
  );
  const byId = new Map(existing.map((e) => [e.id, e]));

  const results = { created: [], refreshed: [], skipped: [] };

  for (const project of projects) {
    const entry = entryFromScan(project, opts);

    // Same path already catalogued -> refresh in place under its known id.
    const known = byPath.get(project.path);
    if (known) {
      entry.id = known.id;
      const { path } = await writeEntry(root, entry);
      results.refreshed.push({
        id: entry.id,
        name: entry.name,
        path,
        sourcePath: project.path,
      });
      continue;
    }

    // Id collision from a different path -> disambiguate rather than overwrite.
    if (byId.has(entry.id)) {
      const parent = project.path.split("/").slice(-2, -1)[0] ?? "alt";
      entry.id = `${entry.id}-${parent}`.toLowerCase().replace(/[^a-z0-9-]/g, "-");
    }

    const { path, created } = await writeEntry(root, entry);
    byId.set(entry.id, entry);
    (created ? results.created : results.refreshed).push({
      id: entry.id,
      name: entry.name,
      path,
      sourcePath: project.path,
    });
  }

  return results;
}

export async function pathExists(p) {
  try {
    await stat(p);
    return true;
  } catch {
    return false;
  }
}
