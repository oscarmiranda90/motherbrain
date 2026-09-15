/**
 * The publish boundary.
 *
 * A published brain is a *public wikipedia of someone's work*: ideas, problems
 * solved, architecture, links to what is downloadable or open. It is a
 * different artifact from the local brain, and the difference is subtractive —
 * what leaves the machine is strictly less than what lives on it.
 *
 * Two things must never cross this line:
 *
 *   1. **Filesystem paths.** `/Volumes/CORSAIR/clients/acme/...` tells a reader
 *      nothing and tells an attacker where things live. The local brain needs
 *      `source.path` to re-scan; a reader never does.
 *   2. **Projects the author did not mark public.** Client work and private
 *      experiments are catalogued locally on purpose. Publishing is opt-in per
 *      project, never a side effect of running a command.
 *
 * This runs at publish time rather than at build time, so the local brain keeps
 * everything it needs and only the exported copy is redacted. A single function
 * owns the rule, so there is one place to audit.
 */

/** Visibilities that may appear in a published brain. */
const PUBLISHABLE = new Set(["public"]);

/**
 * Fields of `source` a reader can actually use. Everything else — above all
 * `path` — is machine bookkeeping and stays home.
 */
function publicSource(source = {}) {
  const out = {};
  if (source.remote) out.repo = source.remote;
  if (source.branch) out.branch = source.branch;
  if (typeof source.commits === "number" && source.commits > 0) {
    out.commits = source.commits;
  }
  if (Array.isArray(source.deploy) && source.deploy.length) out.deploy = source.deploy;
  if (Array.isArray(source.docs) && source.docs.length) out.docs = source.docs;
  if (source.structure && source.structure !== "project") out.structure = source.structure;
  return out;
}

/**
 * Where a confirmed image lives on the published site.
 *
 * Flattened under the project id, so the original directory structure — which
 * can carry a client name or an internal codename — never reaches the markup.
 *
 * `extension` overrides the source's own, because a heavy PNG is re-encoded to
 * webp on the way out: without this the markup would point at a file that was
 * never written.
 */
export function publishedImagePath(projectId, repoPath, extension = null) {
  const base = String(repoPath).split("/").pop() ?? "image";
  const safe = base.replace(/[^A-Za-z0-9._-]/g, "-");
  const named = extension ? safe.replace(/\.[^.]+$/, extension) : safe;
  return `media/${projectId}/${named}`;
}

