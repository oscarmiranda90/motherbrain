/**
 * Querying the catalogue.
 *
 * The bundle already carries every index a question needs —
 * `index.capabilities`, `index.patterns`, `index.frameworks` and the rest — but
 * until now the only way to reach them from a terminal was to pipe
 * `brain list --json` into `jq` and know the schema. A developer with sixty
 * projects asking "which Next.js ones shipped" should not have to learn the
 * shape of the file to find out.
 *
 * Filters are AND-ed, because that is what people mean when they name two
 * things. Values match case-insensitively so `nextjs`, `Next.js` and `next.js`
 * all find the same projects — a catalogue that only answers to its own exact
 * spelling is a catalogue you have to read first.
 */

/** Normalise for comparison: case, dots and dashes all collapse. */
function key(value) {
  return String(value ?? "")
    .toLowerCase()
    .replace(/[.\-_\s]/g, "");
}

function listHas(list, wanted) {
  const target = key(wanted);
  return (list ?? []).some((item) => key(item) === target);
}

/**
 * Free-text search across everything a project says about itself.
 *
 * Deliberately includes the card and the dossier text: a developer looking for
 * "the thing that did local video" remembers the description, not the tag.
 */
function matchesText(project, term) {
  const needle = term.toLowerCase();
  const haystack = [
    project.id,
    project.name,
    project.tagline,
    project.kind,
    project.status,
    project.architecture,
    project.domain,
    project.card,
    (project.frameworks ?? []).join(" "),
    (project.ecosystem ?? []).join(" "),
    (project.capabilities ?? []).join(" "),
    (project.patterns ?? []).join(" "),
    (project.tags ?? []).join(" "),
    (project.highlights ?? []).join(" "),
    Object.values(project.dossier?.sections ?? {}).join(" "),
    (project.documents ?? []).map((d) => `${d.path} ${d.summary ?? ""}`).join(" "),
  ]
    .join(" ")
    .toLowerCase();

  return haystack.includes(needle);
}

/**
 * Every supported filter, as a predicate factory.
 *
 * Kept as a table so `brain query --help` and the tests can enumerate what
 * exists rather than restating it.
 */
export const FILTERS = {
  framework: (v) => (p) => listHas(p.frameworks, v),
  ecosystem: (v) => (p) => listHas(p.ecosystem, v),
  capability: (v) => (p) => listHas(p.capabilities, v),
  pattern: (v) => (p) => listHas(p.patterns, v),
  tag: (v) => (p) => listHas(p.tags, v),
  kind: (v) => (p) => key(p.kind) === key(v),
  status: (v) => (p) => key(p.status) === key(v),
  visibility: (v) => (p) => key(p.visibility) === key(v),
  domain: (v) => (p) => key(p.domain) === key(v),
  architecture: (v) => (p) => key(p.architecture ?? "").includes(key(v)),
  relates: (v) => (p) => listHas(p.relates_to, v),
};

/** Flags that take no value. */
export const TOGGLES = {
  "has-dossier": (p) => p.dossier?.complete === true,
  "no-dossier": (p) => p.dossier?.complete !== true,
  "has-card": (p) => Boolean(p.card),
  "no-card": (p) => !p.card,
  "has-repo": (p) => Boolean(p.links?.repo),
  "no-repo": (p) => !p.links?.repo,
  "has-site": (p) => Boolean(p.links?.site),
  "has-images": (p) => (p.images ?? []).length > 0,
  "has-metrics": (p) => Object.keys(p.metrics ?? {}).length > 0,
  public: (p) => p.visibility === "public",
  private: (p) => p.visibility !== "public",
};

/**
 * Run a query against a bundle's projects.
 *
 * @param {object[]} projects
 * @param {object} spec
 * @param {string} [spec.text]                 free-text term
 * @param {Record<string,string>} [spec.filters]
 * @param {string[]} [spec.toggles]
 * @param {string} [spec.sort]                 name | recent | started | kind
 * @param {number} [spec.limit]
 * @returns {{ results: object[], applied: string[], unknown: string[] }}
 */
export function query(projects, spec = {}) {
  const applied = [];
  const unknown = [];
  let results = [...(projects ?? [])];

  for (const [name, value] of Object.entries(spec.filters ?? {})) {
    const factory = FILTERS[name];
    if (!factory) {
      unknown.push(`--${name}`);
      continue;
    }
    results = results.filter(factory(value));
    applied.push(`${name}=${value}`);
  }

  for (const name of spec.toggles ?? []) {
    const predicate = TOGGLES[name];
    if (!predicate) {
      unknown.push(`--${name}`);
      continue;
    }
    results = results.filter(predicate);
    applied.push(`--${name}`);
  }

  if (spec.text) {
    results = results.filter((p) => matchesText(p, spec.text));
    applied.push(`"${spec.text}"`);
  }

  const sorters = {
    name: (a, b) => (a.name ?? "").localeCompare(b.name ?? ""),
    // Most recently worked on first: the usual thing to want.
    recent: (a, b) => String(b.last_active ?? "").localeCompare(String(a.last_active ?? "")),
    started: (a, b) => String(a.started ?? "").localeCompare(String(b.started ?? "")),
    kind: (a, b) => (a.kind ?? "").localeCompare(b.kind ?? "") || (a.name ?? "").localeCompare(b.name ?? ""),
  };
  results.sort(sorters[spec.sort ?? "recent"] ?? sorters.recent);

  if (spec.limit && spec.limit > 0) results = results.slice(0, spec.limit);

  return { results, applied, unknown };
}

/**
 * Values actually present in a catalogue, for a given facet.
 *
 * What a developer needs when a query returns nothing: not "no results" but
 * "here is what does exist".
 */
export function facetValues(projects, facet) {
  const counts = new Map();
  const pick = {
    framework: (p) => p.frameworks,
    ecosystem: (p) => p.ecosystem,
    capability: (p) => p.capabilities,
    pattern: (p) => p.patterns,
    tag: (p) => p.tags,
    kind: (p) => [p.kind],
    status: (p) => [p.status],
    domain: (p) => [p.domain],
    visibility: (p) => [p.visibility],
  }[facet];

  if (!pick) return [];

  for (const project of projects ?? []) {
    for (const value of pick(project) ?? []) {
      if (!value) continue;
      counts.set(value, (counts.get(value) ?? 0) + 1);
    }
  }

  return [...counts.entries()]
    .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
    .map(([value, count]) => ({ value, count }));
}
