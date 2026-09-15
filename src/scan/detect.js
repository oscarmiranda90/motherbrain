/**
 * Project detection.
 *
 * A "project" is not a top-level folder. On a real disk, projects live nested
 * inside grouping folders (`clients/acme-web/`, `games/roguelike/app/`), so the
 * scanner looks for ecosystem *markers* — the files that only exist at the root
 * of an actual project — rather than assuming any particular directory depth.
 *
 * This module reports what it finds. It never decides what is worth keeping:
 * that is the user's call, made on the selection screen.
 */

import { readdir, readFile, stat } from "node:fs/promises";
import { join, basename } from "node:path";

import { detectFrameworks, structuralRole, inferKind } from "./classify.js";
import { selectDocs } from "./docs.js";
import { discoverImages, proposeImages } from "./images.js";

/**
 * Marker file -> ecosystem. Presence of one of these files means "a project
 * root lives here". A directory may match several.
 */
export const MARKERS = {
  "package.json": "node",
  "deno.json": "deno",
  "deno.jsonc": "deno",
  "bun.lockb": "bun",
  "pubspec.yaml": "flutter",
  "go.mod": "go",
  "Cargo.toml": "rust",
  "pyproject.toml": "python",
  "requirements.txt": "python",
  "Pipfile": "python",
  "setup.py": "python",
  "environment.yml": "python",
  "composer.json": "php",
  "wp-config.php": "wordpress",
  "wp-settings.php": "wordpress",
  // A theme announces itself in style.css and a plugin in a PHP header. Both
  // are confirmed (or rejected) by reading the header in `describeProject`.
  "style.css": "wordpress-candidate",
  Gemfile: "ruby",
  "pom.xml": "java",
  "build.gradle": "java",
  "build.gradle.kts": "kotlin",
  "Package.swift": "swift",
  "mix.exs": "elixir",
  "project.godot": "godot",
  "CMakeLists.txt": "cpp",
  Makefile: "cpp",
  Dockerfile: "docker",
};

/**
 * How deep to look, by default.
 *
 * Measured on a real 56-project drive: depth 2 found 40 projects, depth 3 found
 * all 56, depth 6 added two more, and the whole difference between shallow and
 * deep was about three seconds. Stopping early hides real work and says
 * nothing about it, so the default goes deep enough to be trustworthy —
 * `SKIP_DIRS` is what keeps that cheap, by refusing to enter dependency trees.
 */
export const DEFAULT_MAX_DEPTH = 6;

/**
 * Documents are discovered, not enumerated.
 *
 * An earlier version listed nine filenames. On a real project that found two
 * documents out of forty-six — and the two most useful ones, a roadmap stating
 * the product's purpose and a handoff carrying verified deployment numbers,
 * were both missed. Every `.md` the author wrote is a statement of theirs, so
 * the scanner collects them all and `docs.js` decides which the brain carries.
 */
const DOC_EXTENSIONS = /\.(md|markdown|mdx)$/i;

/** Deploy descriptors: where a project ships. */
export const DEPLOY_FILES = {
  "vercel.json": "vercel",
  "netlify.toml": "netlify",
  "wrangler.toml": "cloudflare",
  "wrangler.jsonc": "cloudflare",
  "fly.toml": "fly.io",
  Dockerfile: "docker",
  "docker-compose.yml": "docker",
  "app.yaml": "gcp",
  Procfile: "heroku",
  "render.yaml": "render",
  "firebase.json": "firebase",
  "amplify.yml": "aws-amplify",
  "vercel.jsonc": "vercel",
};

/**
 * Directories never worth descending into: dependency trees, OS metadata, SDK
 * installs, build output. Skipping these is not a judgement about projects —
 * they contain no projects of the user's.
 */
export const SKIP_DIRS = new Set([
  "node_modules",
  // Vendored dependency trees. Foundry drops real projects (with their own
  // manifests) into `lib/`, so without this a Solidity repo reports
  // openzeppelin-contracts and forge-std as if they were the user's work.
  "lib",
  "libs",
  "third_party",
  "thirdparty",
  "external",
  "deps",
  "bower_components",
  "jspm_packages",
  "packages_cache",
  ".pub-cache",
  "Carthage",
  ".bundle",
  ".git",
  ".svn",
  ".hg",
  "vendor",
  "Pods",
  ".dart_tool",
  ".gradle",
  ".idea",
  ".vscode",
  "build",
  "dist",
  "out",
  "target",
  ".next",
  ".nuxt",
  ".svelte-kit",
  ".astro",
  ".venv",
  "venv",
  "env",
  "__pycache__",
  ".pytest_cache",
  ".terraform",
  "Library",
  "Applications",
  "System",
  ".Trash",
  ".Trashes",
  ".Spotlight-V100",
  ".fseventsd",
  ".DocumentRevisions-V100",
  ".DocumentRevisions-V100-bad-1",
  ".TemporaryItems",
  ".PKInstallSandboxManager",
  ".pnpm-store",
  ".colima-oscarcrescente",
  "SteamLibrary",
  "fluttersdk",
  "Androidstudio",
  "coverage",
  ".turbo",
  ".cache",
  "Pods",
  "DerivedData",
  ".expo",
  "wp-admin",
  "wp-includes",
]);

