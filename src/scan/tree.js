/**
 * Arrange scanned records into a display tree.
 *
 * Replaces the old relevance scorer on purpose. Ranking projects by "evidence
 * of activity" was answering the wrong question: activity is not importance,
 * and only the person who built the thing knows which folder mattered. So this
 * module sorts and groups — it never filters and never scores.
 *
 * Parents come first, their nested parts indented beneath them, so the tree
 * shows the structure as it exists on disk and every row stays selectable.
 */

/** Sort key for top-level projects: alphabetical within each root group. */
function byName(a, b) {
  return (a.name ?? "").localeCompare(b.name ?? "", undefined, { numeric: true });
}

/**
 * Build a flat, ordered list of rows with depth annotations.
 *
 * @param {Array<object>} records scanned project records
 * @returns {Array<object>} rows: `{ ...record, depth, hasChildren, childCount }`
 */
export function buildTree(records) {
  const byPath = new Map(records.map((r) => [r.path, r]));

  // Resolve each record's nearest ancestor that is itself in the result set.
  const childrenOf = new Map();
  const roots = [];

  for (const record of records) {
    // `nestedUnder` names the enclosing project, but that folder may not itself
    // be in the result set (an `apps/` container has no marker of its own), so
    // climb the path until a detected ancestor turns up.
    let parentPath = record.nestedUnder;
    while (parentPath && !byPath.has(parentPath)) {
      const cut = parentPath.lastIndexOf("/");
      if (cut <= 0) {
        parentPath = null;
        break;
      }
      parentPath = parentPath.slice(0, cut);
    }

    if (parentPath && byPath.has(parentPath) && parentPath !== record.path) {
      if (!childrenOf.has(parentPath)) childrenOf.set(parentPath, []);
      childrenOf.get(parentPath).push(record);
    } else {
      roots.push(record);
    }
  }

  const rows = [];

  /**
   * A workspace root often declares nothing but the workspace itself — the real
   * frameworks live in `apps/*`. Describing such a folder as "Node" would hide
   * what it actually is, so it borrows the labels its own parts carry.
   */
  function inheritedFrameworks(record) {
    if (record.frameworks?.length) return record.frameworks;

    const collected = [];
    const walk = (path) => {
      for (const child of childrenOf.get(path) ?? []) {
        if (child.role === "platform") continue;
        collected.push(...(child.frameworks ?? []));
        walk(child.path);
      }
    };
    walk(record.path);

    if (collected.length === 0) return record.frameworks ?? [];
    // Keep the order stable and favour labels that several parts agree on.
    const counts = new Map();
    for (const label of collected) counts.set(label, (counts.get(label) ?? 0) + 1);
    return [...counts.entries()].sort((a, b) => b[1] - a[1]).map(([label]) => label);
  }

  function emit(record, depth) {
    const children = (childrenOf.get(record.path) ?? []).sort((a, b) => {
      // Platform scaffolding last: it is the least likely to be wanted, but it
      // is still shown, because hiding folders is not this tool's decision.
      const rank = (r) => (r.role === "platform" ? 2 : r.role === "package" ? 1 : 0);
      const d = rank(a) - rank(b);
      return d !== 0 ? d : byName(a, b);
    });

    const frameworks = inheritedFrameworks(record);
    rows.push({
      ...record,
      frameworks,
      frameworksInherited: frameworks !== record.frameworks && frameworks.length > 0,
      depth,
      hasChildren: children.length > 0,
      childCount: children.length,
    });

    for (const child of children) emit(child, depth + 1);
  }

  for (const root of roots.sort(byName)) emit(root, 0);
  return rows;
}

/**
 * Group top-level rows by their containing directory, so a scan of a big drive
 * reads as "these projects live under `clients/`, these under `games/`".
 *
 * @param {Array<object>} rows   output of `buildTree`
 * @param {string} scanRoot      the directory the scan started from
 */
export function groupLabel(row, scanRoot) {
  if (row.depth > 0) return null;

  const relative = row.path.startsWith(`${scanRoot}/`)
    ? row.path.slice(scanRoot.length + 1)
    : row.path;

  const segments = relative.split("/");
  if (segments.length <= 1) return null; // directly under the scan root
  return segments.slice(0, -1).join("/");
}

/**
 * Default selection: top-level projects are checked, their internal parts are
 * not. This is a structural default, not a quality judgement — a workspace
 * package or an `android/` folder is part of something already selected, so
 * checking it too would duplicate the same work in the manifest. Every row
 * stays togglable.
 */
export function defaultChecked(row) {
  return row.depth === 0;
}
