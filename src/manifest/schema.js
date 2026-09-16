/**
 * The manifest entry contract.
 *
 * One project = one Markdown file with YAML frontmatter:
 *
 *   - frontmatter carries *typed* fields, so agents can filter and cross-
 *     reference ("every project that generates assets", "everything that
 *     shares the browser-local-processing pattern")
 *   - the body carries *prose*, because an article or a CV needs the
 *     "why I built this", and that never lives in a JSON field
 *
 * ## Two tiers, on purpose
 *
 * The body has two levels, and the split is the indexing strategy:
 *
 *   - the **card** (~120 words) is what every agent reads for every project
 *   - the **dossier** (the sections below) is what it reads for the few it
 *     chose
 *
 * Measured: an index of cards fits ~1,100 projects in a 200k context, while
 * full dossiers cap out around 88. So an agent with 375 projects reads 375
 * cards (~68k tokens), picks five, and reads those five dossiers — the way you
 * use a library catalogue rather than reading the library.
 *
 * That is also why there is no vector database here. At this scale a model
 * reading every card *reasons* over the set ("these eight share local-first
 * processing, and these three for the same reason"), which a cosine-similarity
 * lookup cannot do. Embeddings become necessary past ~1,000 projects, and the
 * fields below are exactly what they would be computed from — no migration,
 * no work thrown away.
 *
 * Files stay the source of truth, so the whole brain is a directory you can
 * copy to a server that has never seen your code.
 */

/** Fields written into every entry's frontmatter, in this order. */
export const FRONTMATTER_FIELDS = [
  "id",
  "name",
  "tagline",
  "status",
  "visibility",
  "kind",
  "ecosystem",
  "frameworks",
  "architecture",
  "domain",
  "capabilities",
  "patterns",
  "relates_to",
  "documents",
  "images",
  "role",
  "started",
  "last_active",
  "links",
  "source",
  "tags",
  "highlights",
  "metrics",
  "changelog",
  "added_to_brain",
  "narrative_status",
];

/** Allowed values. Kept small on purpose: a vocabulary you can actually hold. */
export const ENUMS = {
  status: ["idea", "prototype", "wip", "shipped", "live", "paused", "archived"],
  visibility: ["public", "private", "client", "internal"],
  kind: [
    "web-app",
    "website",
    "landing",
    "docs-site",
    "mobile-app",
    "desktop-app",
    "game",
    "cli",
    "library",
    "api",
    "service",
    "agent",
    "tool",
    "content-pipeline",
    "monorepo",
    "experiment",
    "platform-scaffold",
    "unknown",
  ],
  narrative_status: ["missing", "card", "dossier", "reviewed"],
};

/**
 * The card: the index level.
 *
 * Every agent reads this for every project, so it is deliberately short and
 * deliberately self-contained — enough to decide "is this one relevant to what
 * I was asked", never enough to need the repository.
 */
export const CARD_SECTION = {
  heading: "Card",
  target_words: 120,
  prompt:
    "Under 120 words, self-contained and factual: what this is, who uses it, what it does, and how it is built at a glance. No stack list — the frontmatter already has that. No claims about quality or significance. Written so a reader who sees nothing else knows what the project is and can decide whether it is relevant to them.",
};

/**
 * The dossier: read only for the projects an agent selected.
 *
 * Deep enough that an article can be written from it without opening the repo,
 * because the consumer (a content pipeline, a hosted agent, a cron job) will
 * not have the code.
 */
/**
 * The dossier sections.
 *
 * Every one asks for something **verifiable**: what the software does, how it
 * is assembled, what state it is in. A reader can open the repository and
 * contradict any sentence here.
 *
 * Two earlier sections — "Notable decisions" and "Transferable insight" — were
 * removed on purpose. They asked for judgement and produced essays: which
 * choice *mattered*, what *lesson* transfers. However well written, that is one
 * agent's reading of someone else's work, shipped inside the data and
 * indistinguishable from fact once quoted. Analysis belongs to whoever consumes
 * the brain — their agent, their prompts, their conclusions — and the brain's
 * job is to give them facts good enough to reason over.
 */
export const SECTIONS = [
  {
    heading: "What it is",
    prompt:
      "What the software does and who uses it, in plain terms a stranger understands. Describe behaviour, not merit.",
  },
  {
    heading: "What it does",
    prompt:
      "The features, concretely: what a user can actually do with it, screen by screen or capability by capability. What exists, not what is planned — and mark anything incomplete as incomplete.",
  },
  {
    heading: "How it works",
    prompt:
      "The mechanism. Data flow from input to output, where state lives, which parts run where (device, server, worker, browser), what talks to what. Enough that someone could describe the system without opening the repository.",
  },
  {
    heading: "Architecture",
    prompt:
      "The structure: modules or layers and their responsibilities, the pattern the code follows, the storage and its schema. Report how it is organised, not whether that was wise.",
  },
  {
    heading: "Stack and dependencies",
    prompt:
      "What it is built on and what each significant piece is used for — framework, storage, auth, payments, third-party services, models. Include versions and hosting where they are stated in the project.",
  },
  {
    heading: "Constraints and requirements",
    prompt:
      "What it needs to run and what it cannot do: platform and version minimums, required keys or accounts, known limitations, unsupported cases. Take these from the project's own docs and configuration.",
  },
  {
    heading: "State",
    prompt:
      "Where the project stands: what is built versus planned, whether it shipped and where, test counts and deployment facts if the project records them. Only figures the project or its author states — never an estimate, and record the absence of data as absence.",
  },
];

