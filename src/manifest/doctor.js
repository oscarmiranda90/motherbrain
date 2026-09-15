/**
 * Health checks.
 *
 * A catalogue decays quietly. An entry written in March still says March while
 * the repository moved on in September; a project gets moved to another disk
 * and its path stops resolving; a document is renamed and the entry keeps
 * pointing at the old name. None of that announces itself, and a manifest
 * nobody trusts is worse than no manifest.
 *
 * So the drift is made visible, with a specific fix named for each finding.
 * Every check reports rather than repairs: the tool describes, the user
 * decides, and `--fix` only applies the repairs that are purely mechanical.
 */

import { stat } from "node:fs/promises";
import { join } from "node:path";
import { execFile } from "node:child_process";
import { promisify } from "node:util";

const run = promisify(execFile);

/** Severity ranking, so output leads with what actually matters. */
const ORDER = { error: 0, warning: 1, note: 2 };

async function exists(path) {
  try {
    await stat(path);
    return true;
  } catch {
    return false;
  }
}

/**
 * The example entry this repository ships, which is documentation rather than
 * a catalogued project. Recognised by its placeholder path rather than by id,
 * so a developer who renames it is still spared the false error.
 */
function isTemplate(entry) {
  const path = entry.source?.path ?? "";
  return /^\/path\/to\/your\//.test(path) || entry.id === "example-project";
}

async function headDate(repoPath) {
  try {
    const { stdout } = await run("git", ["-C", repoPath, "log", "-1", "--format=%cs"], {
      timeout: 5_000,
    });
    return stdout.trim() || null;
  } catch {
    return null;
  }
}

/**
 * Inspect every entry and return findings.
 *
 * @param {object[]} entries  from `readEntries`
 * @returns {Promise<Array<{severity: string, id: string, problem: string, fix: string, fixable?: string}>>}
 */
export async function diagnose(entries) {
  const findings = [];

  for (const entry of entries) {
    // The shipped example entry documents the schema and points at a
    // placeholder path on purpose. Reporting it as a broken entry would mean
    // every developer's first `brain doctor` opens with an error of ours.
    if (isTemplate(entry)) continue;

    const root = entry.source?.path;

    // --- the project is gone -------------------------------------------
    if (!root) {
      findings.push({
        severity: "error",
        id: entry.id,
        problem: "no source path recorded",
        fix: "delete the entry, or add `source.path` by hand",
      });
      continue;
    }

    if (!(await exists(root))) {
      findings.push({
        severity: "error",
        id: entry.id,
        problem: `path does not resolve: ${root}`,
        fix: "the project moved or its disk is unmounted — update source.path, or archive the entry",
      });
      continue;
    }

    // --- the entry has fallen behind the repository ---------------------
    if (entry.source?.git) {
      const head = await headDate(root);
      if (head && entry.last_active && head > entry.last_active) {
        findings.push({
          severity: "warning",
          id: entry.id,
          problem: `entry says ${entry.last_active}, repository is at ${head}`,
          fix: "run `brain refresh`",
          fixable: "refresh",
        });
      }
    }

    // --- documents that moved or were renamed ---------------------------
    for (const doc of entry.documents ?? []) {
      if (!doc?.path) continue;
      if (!(await exists(join(root, doc.path)))) {
        findings.push({
          severity: "warning",
          id: entry.id,
          problem: `document is missing: ${doc.path}`,
          fix: "run `brain refresh` to re-read the project's documents",
          fixable: "refresh",
        });
      }
    }

    // --- images confirmed but no longer on disk -------------------------
    for (const image of entry.images ?? []) {
      if (image?.confirmed !== true || !image.path) continue;
      if (!(await exists(join(root, image.path)))) {
        findings.push({
          severity: "warning",
          id: entry.id,
          problem: `confirmed image is missing: ${image.path}`,
          fix: "remove it from the entry, or restore the file — publishing will skip it",
        });
      }
    }

    // --- nothing written yet -------------------------------------------
    const body = entry._body ?? "";
    const cardSegment = body.split(/^##\s+Card\s*$/m)[1] ?? "";
    const cardText = (cardSegment.split(/^##\s+/m)[0] ?? "")
      .replace(/<!--[\s\S]*?-->/g, "")
      .trim();

    if (!cardText) {
      findings.push({
        severity: "warning",
        id: entry.id,
        problem: "no card — invisible to anything reading the catalogue",
        fix: "run `brain ingest --cards`",
      });
    }

    // --- proposals waiting on a human ----------------------------------
    const unconfirmed = (entry.images ?? []).filter((i) => i?.confirmed !== true).length;
    if (unconfirmed > 0) {
      findings.push({
        severity: "note",
        id: entry.id,
        problem: `${unconfirmed} ${unconfirmed === 1 ? "image is" : "images are"} proposed but unreviewed`,
        fix: "look at them, then set `confirmed: true` on the ones to publish",
      });
    }

    // --- documents carried without a summary ---------------------------
    const unsummarised = (entry.documents ?? []).filter((d) => d?.path && !d.summary).length;
    if (unsummarised > 0 && cardText) {
      findings.push({
        severity: "note",
        id: entry.id,
        problem: `${unsummarised} ${unsummarised === 1 ? "document has" : "documents have"} no summary`,
        fix: "a one-line inventory each, so a reader knows whether to open them",
      });
    }

    // --- shipped with nowhere to point ---------------------------------
    const deployed = (entry.source?.deploy ?? []).length > 0;
    if (deployed && !entry.links?.site) {
      findings.push({
        severity: "note",
        id: entry.id,
        problem: `deploys to ${entry.source.deploy.join(", ")} but has no site link`,
        fix: "run `brain sites` to look for the URL, or add `links.site` by hand",
      });
    }
  }

  findings.sort(
    (a, b) => ORDER[a.severity] - ORDER[b.severity] || a.id.localeCompare(b.id),
  );
  return findings;
}

/** Group findings by severity, for reporting. */
export function summarise(findings) {
  const counts = { error: 0, warning: 0, note: 0 };
  for (const f of findings) counts[f.severity] = (counts[f.severity] ?? 0) + 1;
  return counts;
}

/** Ids whose findings can be repaired by a refresh. */
export function refreshable(findings) {
  return [...new Set(findings.filter((f) => f.fixable === "refresh").map((f) => f.id))];
}