/** Strip anything path-shaped from a free-text value. */
function scrubText(value) {
  if (typeof value !== "string") return value;
  return value
    // Absolute POSIX paths under common roots, and Windows drive paths.
    .replace(/(?:\/(?:Users|home|Volumes|mnt|media|opt|srv|var|tmp|private)\/[^\s"'`)\]]+)/g, "[path]")
    .replace(/[A-Za-z]:\\[^\s"'`)\]]+/g, "[path]");
}

/** Recursively scrub path-shaped strings out of a value. */
function scrubDeep(value) {
  if (typeof value === "string") return scrubText(value);
  if (Array.isArray(value)) return value.map(scrubDeep);
  if (value && typeof value === "object") {
    return Object.fromEntries(Object.entries(value).map(([k, v]) => [k, scrubDeep(v)]));
  }
  return value;
}

/**
 * Decide whether one project may be published.
 *
 * @param {object} project      a bundle project (index or full)
 * @param {object} [opts]
 * @param {boolean} [opts.includePrivate=false]  publish non-public entries too
 */
export function isPublishable(project, opts = {}) {
  if (opts.includePrivate) return true;
  return PUBLISHABLE.has(project.visibility);
}

/**
 * Redact one project for publication.
 *
 * Prose is scrubbed as well as metadata: an agent writing a dossier may quote a
 * path from the briefing, and that must not reach a public page either.
 */
export function redactProject(project) {
  const redacted = {
    ...project,
    source: publicSource(project.source),
  };

  // Documents travel with paths scrubbed, since a doc can quote a build path.
  if (Array.isArray(redacted.documents)) {
    redacted.documents = redacted.documents.map((doc) => ({
      ...doc,
      summary: doc.summary ? scrubText(doc.summary) : doc.summary,
      ...(typeof doc.text === "string" ? { text: scrubText(doc.text) } : {}),
    }));
  }

  // Images are rewritten to where they will actually live on the published
  // site, and flattened so a repository path never appears in the markup. The
  // caller supplies the final extension for anything it re-encodes.
  if (Array.isArray(redacted.images)) {
    redacted.images = redacted.images.map((image) => ({
      src: publishedImagePath(project.id, image.path, image.published_extension ?? null),
      alt: image.alt ? scrubText(image.alt) : null,
      ...(image.section ? { section: image.section } : {}),
    }));
  }

  if (redacted.card) redacted.card = scrubText(redacted.card);
  if (redacted.dossier?.sections) {
    redacted.dossier = {
      ...redacted.dossier,
      sections: scrubDeep(redacted.dossier.sections),
    };
  }
  if (redacted.tagline) redacted.tagline = scrubText(redacted.tagline);
  if (Array.isArray(redacted.highlights)) {
    redacted.highlights = redacted.highlights.map(scrubText);
  }

  return redacted;
}

/**
 * Build the public catalogue from a local bundle.
 *
 * Returns the redacted bundle plus a report of what was withheld, because a
 * command that silently drops projects is worse than one that explains itself.
 *
 * @param {object} bundle  output of `buildBundle`
 * @param {object} [opts]
 * @param {boolean} [opts.includePrivate=false]
 * @param {string} [opts.title]
 * @param {string} [opts.author]
 */
export function redactBundle(bundle, opts = {}) {
  const kept = [];
  const withheld = [];

  for (const project of bundle.projects) {
    if (isPublishable(project, opts)) kept.push(redactProject(project));
    else withheld.push({ id: project.id, name: project.name, visibility: project.visibility });
  }

  const keptIds = new Set(kept.map((p) => p.id));

  // Rebuild the indexes over what survived: an index that names a withheld
  // project would leak its existence, and `relates_to` could point nowhere.
  const filterGroups = (groups = {}) =>
    Object.fromEntries(
      Object.entries(groups)
        .map(([key, ids]) => [key, ids.filter((id) => keptIds.has(id))])
        .filter(([, ids]) => ids.length > 0),
    );

  for (const project of kept) {
    if (Array.isArray(project.relates_to)) {
      project.relates_to = project.relates_to.filter((id) => keptIds.has(id));
    }
  }

  const index = {
    capabilities: filterGroups(bundle.index?.capabilities),
    patterns: filterGroups(bundle.index?.patterns),
    frameworks: filterGroups(bundle.index?.frameworks),
    ecosystem: filterGroups(bundle.index?.ecosystem),
    kind: filterGroups(bundle.index?.kind),
    domain: filterGroups(bundle.index?.domain),
    tags: filterGroups(bundle.index?.tags),
    related: (bundle.index?.related ?? []).filter(
      (entry) => entry.pair.every((id) => keptIds.has(id)),
    ),
  };

  const status = {};
  for (const project of kept) {
    if (!project.status) continue;
    status[project.status] = (status[project.status] ?? 0) + 1;
  }
  index.status = status;

  const publicBundle = {
    $schema: bundle.$schema,
    version: bundle.version,
    generated: bundle.generated,
    title: opts.title ?? "Project brain",
    author: opts.author ?? null,
    usage:
      "A public catalogue of one person's projects: what each one is, the " +
      "problem it solves, how it is built, and where to find it. Read every " +
      "card, then fetch `dossier.href` for the few that matter. " +
      "`index.capabilities` and `index.patterns` map a facet to project ids; " +
      "`index.related` lists project pairs that share facets. " +
      "No source code, credentials, or filesystem paths are included.",
    counts: {
      projects: kept.length,
      carded: kept.filter((p) => Boolean(p.card)).length,
      documented: kept.filter((p) => p.dossier?.complete).length,
      shipped: kept.filter((p) => p.status === "live" || p.status === "shipped").length,
    },
    index,
    projects: kept,
  };

  return { bundle: publicBundle, withheld };
}
