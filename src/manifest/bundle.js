/**
 * The agent-facing bundle.
 *
 * Two tiers, because that split *is* how this scales:
 *
 *   - `brain.json` — every project's typed fields plus its card. This is the
 *     catalogue: an agent reads all of it, always. ~120 words per project
 *     means ~1,100 projects still fit a 200k context.
 *   - `projects/<id>.json` — one project's full dossier, fetched only for the
 *     handful an agent selected.
 *
 * Plus a cross-index (`capabilities`, `patterns`, co-occurrence) so questions
 * like "what do my projects have in common" are answerable from the catalogue
 * alone, without embeddings and without opening a repository.
 *
 * All of it is generated from `projects/*.md`. Deleting it costs one
 * `brain build`, and none of it needs the user's disk to be readable — which is
 * the whole point: the brain can be copied to a server that has never seen the
 * code.
 */

import { mkdir, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";

import { brainPaths, readEntries, narrativeGaps } from "./store.js";
import { CARD_SECTION } from "./schema.js";
import { confirmedImages } from "../scan/images.js";

/**
 * How many changelog entries ride along in the card tier.
 *
 * Enough to answer "what have you shipped lately" from the catalogue alone;
 * few enough that a developer with sixty projects and years of history does
 * not pay for all of it on every read. The full list is in the dossier.
 */
const CHANGELOG_IN_CARD = 3;

/**
 * Strip TODO scaffolding so consumers receive prose, not prompts.
 *
 * The pattern must not require a colon: the card's placeholder is written
 * `<!-- TODO (~120 words): … -->`, and an earlier version of this regex missed
 * it — which published the writing instructions to the page as though they
 * were the project's description. An unwritten section must read as absent,
 * never as content.
 */
function cleanBody(body) {
  return body
    .replace(/<!--\s*TODO[\s\S]*?-->/g, "")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

/** An unwritten section is absent, not empty-stringed. */
function orNull(text) {
  const trimmed = (text ?? "").trim();
  return trimmed === "" ? null : trimmed;
}

/** Split a body into `{ heading: text }` for section-level retrieval. */
function sectionize(body) {
  const sections = {};
  const parts = body.split(/^##\s+/m).slice(1);
  for (const part of parts) {
    const newline = part.indexOf("\n");
    const heading = (newline === -1 ? part : part.slice(0, newline)).trim();
    const text = newline === -1 ? "" : cleanBody(part.slice(newline + 1));
    // Only sections that actually say something are carried forward.
    if (heading && orNull(text)) sections[heading] = text;
  }
  return sections;
}

function tally(entries, pick) {
  const counts = new Map();
  for (const entry of entries) {
    for (const value of [pick(entry)].flat()) {
      if (value === null || value === undefined || value === "") continue;
      counts.set(value, (counts.get(value) ?? 0) + 1);
    }
  }
  return Object.fromEntries([...counts.entries()].sort((a, b) => b[1] - a[1]));
}

/**
 * Group project ids by a facet, so an agent can jump straight from
 * "asset-generation" to the four projects that do it.
 */
function groupBy(projects, pick) {
  const groups = new Map();
  for (const project of projects) {
    for (const value of [pick(project)].flat()) {
      if (!value) continue;
      if (!groups.has(value)) groups.set(value, []);
      groups.get(value).push(project.id);
    }
  }
  return Object.fromEntries(
    [...groups.entries()]
      .sort((a, b) => b[1].length - a[1].length)
      .map(([key, ids]) => [key, ids.sort()]),
  );
}

/**
 * Pairs of projects that share facets, strongest first.
 *
 * This is the cheap answer to "what relates to what": an agent asked to find a
 * pattern across a portfolio reads this instead of comparing every project to
 * every other one itself.
 */
function coOccurrence(projects, limit = 60) {
  const pairs = new Map();

  for (let i = 0; i < projects.length; i += 1) {
    for (let j = i + 1; j < projects.length; j += 1) {
      const a = projects[i];
      const b = projects[j];

      const shared = {
        capabilities: intersect(a.capabilities, b.capabilities),
        patterns: intersect(a.patterns, b.patterns),
        frameworks: intersect(a.frameworks, b.frameworks),
        domain: a.domain && a.domain === b.domain ? [a.domain] : [],
      };

      // Capabilities and patterns say far more about kinship than a shared
      // dependency: two projects both using React is nearly noise.
      const weight =
        shared.capabilities.length * 3 +
        shared.patterns.length * 3 +
        shared.domain.length * 2 +
        shared.frameworks.length;

      if (weight < 3) continue;
      pairs.set(`${a.id}|${b.id}`, { pair: [a.id, b.id], weight, shared });
    }
  }

  return [...pairs.values()]
    .sort((x, y) => y.weight - x.weight)
    .slice(0, limit);
}

function intersect(a = [], b = []) {
  const set = new Set(b);
  return (a ?? []).filter((x) => set.has(x));
}

/**
 * Read the author's documents from disk, verbatim.
 *
 * These are the most objective content the brain holds — the author wrote them,
 * so carrying them is transcription. They travel in full in the agent tier so a
 * consumer can read primary sources instead of anyone's summary of them.
 */
async function readDocuments(entry) {
  const root = entry.source?.path;
  // Hand-edited frontmatter can put anything here, and a malformed value must
  // not take the whole build down.
  const raw = entry.documents;
  const declared = Array.isArray(raw) ? raw : raw && typeof raw === "object" ? [raw] : [];
  if (!root || declared.length === 0) return [];

  const out = [];
  for (const doc of declared) {
    const path = typeof doc === "string" ? doc : doc.path;
    if (!path) continue;
    const summary = typeof doc === "string" ? null : (doc.summary ?? null);
    try {
      const text = await readFile(join(root, path), "utf8");
      out.push({ path, summary, words: text.split(/\s+/).filter(Boolean).length, text });
    } catch {
      // A document named in the entry but missing from disk: reported as such
      // rather than dropped, since a moved file is worth noticing.
      out.push({ path, summary, words: 0, text: null, missing: true });
    }
  }
  return out;
}

/** Everything about one project, for the per-project dossier file. */
function fullProject(entry) {
  const body = entry._body ?? "";
  const gaps = narrativeGaps(entry);
  const sections = sectionize(body);
  const card = orNull(sections[CARD_SECTION.heading]);

  return {
    id: entry.id,
    name: entry.name,
    tagline: entry.tagline ?? null,
    status: entry.status ?? null,
    visibility: entry.visibility ?? null,
    kind: entry.kind ?? null,
    ecosystem: entry.ecosystem ?? [],
    frameworks: entry.frameworks ?? [],
    architecture: entry.architecture ?? null,
    domain: entry.domain ?? null,
    capabilities: entry.capabilities ?? [],
    patterns: entry.patterns ?? [],
    relates_to: entry.relates_to ?? [],
    documents: [],
    // Only what the author looked at and confirmed. Unconfirmed proposals stay
    // in the entry file and never reach a consumer.
    images: confirmedImages(entry.images),
    role: entry.role ?? null,
    started: entry.started ?? null,
    last_active: entry.last_active ?? null,
    links: entry.links ?? {},
    tags: entry.tags ?? [],
    highlights: entry.highlights ?? [],
    metrics: entry.metrics ?? {},
    changelog: entry.changelog ?? [],
    source: entry.source ?? {},
    card,
    dossier: {
      status: entry.narrative_status ?? "missing",
      complete: gaps.complete,
      todos: gaps.todos,
      sections: Object.fromEntries(
        Object.entries(sections).filter(([h]) => h !== CARD_SECTION.heading),
      ),
    },
  };
}

/** The index-level view: enough to choose, never the whole dossier. */
function indexProject(full) {
  return {
    id: full.id,
    name: full.name,
    tagline: full.tagline,
    status: full.status,
    visibility: full.visibility,
    kind: full.kind,
    ecosystem: full.ecosystem,
    frameworks: full.frameworks,
    architecture: full.architecture,
    domain: full.domain,
    capabilities: full.capabilities,
    patterns: full.patterns,
    relates_to: full.relates_to,
    started: full.started,
    last_active: full.last_active,
    links: full.links,
    tags: full.tags,
    highlights: full.highlights,
    metrics: full.metrics,
    // The newest entries only: enough to answer "what shipped recently"
    // from the catalogue, without fetching every dossier to find out.
    changelog: (full.changelog ?? []).slice(0, CHANGELOG_IN_CARD),
    card: full.card,
    // Inventory only: what the author wrote and roughly how much of it. The
    // text itself is in the dossier, so a reader can decide what to open and
    // an agent can fetch the primary source.
    documents: (full.documents ?? []).map((d) => ({
      path: d.path,
      summary: d.summary,
      words: d.words,
      ...(d.missing ? { missing: true } : {}),
    })),
    images: full.images ?? [],
    // The catalogue has to say where a project lives, or a local agent reading
    // brain.json cannot open it and `brain add` cannot recognise an entry it
    // already holds. Publishing strips this field separately, so carrying it
    // here costs the published copy nothing.
    source: full.source ?? {},
    dossier: {
      status: full.dossier.status,
      complete: full.dossier.complete,
      // Where the deep read lives, if this project turns out to be relevant.
      href: `projects/${full.id}.json`,
      sections: Object.keys(full.dossier.sections),
    },
  };
}

/**
 * Compile the manifest.
 *
 * @param {string} root brain root
 * @returns {Promise<object>} the index bundle
 */
export async function buildBundle(root) {
  const entries = await readEntries(root);
  const full = entries.map(fullProject);

  // Documents are read from the projects themselves, so the brain carries the
  // author's own words rather than a description of them.
  for (const [index, project] of full.entries()) {
    project.documents = await readDocuments(entries[index]);
  }

  const projects = full.map(indexProject);

  const documented = projects.filter((p) => p.dossier.complete).length;
  const carded = projects.filter((p) => Boolean(p.card)).length;

  const bundle = {
    $schema: "https://motherbrain.dev/schema/brain-v2.json",
    version: 2,
    generated: new Date().toISOString(),
    // Said plainly, because the first thing a consuming agent needs to know is
    // how to use this file rather than guess at it.
    usage:
      "This is the catalogue: every project, with a short card and an inventory " +
      "of the author's own documents. Read all of it. When a project is " +
      "relevant, fetch its dossier at `dossier.href` — that carries the full " +
      "write-up plus the complete text of every listed document. " +
      "`index.capabilities` and `index.patterns` map a facet to project ids; " +
      "`index.related` lists project pairs that share facets. Everything here " +
      "is descriptive: what each project is, does, and runs on. Any judgement " +
      "about significance or quality is yours to make, not the brain's.",
    counts: {
      projects: projects.length,
      carded,
      documented,
      public: projects.filter((p) => p.visibility === "public").length,
      shipped: projects.filter((p) => p.status === "live" || p.status === "shipped").length,
    },
    index: {
      capabilities: groupBy(projects, (p) => p.capabilities),
      patterns: groupBy(projects, (p) => p.patterns),
      frameworks: groupBy(projects, (p) => p.frameworks),
      ecosystem: groupBy(projects, (p) => p.ecosystem),
      kind: groupBy(projects, (p) => p.kind),
      domain: groupBy(projects, (p) => p.domain),
      tags: groupBy(projects, (p) => p.tags),
      status: tally(projects, (p) => p.status),
      related: coOccurrence(projects),
    },
    projects,
  };

  const paths = brainPaths(root);
  await writeFile(paths.bundle, `${JSON.stringify(bundle, null, 2)}\n`, "utf8");

  // Per-project dossiers, fetched only when selected.
  const dossierDir = join(paths.root, "api", "projects");
  await mkdir(dossierDir, { recursive: true });
  for (const project of full) {
    await writeFile(
      join(dossierDir, `${project.id}.json`),
      `${JSON.stringify(project, null, 2)}\n`,
      "utf8",
    );
  }

  return bundle;
}
