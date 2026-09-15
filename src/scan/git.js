/**
 * Git facts for a project root.
 *
 * Every call is read-only and failure-tolerant: plenty of real projects are not
 * repositories at all, and a missing repo is data, not an error.
 */

import { execFile } from "node:child_process";
import { promisify } from "node:util";

const run = promisify(execFile);

async function git(cwd, args) {
  try {
    const { stdout } = await run("git", ["-C", cwd, ...args], {
      timeout: 5_000,
      maxBuffer: 1024 * 1024,
    });
    return stdout.trim();
  } catch {
    return null;
  }
}

/**
 * Normalize a remote URL to `owner/repo` plus a browsable https URL.
 * Handles both `git@host:owner/repo.git` and `https://host/owner/repo.git`.
 */
export function parseRemote(url) {
  if (!url) return null;
  const cleaned = url.trim().replace(/\.git$/, "");

  const ssh = cleaned.match(/^[\w.-]+@([\w.-]+):(.+)$/);
  if (ssh) {
    const [, host, path] = ssh;
    return { host, slug: path, url: `https://${host}/${path}` };
  }

  try {
    const u = new URL(cleaned);
    const slug = u.pathname.replace(/^\//, "");
    return { host: u.host, slug, url: `https://${u.host}/${slug}` };
  } catch {
    return { host: null, slug: cleaned, url: null };
  }
}

/** The subject line of the most recent commit, or null. */
export async function lastCommitSubject(dir) {
  return git(dir, ["log", "-1", "--format=%s"]);
}

/**
 * Collect git evidence: remote, activity window, commit count, branch and
 * whether the tree is dirty.
 *
 * @param {string} dir absolute path to a project root
 */
export async function gitFacts(dir) {
  const facts = {
    isRepo: false,
    remote: null,
    slug: null,
    host: null,
    branch: null,
    lastCommit: null,
    firstCommit: null,
    commits: 0,
    dirty: false,
    contributors: 0,
  };

  const inside = await git(dir, ["rev-parse", "--is-inside-work-tree"]);
  if (inside !== "true") return facts;
  facts.isRepo = true;

  const remote = await git(dir, ["remote", "get-url", "origin"]);
  const parsed = parseRemote(remote);
  if (parsed) {
    facts.remote = parsed.url ?? remote;
    facts.slug = parsed.slug;
    facts.host = parsed.host;
  }

  facts.branch = await git(dir, ["rev-parse", "--abbrev-ref", "HEAD"]);
  facts.lastCommit = await git(dir, ["log", "-1", "--format=%cs"]);

  // `--max-count` is applied before `--reverse`, so pairing them returns the
  // newest commit rather than the oldest — which collapsed every project's
  // span to a single day. `--max-parents=0` names the root commit directly.
  const root = await git(dir, ["log", "--max-parents=0", "--format=%cs"]);
  facts.firstCommit = root ? root.split("\n").pop().trim() : null;

  const count = await git(dir, ["rev-list", "--count", "HEAD"]);
  facts.commits = count ? Number.parseInt(count, 10) || 0 : 0;

  const status = await git(dir, ["status", "--porcelain"]);
  facts.dirty = Boolean(status);

  const shortlog = await git(dir, ["shortlog", "-sn", "HEAD"]);
  facts.contributors = shortlog ? shortlog.split("\n").filter(Boolean).length : 0;

  // A public remote is the strongest open-source signal available offline.
  facts.likelyOpenSource = Boolean(
    facts.host && /github\.com|gitlab\.com|codeberg\.org|bitbucket\.org/.test(facts.host),
  );

  return facts;
}
