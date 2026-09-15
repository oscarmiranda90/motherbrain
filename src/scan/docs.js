/**
 * Which documents belong in the brain.
 *
 * A project's Markdown files are the author's own statements — they wrote them,
 * so carrying them is transcription, not interpretation. That makes them the
 * most objective content the brain can hold, and they travel verbatim.
 *
 * But not every `.md` is a statement about the project. Repositories
 * accumulate a second kind: handoff notes between sessions, task lists,
 * generated inventories, scratch plans. Those are working artifacts — real, but
 * written to coordinate work rather than to describe the thing. Embedding them
 * would fill a public page with session logs and give a consuming agent mostly
 * operational noise.
 *
 * So: a conservative allowlist of conventional names, which the author can
 * extend per project. The default never surprises anyone — a `HANDOFF_TO_*.md`
 * appearing on someone's public page on their first `brain publish` is exactly
 * the failure to avoid — and widening it is an explicit decision by the person
 * whose work it is.
 */

/**
 * Conventional documents that describe a project.
 *
 * Matched case-insensitively against the basename without extension, so
 * `readme`, `README.md` and `Readme.markdown` all resolve the same way.
 */
export const CANONICAL_DOCS = new Set([
  // What it is
  "readme",
  "about",
  "overview",
  "product",
  "brief",
  "idea",
  "proposal",
  "vision",
  "spec",
  "specification",
  "manifesto",
  // How it is built
  "design",
  "architecture",
  "adr",
  "decisions",
  "rfc",
  // How to work on it
  "contributing",
  "development",
  "developing",
  "setup",
  "install",
  "installation",
  "usage",
  "api",
  "faq",
  // Agent and assistant instructions — the author's standing directions
  "agents",
  "claude",
  "cursor",
  "copilot",
  "windsurf",
  "aider",
  "gemini",
  "llms",
  // Brand and voice
  "brand",
  "style",
  "styleguide",
  "voice",
  // Legal and policy
  "license",
  "licence",
  "terms",
  "privacy",
  "security",
  "code_of_conduct",
  "code-of-conduct",
  "codeofconduct",
  "support",
  // History
  "changelog",
  "changes",
  "history",
  "releases",
  "roadmap",
  "authors",
  "contributors",
  "credits",
]);

/**
 * Names and shapes that mark a working artifact rather than a description.
 *
 * These are only consulted for files that did not match the allowlist; they
 * exist to explain *why* something was skipped, which makes the default
 * auditable instead of merely opaque.
 */
const PROCEDURAL_PATTERNS = [
  [/^handoff/i, "handoff note"],
  [/handoff/i, "handoff note"],
  [/^(tasks?|todos?|backlog)$/i, "task list"],
  [/^(notes?|scratch|draft|wip|tmp|temp)$/i, "working notes"],
  [/[-_]plan$/i, "plan document"],
  [/^plan[-_]/i, "plan document"],
  [/^(progress|status|state|session|log|journal)$/i, "session record"],
  [/^audit$/i, "audit output"],
  [/generated/i, "generated inventory"],
  [/^prompts?$/i, "prompt collection"],
  [/prompts$/i, "prompt collection"],
  [/^(report|summary|analysis)$/i, "report output"],
  [/^(migration|upgrade)[-_]/i, "migration note"],
  [/^v\d+[-_]/i, "versioned working doc"],
  [/[-_]v\d+$/i, "versioned working doc"],
  [/^(test|testing|coverage)[-_]/i, "test record"],
  [/^skill/i, "agent skill file"],
  [/skill$/i, "agent skill file"],
];

/** Directories whose contents are never project descriptions. */
const SKIP_DOC_DIRS = [
  /(^|\/)node_modules(\/|$)/,
  /(^|\/)\.git(\/|$)/,
  /(^|\/)build(\/|$)/,
  /(^|\/)dist(\/|$)/,
  /(^|\/)vendor(\/|$)/,
  /(^|\/)\.dart_tool(\/|$)/,
  /(^|\/)Pods(\/|$)/,
  /(^|\/)coverage(\/|$)/,
  /(^|\/)\.github(\/)?ISSUE_TEMPLATE(\/|$)/,
  /(^|\/)openspec(\/|$)/,
  /(^|\/)\.changeset(\/|$)/,
];

/** Strip the extension and normalise for matching. */
function stem(filename) {
  return filename
    .replace(/\.(md|markdown|mdx|txt|rst)$/i, "")
    .trim()
    .toLowerCase();
}

/**
 * Classify one document path.
 *
 * @param {string} relativePath  path relative to the project root
 * @param {object} [opts]
 * @param {string[]} [opts.include]  extra names or paths the author declared
 * @returns {{ include: boolean, reason: string, kind: string }}
 */
export function classifyDoc(relativePath, opts = {}) {
  const include = (opts.include ?? []).map((v) => String(v).toLowerCase());
  const lower = relativePath.toLowerCase();
  const base = relativePath.split("/").pop() ?? relativePath;
  const key = stem(base);

  // An explicit declaration by the author outranks every rule here — including
  // the skip-directory list, since they know their own layout.
  if (include.includes(lower) || include.includes(base.toLowerCase()) || include.includes(key)) {
    return { include: true, reason: "declared by the author", kind: "declared" };
  }

  for (const re of SKIP_DOC_DIRS) {
    if (re.test(relativePath)) {
      return { include: false, reason: "lives in a dependency or tooling directory", kind: "excluded" };
    }
  }

  if (CANONICAL_DOCS.has(key)) {
    return { include: true, reason: "conventional project document", kind: "canonical" };
  }

  for (const [re, label] of PROCEDURAL_PATTERNS) {
    if (re.test(key)) {
      return { include: false, reason: label, kind: "procedural" };
    }
  }

  // A conventional word carrying a project suffix — `ROADMAP_SUPAFILM_TAKES`,
  // `README-ios`, `DESIGN_v2`. Exact matching alone missed these, and on a real
  // repository the file stating the product's purpose was one of them. The
  // conventional word has to lead, so `render-plan` stays a plan document
  // rather than becoming a roadmap.
  const leadWord = key.split(/[-_. ]+/)[0];
  if (leadWord && leadWord !== key && CANONICAL_DOCS.has(leadWord)) {
    return {
      include: true,
      reason: `conventional document (${leadWord}) with a project-specific suffix`,
      kind: "canonical",
    };
  }

  // Everything else: a real document with a project-specific name. Not
  // included by default — the author can name it — but reported so the
  // omission is visible rather than silent.
  return { include: false, reason: "not a conventional name", kind: "unrecognised" };
}

/**
 * Partition a project's documents into what the brain carries and what it does
 * not, with a reason for every exclusion.
 *
 * @param {string[]} paths           doc paths relative to the project root
 * @param {object} [opts]
 * @param {string[]} [opts.include]  extra docs the author declared
 */
export function selectDocs(paths, opts = {}) {
  const carried = [];
  const skipped = [];

  for (const path of paths) {
    const verdict = classifyDoc(path, opts);
    if (verdict.include) carried.push({ path, kind: verdict.kind });
    else skipped.push({ path, reason: verdict.reason, kind: verdict.kind });
  }

  // Conventional docs first, then anything the author added, each alphabetical
  // so the order is stable between runs.
  const rank = (d) => (d.kind === "canonical" ? 0 : 1);
  carried.sort((a, b) => rank(a) - rank(b) || a.path.localeCompare(b.path));
  skipped.sort((a, b) => a.path.localeCompare(b.path));

  return { carried, skipped };
}