/**
 * Folders that are dependency or system trees rather than user projects.
 * Matched case-insensitively against the whole directory name.
 */
const SYSTEM_NAMES = [/^\.DocumentRevisions/i, /^\.Spotlight/i, /^\.PKInstall/i];

export function isSystemName(name) {
  return SYSTEM_NAMES.some((re) => re.test(name));
}

/**
 * Descriptions that came from a template, not from the person who built the
 * project. Carrying one into the manifest is worse than carrying nothing: it
 * reads as a real summary, so it ends up quoted verbatim in a CV or a post.
 */
const SCAFFOLD_DESCRIPTIONS = [
  /^a blank template to get started/i,
  /^a new flutter project/i,
  /^a new .* project\.?$/i,
  /get started with (payload|next|nuxt|astro|vite)/i,
  /^(my|the) (new )?(app|project|website)\.?$/i,
  /^generated (by|with)/i,
  /^bootstrapped with/i,
  /^starter (template|kit|project)/i,
  /^(example|demo|sample|test|todo|description)\.?$/i,
  /^react \+ (typescript \+ )?vite/i,
  /^create-next-app/i,
];

export function isScaffoldDescription(text) {
  const t = String(text ?? "").trim();
  if (t.length < 3) return true;
  return SCAFFOLD_DESCRIPTIONS.some((re) => re.test(t));
}

async function exists(p) {
  try {
    await stat(p);
    return true;
  } catch {
    return false;
  }
}

async function readIfPresent(p, limit = 24_000) {
  try {
    const text = await readFile(p, "utf8");
    return text.slice(0, limit);
  } catch {
    return null;
  }
}

/** Match a marker filename, supporting the `*.csproj` / `*.xcodeproj` globs. */
function markerFor(entryName) {
  if (MARKERS[entryName]) return MARKERS[entryName];
  if (entryName.endsWith(".csproj") || entryName.endsWith(".sln")) return "dotnet";
  if (entryName.endsWith(".uproject")) return "unreal";
  return null;
}

/**
 * Walk a root directory and yield every detected project root, each annotated
 * with its structural role and its parent project (when it has one).
 *
 * @param {string} root         absolute path to scan
 * @param {object} [opts]
 * @param {number} [opts.maxDepth=4]
 * @param {boolean} [opts.includeRoot=false]  treat `root` itself as a candidate
 * @param {(msg: string) => void} [opts.onProgress]
 */
export async function scanRoot(root, opts = {}) {
  const maxDepth = opts.maxDepth ?? DEFAULT_MAX_DEPTH;
  const includeRoot = opts.includeRoot ?? false;
  const onProgress = opts.onProgress ?? (() => {});
  const found = [];
  let visited = 0;

  async function walk(dir, depth, insideProject) {
    if (depth > maxDepth) return;

    let entries;
    try {
      entries = await readdir(dir, { withFileTypes: true });
    } catch {
      return; // unreadable directory — skip silently
    }

    visited += 1;
    if (visited % 25 === 0) onProgress(dir);

    const fileNames = [];
    const dirNames = [];
    for (const e of entries) {
      if (e.isDirectory()) dirNames.push(e.name);
      else if (e.isFile() || e.isSymbolicLink()) fileNames.push(e.name);
    }

    const ecosystems = new Set();
    for (const f of fileNames) {
      const eco = markerFor(f);
      if (eco) ecosystems.add(eco);
    }

    // A lone Dockerfile or Makefile is build tooling, not a project on its own.
    // A bare style.css is only a project if its header says it is a theme.
    const onlyIncidental =
      ecosystems.size > 0 &&
      [...ecosystems].every(
        (e) => e === "docker" || e === "cpp" || e === "wordpress-candidate",
      );

    // The scanned directory itself is normally not a candidate: pointing at a
    // whole drive should not catalog the drive. But `brain add <project>` scans
    // the project itself, where the root *is* the answer.
    const rootIsCandidate = dir !== root || includeRoot;

    let record = null;
    if (ecosystems.size > 0 && rootIsCandidate) {
      record = await describeProject(dir, [...ecosystems], fileNames);
    }

    // `describeProject` resolves the wordpress-candidate marker by reading the
    // header; if it found nothing, the folder was never a project.
    const confirmed =
      record &&
      !record.ecosystems.includes("wordpress-candidate") &&
      (!onlyIncidental || record.ecosystems.includes("wordpress"));

    if (confirmed) {
      record.nestedUnder = insideProject;
      record.role = structuralRole(record);
      record.kind = inferKind(record);
      found.push(record);
    }

    const isProjectRoot = Boolean(confirmed);
    const parentProject = insideProject ?? (isProjectRoot ? dir : null);

    // Always descend: monorepos hold projects inside projects, and the user
    // decides which level matters to them.
    for (const name of dirNames) {
      if (SKIP_DIRS.has(name)) continue;
      if (isSystemName(name)) continue;
      if (name.startsWith(".") && name !== ".github") continue;
      await walk(join(dir, name), depth + 1, parentProject);
    }
  }

  await walk(root, 0, null);
  return found;
}