/** Every heading the body may hold, card first. */
export const ALL_SECTIONS = [CARD_SECTION, ...SECTIONS];

/**
 * Headings this schema used to ship and no longer does.
 *
 * Migration has to tell two things apart: a heading the *author* invented,
 * which is theirs and must survive untouched, and a heading that was once a
 * default of ours, which is not. Without this list every retired default would
 * be mistaken for the author's own section and kept forever — so an entry would
 * accumulate both the old essay prompts and the new descriptive ones.
 *
 * Retired here because each asked for judgement rather than fact: which choice
 * mattered, what lesson transfers, what the project *proposes*. That analysis
 * belongs to whoever consumes the brain, made with their own prompts.
 */
export const RETIRED_SECTIONS = new Set([
  "The problem",
  "What it proposes",
  "Notable decisions",
  "Hard problems",
  "Transferable insight",
  "Outcome",
]);

/**
 * Relational vocabulary.
 *
 * These are the fields that let an agent answer "what do my projects have in
 * common" without a vector index, and they are also what a vector index would
 * later be built from. Free-form on purpose — the suggestions below are a
 * starting vocabulary, not a closed list, because nobody can enumerate in
 * advance what a stranger's projects will be about.
 */
export const SUGGESTED_CAPABILITIES = [
  "asset-generation",
  "video-pipeline",
  "image-generation",
  "audio-processing",
  "text-generation",
  "payments",
  "authentication",
  "realtime-sync",
  "offline-first",
  "geolocation",
  "push-notifications",
  "scraping",
  "search",
  "recommendation",
  "scheduling",
  "reporting",
  "file-upload",
  "pdf-generation",
  "ocr",
  "chat",
  "multiplayer",
  "physics-simulation",
  "procedural-generation",
];

export const SUGGESTED_PATTERNS = [
  "browser-local-processing",
  "hexagonal-architecture",
  "feature-sliced",
  "container-presentational",
  "event-driven",
  "cqrs",
  "monorepo-workspaces",
  "serverless-functions",
  "edge-rendering",
  "static-generation",
  "optimistic-ui",
  "state-machine",
  "repository-pattern",
  "two-pass-llm",
  "worker-offloading",
  "queue-backed-jobs",
];

/**
 * Build a manifest entry from a scanned project record.
 *
 * Only facts the scanner can verify are written. `status`, `architecture`,
 * `domain`, `capabilities`, `patterns` and the prose are left for the ingest
 * step, which actually reads the project — guessing them would put fiction
 * into every article and CV generated downstream.
 */
export function entryFromScan(project, opts = {}) {
  const today = opts.today ?? new Date().toISOString().slice(0, 10);

  return {
    id: slugify(project.name ?? project.dirName),
    name: project.name ?? project.dirName,
    tagline: project.description ?? null,
    status: null,
    visibility: project.git?.likelyOpenSource ? "public" : null,
    kind: project.kind ?? "unknown",
    ecosystem: project.ecosystems ?? [],
    frameworks: project.frameworks ?? [],
    architecture: null,
    domain: null,
    capabilities: [],
    patterns: [],
    relates_to: [],
    // The author's own documents, carried verbatim. Their words are the most
    // objective content the brain holds: transcription, not interpretation.
    documents: (project.docs ?? []).map((path) => ({ path, summary: null })),
    // Proposed, never published until the author confirms. A screenshot can
    // expose a customer's name or a token in a URL bar, and no text search
    // will catch it — only a person looking at the picture will.
    images: project.images ?? [],
    role: "author",
    started: project.git?.firstCommit ?? null,
    last_active: project.git?.lastCommit ?? null,
    links: {
      site: project.homepage ?? null,
      repo: project.git?.likelyOpenSource ? project.git.remote : null,
      demo: null,
      docs: null,
    },
    source: {
      path: project.path,
      structure: project.role ?? "project",
      part_of: project.nestedUnder ?? null,
      git: project.git?.isRepo ?? false,
      remote: project.git?.remote ?? null,
      branch: project.git?.branch ?? null,
      commits: project.git?.commits ?? 0,
      deploy: project.deploy ?? [],
      docs: project.docs ?? [],
    },
    tags: [],
    highlights: [],
    metrics: {},
    // Written when work closes, by whoever closed it — never inferred from a
    // commit log. "fix in the fuckin victory door" is a real commit subject
    // from a real repository here; a raw log is not something anyone can
    // publish. The entry that describes what shipped is written by the agent
    // or person who had the context, which is why this starts empty.
    changelog: [],
    added_to_brain: today,
    narrative_status: "missing",
  };
}

export function slugify(input) {
  return (
    String(input)
      .normalize("NFKD")
      .replace(/[̀-ͯ]/g, "")
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-+|-+$/g, "")
      .slice(0, 64) || "project"
  );
}
