/**
 * Finding the URL a project is published at.
 *
 * Nine of twenty-five entries on a real drive carry a deploy configuration and
 * no site link. The URL is usually sitting in a config file the scanner
 * already walks past — a Wrangler route, a Vercel alias, a Firebase site id, a
 * `homepage` field in package.json.
 *
 * Every result is a **candidate**, never a fact. A Wrangler route can be a
 * staging pattern; a Firebase site id implies a `.web.app` address that may
 * never have been served. So each finding says where it came from and how
 * confident that source is, and the entry is only written after the author
 * confirms — the same rule images follow, for the same reason: a wrong URL on
 * a public page is worse than a missing one.
 */

import { readFile } from "node:fs/promises";
import { join } from "node:path";

async function read(path) {
  try {
    return await readFile(path, "utf8");
  } catch {
    return null;
  }
}

function clean(url) {
  if (!url) return null;
  const trimmed = String(url).trim().replace(/\/+$/, "");
  if (!/^https?:\/\/[a-z0-9]/i.test(trimmed)) return null;
  // A localhost or example URL is noise, not a finding.
  if (/localhost|127\.0\.0\.1|example\.(com|org)|your-|YOUR_/i.test(trimmed)) return null;
  return trimmed;
}

/**
 * Look for a published URL in a project's configuration.
 *
 * @param {string} root absolute project path
 * @returns {Promise<Array<{url: string, source: string, confidence: string}>>}
 */
export async function findSites(root) {
  const found = [];
  const add = (url, source, confidence) => {
    const cleaned = clean(url);
    if (cleaned) found.push({ url: cleaned, source, confidence });
  };

  // --- package.json homepage: the author wrote it down ------------------
  const pkg = await read(join(root, "package.json"));
  if (pkg) {
    try {
      const parsed = JSON.parse(pkg);
      // A homepage pointing at the repo's own readme anchor is npm convention,
      // not a deployed site.
      if (parsed.homepage && !/github\.com.*#readme$/.test(parsed.homepage)) {
        add(parsed.homepage, "package.json homepage", "high");
      }
    } catch {
      /* malformed */
    }
  }

  // --- Wrangler: routes and custom domains -----------------------------
  for (const name of ["wrangler.toml", "wrangler.jsonc", "wrangler.json"]) {
    const text = await read(join(root, name));
    if (!text) continue;

    for (const match of text.matchAll(/pattern\s*=\s*["']([^"']+)["']/g)) {
      const host = match[1].replace(/\/\*$/, "").replace(/^\*\./, "");
      add(`https://${host}`, `${name} route`, "medium");
    }
    for (const match of text.matchAll(/"pattern"\s*:\s*"([^"]+)"/g)) {
      const host = match[1].replace(/\/\*$/, "").replace(/^\*\./, "");
      add(`https://${host}`, `${name} route`, "medium");
    }
    // A worker with no route is reachable at its workers.dev subdomain, but
    // only if that was left enabled — too weak to propose.
  }

  // --- Vercel ----------------------------------------------------------
  for (const name of ["vercel.json", "now.json"]) {
    const text = await read(join(root, name));
    if (!text) continue;
    try {
      const parsed = JSON.parse(text);
      for (const alias of [parsed.alias].flat().filter(Boolean)) {
        add(alias.startsWith("http") ? alias : `https://${alias}`, `${name} alias`, "high");
      }
      if (parsed.name) {
        add(`https://${parsed.name}.vercel.app`, `${name} project name`, "low");
      }
    } catch {
      /* malformed */
    }
  }

  // --- Firebase Hosting ------------------------------------------------
  const firebase = await read(join(root, "firebase.json"));
  if (firebase) {
    try {
      const parsed = JSON.parse(firebase);
      for (const target of [parsed.hosting].flat().filter(Boolean)) {
        if (target.site) {
          add(`https://${target.site}.web.app`, "firebase.json site", "medium");
        }
      }
    } catch {
      /* malformed */
    }
  }
  // The project id in .firebaserc implies a default hosting domain.
  const firebaserc = await read(join(root, ".firebaserc"));
  if (firebaserc) {
    try {
      const parsed = JSON.parse(firebaserc);
      const id = parsed.projects?.default;
      if (id) add(`https://${id}.web.app`, ".firebaserc default project", "low");
    } catch {
      /* malformed */
    }
  }

  // --- Netlify ---------------------------------------------------------
  const netlify = await read(join(root, "netlify.toml"));
  if (netlify) {
    const match = netlify.match(/\[\[redirects\]\][\s\S]*?to\s*=\s*["'](https?:\/\/[^"']+)["']/);
    if (match) add(match[1], "netlify.toml redirect", "low");
  }

  // --- CNAME, which GitHub Pages reads as the custom domain ------------
  for (const name of ["CNAME", "public/CNAME", "static/CNAME", "docs/CNAME"]) {
    const text = await read(join(root, name));
    if (!text) continue;
    const host = text.trim().split("\n")[0].trim();
    if (host && /^[a-z0-9.-]+\.[a-z]{2,}$/i.test(host)) {
      add(`https://${host}`, `${name}`, "high");
    }
  }

  // Deduplicate, keeping the most confident source for each URL.
  const rank = { high: 0, medium: 1, low: 2 };
  const best = new Map();
  for (const item of found) {
    const current = best.get(item.url);
    if (!current || rank[item.confidence] < rank[current.confidence]) best.set(item.url, item);
  }

  return [...best.values()].sort(
    (a, b) => rank[a.confidence] - rank[b.confidence] || a.url.localeCompare(b.url),
  );
}