/**
 * Collect the raw evidence for one project root: names, ecosystem, frameworks,
 * docs, deploy targets. Structure only — no relevance judgement.
 */
export async function describeProject(dir, ecosystems, fileNames) {
  const record = {
    path: dir,
    dirName: basename(dir),
    name: basename(dir),
    ecosystems,
    frameworks: [],
    docs: [],
    deploy: [],
    git: { isRepo: false, remote: null, lastCommit: null, commits: 0 },
    description: null,
    nestedUnder: null,
    role: "project",
  };

  for (const f of fileNames) {
    if (DEPLOY_FILES[f]) record.deploy.push(DEPLOY_FILES[f]);
  }
  record.deploy = [...new Set(record.deploy)];

  const evidence = { files: fileNames, deps: [], pyDeps: [], phpDeps: [], rubyDeps: [] };

  if (ecosystems.includes("node") || ecosystems.includes("bun") || ecosystems.includes("deno")) {
    const raw = await readIfPresent(join(dir, "package.json"));
    if (raw) {
      try {
        const pkg = JSON.parse(raw);
        if (pkg.name) record.name = pkg.name;
        if (pkg.description && !isScaffoldDescription(pkg.description)) {
          record.description = pkg.description;
        }
        if (pkg.homepage) record.homepage = pkg.homepage;
        if (pkg.private === true) record.private = true;
        if (Array.isArray(pkg.workspaces) || pkg.workspaces?.packages) {
          record.isWorkspaceRoot = true;
        }
        evidence.deps = Object.keys({
          ...(pkg.dependencies ?? {}),
          ...(pkg.devDependencies ?? {}),
        });
      } catch {
        /* malformed package.json — keep the directory name */
      }
    }
  }

  if (ecosystems.includes("flutter")) {
    const raw = await readIfPresent(join(dir, "pubspec.yaml"), 8_000);
    if (raw) {
      evidence.pubspecText = raw;
      const nameMatch = raw.match(/^name:\s*(.+)$/m);
      if (nameMatch) record.name = nameMatch[1].trim();
      const descMatch = raw.match(/^description:\s*(.+)$/m);
      if (descMatch) {
        const d = descMatch[1].trim().replace(/^["']|["']$/g, "");
        if (!/^A new Flutter project/i.test(d)) record.description = d;
      }
      // A pubspec without a flutter SDK dependency is a plain Dart package.
      if (!/^\s*sdk:\s*flutter/m.test(raw) && !/^\s*flutter:/m.test(raw)) {
        record.ecosystems = ecosystems.map((e) => (e === "flutter" ? "dart" : e));
      }
    }
  }

  if (ecosystems.includes("go")) {
    const raw = await readIfPresent(join(dir, "go.mod"), 4_000);
    const m = raw?.match(/^module\s+(\S+)/m);
    if (m) record.name = m[1].split("/").pop();
  }

  if (ecosystems.includes("rust")) {
    const raw = await readIfPresent(join(dir, "Cargo.toml"), 6_000);
    const m = raw?.match(/^\s*name\s*=\s*"([^"]+)"/m);
    if (m) record.name = m[1];
    if (raw && /\[workspace\]/.test(raw)) record.isWorkspaceRoot = true;
  }

  if (ecosystems.includes("python")) {
    const pyproject = await readIfPresent(join(dir, "pyproject.toml"), 8_000);
    if (pyproject) {
      const m = pyproject.match(/^\s*name\s*=\s*"([^"]+)"/m);
      if (m) record.name = m[1];
      const d = pyproject.match(/^\s*description\s*=\s*"([^"]+)"/m);
      if (d) record.description = d[1];
      evidence.pyDeps = [...pyproject.matchAll(/"([A-Za-z0-9_.-]+)(?:[<>=~!\[]|")/g)].map(
        (x) => x[1],
      );
    }
    const reqs = await readIfPresent(join(dir, "requirements.txt"), 8_000);
    if (reqs) {
      evidence.pyDeps.push(
        ...reqs
          .split("\n")
          .map((l) => l.trim())
          .filter((l) => l && !l.startsWith("#"))
          .map((l) => l.split(/[<>=~!\[; ]/)[0]),
      );
    }
  }

  if (
    ecosystems.includes("php") ||
    ecosystems.includes("wordpress") ||
    ecosystems.includes("wordpress-candidate")
  ) {
    const raw = await readIfPresent(join(dir, "composer.json"));
    if (raw) {
      try {
        const composer = JSON.parse(raw);
        if (composer.name) record.name = composer.name;
        if (composer.description) record.description = composer.description;
        evidence.phpDeps = Object.keys({
          ...(composer.require ?? {}),
          ...(composer["require-dev"] ?? {}),
        });
      } catch {
        /* malformed composer.json */
      }
    }

    // A theme or plugin announces itself in a header comment. This is what
    // turns the provisional `wordpress-candidate` marker into a real finding.
    if (fileNames.includes("style.css")) {
      const css = await readIfPresent(join(dir, "style.css"), 4_000);
      const themeName = css?.match(/^[\s*#/]*Theme Name:\s*(.+)$/m);
      if (themeName) {
        record.name = themeName[1].trim();
        record.wordpressPart = "theme";
        const themeUri = css?.match(/^[\s*#/]*Theme URI:\s*(\S+)/m);
        if (themeUri) record.homepage = themeUri[1];
        const desc = css?.match(/^[\s*#/]*Description:\s*(.+)$/m);
        if (desc) record.description = desc[1].trim();
      }
    }

    if (!record.wordpressPart) {
      for (const phpFile of fileNames.filter((f) => f.endsWith(".php")).slice(0, 5)) {
        const php = await readIfPresent(join(dir, phpFile), 4_000);
        const pluginName = php?.match(/^[\s*#/]*Plugin Name:\s*(.+)$/m);
        if (pluginName) {
          record.name = pluginName[1].trim();
          record.wordpressPart = "plugin";
          const desc = php?.match(/^[\s*#/]*Description:\s*(.+)$/m);
          if (desc) record.description = desc[1].trim();
          break;
        }
      }
    }

    // A full install (wp-config.php + wp-content) is a site, not a theme.
    if (fileNames.includes("wp-config.php") || fileNames.includes("wp-settings.php")) {
      record.wordpressPart = "site";
      // `web/`, `public/` and `htdocs/` say nothing about which site this is,
      // so name it after the folder that actually identifies the project.
      if (/^(web|public|htdocs|www|public_html)$/i.test(record.dirName)) {
        const parent = dir.split("/").slice(-2, -1)[0];
        if (parent) record.name = parent;
      }
    }

    // Resolve the provisional marker either way.
    record.ecosystems = record.ecosystems.filter((e) => e !== "wordpress-candidate");
    if (record.wordpressPart) {
      record.ecosystems = [...new Set([...record.ecosystems, "wordpress"])];
    }
  }

  if (ecosystems.includes("ruby")) {
    const gemfile = await readIfPresent(join(dir, "Gemfile"), 8_000);
    if (gemfile) {
      evidence.rubyDeps = [...gemfile.matchAll(/^\s*gem\s+["']([^"']+)["']/gm)].map((m) => m[1]);
    }
  }

  if (ecosystems.includes("godot")) {
    const raw = await readIfPresent(join(dir, "project.godot"), 4_000);
    const m = raw?.match(/config\/name\s*=\s*"([^"]+)"/);
    if (m) record.name = m[1];
  }

  record.frameworks = detectFrameworks(evidence);

  // Root-level documents, plus one level down (docs/, doc/), which is where
  // projects conventionally keep the rest.
  const docPaths = fileNames.filter((f) => DOC_EXTENSIONS.test(f));
  for (const dirName of ["docs", "doc", "documentation", ".github"]) {
    try {
      const nested = await readdir(join(dir, dirName), { withFileTypes: true });
      for (const entry of nested) {
        if (entry.isFile() && DOC_EXTENSIONS.test(entry.name)) {
          docPaths.push(`${dirName}/${entry.name}`);
        }
      }
    } catch {
      /* no such directory */
    }
  }

  const { carried, skipped } = selectDocs(docPaths);
  record.docs = carried.map((d) => d.path);
  // Kept so the default is auditable: a user can see what was left out and why.
  record.docsSkipped = skipped;

  // Images are proposed, not carried: publication waits for the author to look
  // at them. Discovery only visits directories that conventionally hold
  // material already made for an audience.
  record.images = proposeImages(await discoverImages(dir));

  record.git.isRepo = await exists(join(dir, ".git"));
  return record;
}
