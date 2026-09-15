/**
 * Scan orchestration: walk the roots, enrich with git facts, arrange as a tree.
 *
 * Detection stays pure filesystem work in `detect.js`; git — the slow,
 * process-spawning part — runs once per candidate in a bounded pool, only
 * after candidates are known.
 *
 * Nothing here ranks or filters. Every folder that looks like a project is
 * reported, annotated with what it is, and the user decides.
 */

import { scanRoot, DEFAULT_MAX_DEPTH } from "./detect.js";
import { gitFacts, lastCommitSubject } from "./git.js";
import { buildTree } from "./tree.js";

/** Run async `worker` over `items` with at most `limit` in flight. */
async function pool(items, limit, worker) {
  const results = new Array(items.length);
  let cursor = 0;

  async function runner() {
    while (cursor < items.length) {
      const index = cursor++;
      results[index] = await worker(items[index], index);
    }
  }

  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, runner));
  return results;
}

/**
 * Scan one or more root directories.
 *
 * @param {string[]} roots
 * @param {object} [opts]
 * @param {number} [opts.maxDepth=4]
 * @param {number} [opts.concurrency=8]
 * @param {boolean} [opts.tree=true]  arrange results as a display tree
 * @param {boolean} [opts.includeRoot=false]  treat each root itself as a candidate
 * @param {(stage: string, detail: string) => void} [opts.onProgress]
 * @returns {Promise<Array<object>>} project records, tree-ordered by default
 */
export async function scan(roots, opts = {}) {
  const onProgress = opts.onProgress ?? (() => {});
  const seen = new Map();

  for (const root of roots) {
    onProgress("walk", root);
    const found = await scanRoot(root, {
      maxDepth: opts.maxDepth ?? DEFAULT_MAX_DEPTH,
      includeRoot: opts.includeRoot ?? false,
      onProgress: (dir) => onProgress("walk", dir),
    });
    for (const project of found) {
      // A path can be reached from overlapping roots; the first win is enough.
      if (!seen.has(project.path)) seen.set(project.path, project);
    }
  }

  const candidates = [...seen.values()];
  onProgress("git", `${candidates.length} folders`);

  await pool(candidates, opts.concurrency ?? 8, async (project) => {
    const facts = await gitFacts(project.path);
    project.git = { ...project.git, ...facts };
    if (facts.isRepo) {
      project.git.lastCommitMessage = await lastCommitSubject(project.path);
    }
    return project;
  });

  if (opts.tree === false) return candidates;

  onProgress("arrange", `${candidates.length} folders`);
  return buildTree(candidates);
}
