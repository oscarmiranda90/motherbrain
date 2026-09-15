import { test } from "node:test";
import assert from "node:assert/strict";

import { toYaml, buildDocument, parseDocument } from "../src/manifest/yaml.js";
import { entryFromScan, slugify } from "../src/manifest/schema.js";
import { detectFrameworks, structuralRole, inferKind, describeStructure } from "../src/scan/classify.js";
import { isScaffoldDescription } from "../src/scan/detect.js";
import { buildTree, defaultChecked, groupLabel } from "../src/scan/tree.js";
import { parseRemote } from "../src/scan/git.js";
import { buildPickPayload, renderPickPage } from "../src/dashboard/pick.js";

// --- frontmatter -----------------------------------------------------------

test("yaml round-trips the frontmatter shapes the schema uses", () => {
  const original = {
    id: "supacut",
    name: "SupaCut",
    tagline: "Describe your edit, get a cut list",
    status: "shipped",
    frameworks: ["React", "Vite", "TypeScript"],
    ecosystem: ["node"],
    tags: [],
    links: { site: null, repo: "https://github.com/x/supacut", demo: null },
    metrics: {},
    commits: 42,
    public: true,
  };

  const { frontmatter } = parseDocument(buildDocument(original, "# body"));

  assert.equal(frontmatter.id, "supacut");
  assert.equal(frontmatter.tagline, "Describe your edit, get a cut list");
  assert.deepEqual(frontmatter.frameworks, ["React", "Vite", "TypeScript"]);
  assert.deepEqual(frontmatter.tags, []);
  assert.equal(frontmatter.links.repo, "https://github.com/x/supacut");
  assert.equal(frontmatter.links.site, null);
  assert.equal(frontmatter.commits, 42);
  assert.equal(frontmatter.public, true);
});

test("yaml round-trips a list of maps without losing items", () => {
  // The shape `documents` uses. An earlier writer emitted a bare dash with
  // over-indented keys, which the reader could not distinguish from a nested
  // map — so every entry after the first vanished silently.
  const original = {
    documents: [
      { path: "README.md", summary: "What it is and how to run it" },
      { path: "DESIGN.md", summary: null },
      { path: "docs/ARCHITECTURE.md", summary: "Module layout" },
    ],
  };

  const { frontmatter } = parseDocument(buildDocument(original, "# body"));

  assert.ok(Array.isArray(frontmatter.documents), "must parse back as a list");
  assert.equal(frontmatter.documents.length, 3, "no item may be dropped");
  assert.deepEqual(frontmatter.documents[0], {
    path: "README.md",
    summary: "What it is and how to run it",
  });
  assert.equal(frontmatter.documents[1].summary, null);
  assert.equal(frontmatter.documents[2].path, "docs/ARCHITECTURE.md");
});

test("yaml still round-trips a list of scalars", () => {
  const { frontmatter } = parseDocument(
    buildDocument({ tags: ["ios", "video"], capabilities: [] }, "# body"),
  );
  assert.deepEqual(frontmatter.tags, ["ios", "video"]);
  assert.deepEqual(frontmatter.capabilities, []);
});

test("yaml quotes values that would otherwise change meaning", () => {
  const out = toYaml({ a: "yes", b: "1.0", c: "value: with colon", d: "- leading dash", e: "" });
  assert.match(out, /a: "yes"/);
  assert.match(out, /b: "1\.0"/);
  assert.match(out, /c: "value: with colon"/);
  assert.match(out, /d: "- leading dash"/);
  assert.match(out, /e: ""/);
});

test("parseDocument keeps the body intact", () => {
  const doc = buildDocument({ id: "x" }, "# Title\n\n## What it is\n\nProse here.");
  const { body } = parseDocument(doc);
  assert.match(body, /^# Title/);
  assert.match(body, /Prose here\./);
});

// --- framework detection ---------------------------------------------------

test("detectFrameworks reads config files as well as dependencies", () => {
  // A config file is stronger evidence than a dependency: a project can carry
  // `next` as a transitive dep without being a Next.js app.
  assert.ok(detectFrameworks({ files: ["next.config.ts"] }).includes("Next.js"));
  assert.ok(detectFrameworks({ files: ["astro.config.mjs"] }).includes("Astro"));
  assert.ok(detectFrameworks({ deps: ["next", "react", "tailwindcss"] }).includes("Next.js"));
});

test("detectFrameworks covers the non-JavaScript ecosystems", () => {
  assert.ok(detectFrameworks({ pyDeps: ["fastapi", "uvicorn"] }).includes("FastAPI"));
  assert.ok(detectFrameworks({ files: ["manage.py"], pyDeps: ["Django"] }).includes("Django"));
  assert.ok(detectFrameworks({ phpDeps: ["laravel/framework"] }).includes("Laravel"));
  assert.ok(detectFrameworks({ rubyDeps: ["rails"] }).includes("Rails"));
  assert.ok(
    detectFrameworks({ pubspecText: "dependencies:\n  firebase_core: ^2.0.0\n" }).includes("Firebase"),
  );
  assert.ok(
    detectFrameworks({ pubspecText: "dependencies:\n  flutter_riverpod: ^2.0.0\n" }).includes("Riverpod"),
  );
});

test("detectFrameworks reports every match, not one winner", () => {
  const found = detectFrameworks({
    deps: ["next", "react", "tailwindcss", "@supabase/supabase-js", "zustand"],
    files: ["next.config.ts", "tsconfig.json"],
  });
  for (const expected of ["Next.js", "React", "Tailwind", "Supabase", "Zustand", "TypeScript"]) {
    assert.ok(found.includes(expected), `expected ${expected} in ${found.join(", ")}`);
  }
});

test("template descriptions are refused as taglines", () => {
  // These are real strings found in scaffolded package.json files. Passing one
  // through would put a template's words into a CV as if they were the user's.
  for (const junk of [
    "A blank template to get started with Payload 3.0",
    "A new Flutter project.",
    "Bootstrapped with create-next-app",
    "React + TypeScript + Vite",
    "my app",
    "TODO",
    "",
  ]) {
    assert.equal(isScaffoldDescription(junk), true, `should refuse: ${junk}`);
  }

  // A description someone actually wrote survives.
  for (const real of [
    "Describe your edit in plain English, get a cut list back",
    "Teleprompter that keeps your eyeline beside the lens",
    "Geo-grid rank tracking for local SEO",
  ]) {
    assert.equal(isScaffoldDescription(real), false, `should keep: ${real}`);
  }
});

test("describeStructure prefers frameworks and falls back to ecosystem", () => {
  assert.equal(describeStructure({ frameworks: ["Next.js", "React"], ecosystems: ["node"] }), "Next.js · React");
  assert.equal(describeStructure({ frameworks: [], ecosystems: ["go"] }), "Go");
  assert.equal(describeStructure({ frameworks: [], ecosystems: ["wordpress", "php"] }), "WordPress · PHP");
  assert.equal(describeStructure({ frameworks: [], ecosystems: [] }), "unknown");
});

// --- structural role -------------------------------------------------------

test("structuralRole names what a folder is, without judging it", () => {
  // A Flutter app's android/ folder carries a real build.gradle; a monorepo's
  // apps/web a real package.json. Both are parts, and saying so is a fact
  // about the tree — not a claim that they do not matter.
  assert.equal(
    structuralRole({ dirName: "android", path: "/p/app/android", nestedUnder: "/p/app" }),
    "platform",
  );
  assert.equal(
    structuralRole({ dirName: "web", path: "/p/app/apps/web", nestedUnder: "/p/app" }),
    "package",
  );
  assert.equal(
    structuralRole({ dirName: "match", path: "/p/app/workers/match", nestedUnder: "/p/app" }),
    "package",
  );
  assert.equal(
    structuralRole({ dirName: "my-video", path: "/p/app/my-video", nestedUnder: "/p/app" }),
    "nested",
  );
  // A top-level folder honestly named `web` is a project, not scaffolding.
  assert.equal(structuralRole({ dirName: "web", path: "/p/web", nestedUnder: null }), "project");
});

test("inferKind maps structure to a starting kind", () => {
  assert.equal(inferKind({ ecosystems: ["flutter"], frameworks: [] }), "mobile-app");
  assert.equal(inferKind({ ecosystems: ["node"], frameworks: ["Next.js"] }), "web-app");
  assert.equal(inferKind({ ecosystems: ["node"], frameworks: ["Astro"] }), "website");
  assert.equal(inferKind({ ecosystems: ["wordpress"], frameworks: [] }), "website");
  assert.equal(inferKind({ ecosystems: ["godot"], frameworks: [] }), "game");
  assert.equal(inferKind({ ecosystems: ["node"], frameworks: ["Express"] }), "service");
  assert.equal(inferKind({ ecosystems: ["node"], frameworks: ["Electron"] }), "desktop-app");
  assert.equal(inferKind({ ecosystems: ["go"], frameworks: [] }), "cli");
  assert.equal(
    inferKind({ ecosystems: ["java"], frameworks: [], role: "platform" }),
    "platform-scaffold",
  );
});

// --- tree ------------------------------------------------------------------

test("buildTree nests parts under their parent project", () => {
  const rows = buildTree([
    { name: "android", path: "/d/app/android", dirName: "android", nestedUnder: "/d/app", role: "platform" },
    { name: "mythika", path: "/d/app", dirName: "app", nestedUnder: null, role: "project" },
    { name: "match-worker", path: "/d/app/workers/match", dirName: "match", nestedUnder: "/d/app", role: "package" },
    { name: "aardvark", path: "/d/other", dirName: "other", nestedUnder: null, role: "project" },
  ]);

  const order = rows.map((r) => `${r.depth}:${r.name}`);
  assert.deepEqual(order, [
    "0:aardvark",
    "0:mythika",
    "1:match-worker",
    "1:android",
  ], `got ${order.join(" | ")}`);

  const parent = rows.find((r) => r.name === "mythika");
  assert.equal(parent.hasChildren, true);
  assert.equal(parent.childCount, 2);
});

test("buildTree reparents when an intermediate folder was not detected", () => {
  // `apps/` itself carries no marker, so it never appears in the result set.
  // The child must still be attached to the nearest ancestor that did.
  const rows = buildTree([
    { name: "root", path: "/d/repo", dirName: "repo", nestedUnder: null },
    { name: "api", path: "/d/repo/apps/api", dirName: "api", nestedUnder: "/d/repo/apps" },
  ]);
  assert.equal(rows.length, 2);
  assert.equal(rows[0].name, "root");
  assert.equal(rows[0].depth, 0);
  assert.equal(rows[1].name, "api");
  assert.equal(rows[1].depth, 1, "the child belongs under the project it lives in");
});

test("buildTree keeps a row whose ancestors were all undetected", () => {
  // Nothing above it was found, so it stands on its own rather than vanishing.
  const rows = buildTree([
    { name: "orphan", path: "/d/elsewhere/deep/thing", dirName: "thing", nestedUnder: "/d/elsewhere/deep" },
  ]);
  assert.equal(rows.length, 1);
  assert.equal(rows[0].depth, 0);
});

test("nothing is dropped from the tree", () => {
  const input = Array.from({ length: 20 }, (_, i) => ({
    name: `p${i}`,
    path: `/d/p${i}`,
    dirName: `p${i}`,
    nestedUnder: i % 3 === 0 ? null : "/d/p0",
  }));
  assert.equal(buildTree(input).length, 20);
});

test("a workspace root borrows the frameworks of its parts", () => {
  // `supacut/package.json` declares only the workspace; the real stack lives in
  // `apps/web`. Describing the root as bare Node would hide what it is.
  const rows = buildTree([
    { name: "supacut", path: "/d/supacut", dirName: "supacut", nestedUnder: null, frameworks: [], ecosystems: ["node"] },
    { name: "web", path: "/d/supacut/apps/web", dirName: "web", nestedUnder: "/d/supacut", role: "package", frameworks: ["React", "Vite"], ecosystems: ["node"] },
    { name: "api", path: "/d/supacut/apps/api", dirName: "api", nestedUnder: "/d/supacut", role: "package", frameworks: ["Express", "React"], ecosystems: ["node"] },
    { name: "android", path: "/d/supacut/android", dirName: "android", nestedUnder: "/d/supacut", role: "platform", frameworks: ["Gradle"], ecosystems: ["kotlin"] },
  ]);

  const root = rows.find((r) => r.name === "supacut");
  assert.ok(root.frameworks.includes("React"), "should inherit from its packages");
  assert.ok(root.frameworks.includes("Express"));
  assert.equal(root.frameworks[0], "React", "labels several parts agree on come first");
  assert.ok(!root.frameworks.includes("Gradle"), "platform scaffolding is not the project's stack");
  assert.equal(root.frameworksInherited, true);

  // A project that declares its own frameworks keeps exactly those.
  const leaf = rows.find((r) => r.name === "web");
  assert.deepEqual(leaf.frameworks, ["React", "Vite"]);
  assert.ok(!leaf.frameworksInherited);
});

test("defaultChecked selects whole projects, not their internals", () => {
  assert.equal(defaultChecked({ depth: 0 }), true);
  assert.equal(defaultChecked({ depth: 1 }), false);
  assert.equal(defaultChecked({ depth: 2 }), false);
});

test("groupLabel names the containing folder for top-level rows only", () => {
  assert.equal(groupLabel({ depth: 0, path: "/disk/clients/acme" }, "/disk"), "clients");
  assert.equal(groupLabel({ depth: 0, path: "/disk/acme" }, "/disk"), null);
  assert.equal(groupLabel({ depth: 1, path: "/disk/clients/acme/web" }, "/disk"), null);
});

// --- schema ----------------------------------------------------------------

test("entryFromScan records structure and never guesses judgement calls", () => {
  const entry = entryFromScan({
    name: "vcgranch-next",
    dirName: "vcgranch-next",
    path: "/disk/vcgranch/vcgranch-next",
    ecosystems: ["node"],
    frameworks: ["Next.js", "Tailwind"],
    kind: "web-app",
    role: "project",
    nestedUnder: null,
    docs: ["README.md"],
    deploy: ["cloudflare"],
    git: { isRepo: true, commits: 1, lastCommit: "2026-05-04", firstCommit: "2026-05-04", branch: "main" },
  });

  assert.equal(entry.id, "vcgranch-next");
  assert.deepEqual(entry.frameworks, ["Next.js", "Tailwind"]);
  assert.deepEqual(entry.ecosystem, ["node"]);
  assert.equal(entry.kind, "web-app");
  assert.equal(entry.last_active, "2026-05-04");
  assert.equal(entry.source.path, "/disk/vcgranch/vcgranch-next");
  assert.equal(entry.source.structure, "project");

  // These require reading the project, or asking the person who built it.
  assert.equal(entry.status, null, "status is never inferred from activity");
  assert.equal(entry.architecture, null);
  assert.equal(entry.domain, null);
  assert.equal(entry.narrative_status, "missing");
});

test("entryFromScan marks a public remote and keeps private ones unlinked", () => {
  const open = entryFromScan({
    name: "supacut",
    dirName: "supacut",
    path: "/d/supacut",
    ecosystems: ["node"],
    frameworks: [],
    git: { isRepo: true, likelyOpenSource: true, remote: "https://github.com/x/supacut" },
  });
  assert.equal(open.visibility, "public");
  assert.equal(open.links.repo, "https://github.com/x/supacut");

  const closed = entryFromScan({
    name: "client-thing",
    dirName: "client-thing",
    path: "/d/client-thing",
    ecosystems: ["node"],
    frameworks: [],
    git: { isRepo: true, likelyOpenSource: false, remote: "git@internal:acme/thing" },
  });
  assert.equal(closed.visibility, null, "visibility is the user's call when not public");
  assert.equal(closed.links.repo, null);
});

test("entryFromScan preserves the part_of relationship", () => {
  const entry = entryFromScan({
    name: "@mythika/match-worker",
    dirName: "match",
    path: "/d/app/workers/match",
    ecosystems: ["node"],
    frameworks: ["TypeScript"],
    role: "package",
    nestedUnder: "/d/app",
    git: { isRepo: true },
  });
  assert.equal(entry.id, "mythika-match-worker");
  assert.equal(entry.source.structure, "package");
  assert.equal(entry.source.part_of, "/d/app");
});

// --- scanning a single project ---------------------------------------------

test("scanRoot excludes the scanned directory unless asked for it", async (t) => {
  const { mkdtemp, mkdir, writeFile } = await import("node:fs/promises");
  const { tmpdir } = await import("node:os");
  const { join: j } = await import("node:path");
  const { scanRoot } = await import("../src/scan/detect.js");

  const dir = await mkdtemp(j(tmpdir(), "mb-scan-"));
  await writeFile(j(dir, "package.json"), JSON.stringify({ name: "root-proj", dependencies: { next: "15" } }));
  await mkdir(j(dir, "apps", "web"), { recursive: true });
  await writeFile(
    j(dir, "apps", "web", "package.json"),
    JSON.stringify({ name: "web", dependencies: { react: "19" } }),
  );

  // Pointing at a whole drive must not catalog the drive itself.
  const without = await scanRoot(dir, { maxDepth: 3 });
  assert.ok(!without.some((r) => r.path === dir), "the root is not a candidate by default");
  assert.ok(without.some((r) => r.name === "web"), "children are still found");

  // `brain add <project>` scans the project itself, so the root IS the answer.
  const withRoot = await scanRoot(dir, { maxDepth: 3, includeRoot: true });
  const root = withRoot.find((r) => r.path === dir);
  assert.ok(root, "includeRoot makes the scanned directory a candidate");
  assert.equal(root.name, "root-proj");
});

test("vendored dependency trees are not reported as the user's projects", async () => {
  const { mkdtemp, mkdir, writeFile } = await import("node:fs/promises");
  const { tmpdir } = await import("node:os");
  const { join: j } = await import("node:path");
  const { scanRoot } = await import("../src/scan/detect.js");

  const dir = await mkdtemp(j(tmpdir(), "mb-vendor-"));
  // Foundry installs real projects, complete with manifests, into `lib/`.
  await mkdir(j(dir, "contracts", "lib", "forge-std"), { recursive: true });
  await writeFile(j(dir, "contracts", "foundry.toml"), "[profile.default]\n");
  await writeFile(j(dir, "contracts", "package.json"), JSON.stringify({ name: "my-protocol" }));
  await writeFile(
    j(dir, "contracts", "lib", "forge-std", "package.json"),
    JSON.stringify({ name: "forge-std" }),
  );

  const found = await scanRoot(dir, { maxDepth: 6 });
  const names = found.map((r) => r.name);
  assert.ok(names.includes("my-protocol"), "the user's own project is found");
  assert.ok(!names.includes("forge-std"), "a vendored dependency is not");
});

// --- two tiers ---------------------------------------------------------------

// --- documents: the author's own words --------------------------------------

test("conventional documents are carried and working artifacts are not", async () => {
  const { classifyDoc, selectDocs } = await import("../src/scan/docs.js");

  // Documents that describe the project: the author's standing statements.
  for (const name of [
    "README.md",
    "DESIGN.md",
    "AGENTS.md",
    "CLAUDE.md",
    "PRODUCT.md",
    "brief.md",
    "idea.md",
    "proposal.md",
    "ROADMAP.md",
    "TERMS.md",
    "PRIVACY.md",
    "docs/ARCHITECTURE.md",
  ]) {
    assert.equal(classifyDoc(name).include, true, `should carry ${name}`);
  }

  // Working artifacts: real, but written to coordinate work rather than to
  // describe the project. Embedding these publishes session logs.
  for (const name of [
    "HANDOFF_TO_CLAUDE.md",
    "HANDOFF_SUPAFILM_V2.md",
    "supacut-plan.md",
    "revampui-plan.md",
    "tasks.md",
    "audit.md",
    "notes.md",
    "aso_generated_screenshots.md",
    "campaign-cutscene-background-prompts.md",
    "openspec/changes/x/design.md",
  ]) {
    assert.equal(classifyDoc(name).include, false, `should not carry ${name}`);
  }

  // Every exclusion carries a reason, so the default is auditable.
  const { carried, skipped } = selectDocs(["README.md", "HANDOFF_TO_CODEX.md", "weird-name.md"]);
  assert.deepEqual(carried.map((d) => d.path), ["README.md"]);
  assert.equal(skipped.length, 2);
  for (const s of skipped) assert.ok(s.reason.length > 0, "an omission must explain itself");
});

test("the author can name a document the default would skip", async () => {
  const { classifyDoc } = await import("../src/scan/docs.js");

  // A real design doc with a project-specific name: not conventional, so not
  // carried by default — the cost of a wrong guess falls on a public page.
  assert.equal(classifyDoc("adding-a-pantheon.md").include, false);

  // Declaring it is an explicit statement by the person whose work it is.
  const declared = classifyDoc("adding-a-pantheon.md", { include: ["adding-a-pantheon.md"] });
  assert.equal(declared.include, true);
  assert.equal(declared.kind, "declared");

  // A declaration outranks even the skip-directory rule: they know their layout.
  assert.equal(
    classifyDoc("openspec/changes/x/design.md", { include: ["openspec/changes/x/design.md"] }).include,
    true,
  );
});

test("documents are inventoried in the catalogue and embedded in the dossier", async () => {
  const { mkdtemp, mkdir, writeFile: wf, readFile: rf } = await import("node:fs/promises");
  const { tmpdir } = await import("node:os");
  const { join: j } = await import("node:path");
  const { buildBundle } = await import("../src/manifest/bundle.js");

  const root = await mkdtemp(j(tmpdir(), "mb-docs-"));
  const projectDir = await mkdtemp(j(tmpdir(), "mb-proj-"));
  await wf(j(projectDir, "README.md"), "# Thing\n\nThe author's own words about it.\n");
  await mkdir(j(root, "projects"), { recursive: true });
  await wf(
    j(root, "projects", "a.md"),
    [
      "---",
      "id: a",
      "name: Alpha",
      "documents:",
      "  -",
      "    path: README.md",
      "    summary: What it is and how to run it",
      "source:",
      `  path: ${projectDir}`,
      "---",
      "",
      "## Card",
      "",
      "Short summary.",
      "",
    ].join("\n"),
  );

  const bundle = await buildBundle(root);
  const catalogued = bundle.projects.find((p) => p.id === "a");

  // The catalogue lists what exists; it must stay cheap to read for everyone.
  assert.equal(catalogued.documents.length, 1);
  assert.equal(catalogued.documents[0].path, "README.md");
  assert.equal(catalogued.documents[0].summary, "What it is and how to run it");
  assert.ok(catalogued.documents[0].words > 0, "size is inventory, not content");
  assert.equal(catalogued.documents[0].text, undefined, "no document body in the catalogue");

  // The dossier carries the primary source, so an agent reads the author's
  // words rather than anyone's summary of them.
  const dossier = JSON.parse(await rf(j(root, "api", "projects", "a.json"), "utf8"));
  assert.match(dossier.documents[0].text, /The author's own words about it/);
});

test("the card is the index tier and stays separate from the dossier", async () => {
  const { CARD_SECTION, SECTIONS, ALL_SECTIONS } = await import("../src/manifest/schema.js");

  assert.equal(CARD_SECTION.heading, "Card");
  assert.ok(CARD_SECTION.target_words <= 150, "the card must stay cheap to read for every project");
  assert.equal(ALL_SECTIONS[0], CARD_SECTION, "the card comes first");
  assert.equal(ALL_SECTIONS.length, SECTIONS.length + 1);

  // Every section must ask for something a reader could verify against the
  // repository. Sections that ask which choices mattered or what lesson
  // transfers were removed on purpose: that is the consumer's analysis to make
  // with their own prompts, and shipping it inside the data makes one agent's
  // reading indistinguishable from fact.
  const headings = SECTIONS.map((s) => s.heading);
  for (const needed of ["What it does", "How it works", "Architecture", "Stack and dependencies", "State"]) {
    assert.ok(headings.includes(needed), `missing section: ${needed}`);
  }
  for (const judgement of ["Notable decisions", "Transferable insight", "What it proposes"]) {
    assert.ok(!headings.includes(judgement), `${judgement} asks for an opinion, not a fact`);
  }

  // The prompts themselves must not solicit evaluation.
  const allPrompts = [CARD_SECTION, ...SECTIONS].map((s) => s.prompt).join(" ").toLowerCase();
  for (const word of ["lesson", "worth defending", "the most useful", "interesting"]) {
    assert.ok(!allPrompts.includes(word), `prompt language invites judgement: "${word}"`);
  }
});

test("entryFromScan leaves the cross-project fields for the ingest step", () => {
  const entry = entryFromScan({
    name: "x",
    dirName: "x",
    path: "/d/x",
    ecosystems: ["node"],
    frameworks: ["React"],
    git: { isRepo: true },
  });

  // These describe what a project does and how it is built. Guessing them
  // would corrupt the index every cross-project question relies on.
  assert.deepEqual(entry.capabilities, []);
  assert.deepEqual(entry.patterns, []);
  assert.deepEqual(entry.relates_to, []);
});

test("migration drops our retired defaults but keeps the author's own sections", async () => {
  const { migrateEntry } = await import("../src/manifest/store.js");

  const old = {
    id: "x",
    name: "X",
    narrative_status: "reviewed",
    _file: "/d/projects/x.md",
    _body: [
      "# X",
      "",
      "## What it is",
      "",
      "Still a current section, so this survives.",
      "",
      "## Transferable insight",
      "",
      "An essay about what the lesson was.",
      "",
      "## Notable decisions",
      "",
      "More judgement about which choices mattered.",
      "",
      "## Deployment runbook",
      "",
      "A section the author invented themselves.",
      "",
    ].join("\n"),
  };

  const { frontmatter, body } = migrateEntry(old);

  assert.ok(body.includes("Still a current section"), "current sections keep their prose");
  assert.ok(
    body.includes("## Deployment runbook") && body.includes("A section the author invented"),
    "a heading the author invented is theirs and must survive",
  );

  // These were our defaults, not the author's choice. Keeping them would leave
  // every entry carrying both the retired prompts and the current ones.
  assert.ok(!body.includes("## Transferable insight"), "a retired default is removed");
  assert.ok(!body.includes("## Notable decisions"), "a retired default is removed");
  assert.ok(!body.includes("An essay about what the lesson was"), "and so is its prose");

  // Losing content means the entry is no longer fully written up.
  assert.equal(
    frontmatter.narrative_status,
    "dossier",
    "an entry that lost sections should go back through ingest",
  );
});

test("migrateEntry upgrades an older entry without touching its prose", async () => {
  const { migrateEntry } = await import("../src/manifest/store.js");

  const old = {
    id: "supacut",
    name: "SupaCut",
    narrative_status: "written",
    _file: "/d/projects/supacut.md",
    _body: "# SupaCut\n\n## What it is\n\nReal prose a human wrote.\n\n## Architecture\n\nMore real prose.\n",
  };

  const { frontmatter, body } = migrateEntry(old);

  assert.deepEqual(frontmatter.capabilities, [], "new fields are added");
  assert.equal(frontmatter.narrative_status, "dossier", "old vocabulary is mapped");
  assert.ok(body.includes("Real prose a human wrote."), "existing prose survives");
  assert.ok(body.includes("More real prose."), "every existing section survives");
  assert.ok(body.includes("## Card"), "the card section is added");
  assert.ok(body.includes("## How it works"), "new sections are added");
  assert.ok(
    body.indexOf("## Card") < body.indexOf("## What it is"),
    "the card is placed before the dossier",
  );
});

test("the catalogue says where each project lives", async () => {
  const { mkdtemp, mkdir, writeFile: wf } = await import("node:fs/promises");
  const { tmpdir } = await import("node:os");
  const { join: j } = await import("node:path");
  const { buildBundle } = await import("../src/manifest/bundle.js");
  const { redactBundle } = await import("../src/manifest/publish.js");

  const root = await mkdtemp(j(tmpdir(), "mb-src-"));
  await mkdir(j(root, "projects"), { recursive: true });
  await wf(
    j(root, "projects", "a.md"),
    ["---", "id: a", "name: A", "visibility: public", "source:", "  path: /disk/a", "  git: true", "---", "", "## Card", "", "x", ""].join("\n"),
  );

  // A local agent reading the catalogue must be able to open the project, and
  // `brain add` recognises an existing entry by comparing source.path.
  const bundle = await buildBundle(root);
  assert.equal(bundle.projects[0].source.path, "/disk/a");

  // The published copy still strips it: the two tiers have different rules.
  const { bundle: published } = redactBundle(bundle);
  assert.equal(published.projects[0].source.path, undefined);
});

test("the bundle separates catalogue from dossier", async () => {
  const { mkdtemp, mkdir, writeFile: wf, readFile: rf } = await import("node:fs/promises");
  const { tmpdir } = await import("node:os");
  const { join: j } = await import("node:path");
  const { buildBundle } = await import("../src/manifest/bundle.js");

  const root = await mkdtemp(j(tmpdir(), "mb-bundle-"));
  await mkdir(j(root, "projects"), { recursive: true });
  await wf(
    j(root, "projects", "a.md"),
    [
      "---",
      "id: a",
      "name: Alpha",
      "capabilities:",
      "  - asset-generation",
      "patterns:",
      "  - browser-local-processing",
      "frameworks:",
      "  - React",
      "---",
      "",
      "## Card",
      "",
      "Short index-level summary.",
      "",
      "## Architecture",
      "",
      "The long version, only read when selected.",
      "",
    ].join("\n"),
  );
  await wf(
    j(root, "projects", "b.md"),
    [
      "---",
      "id: b",
      "name: Beta",
      "capabilities:",
      "  - asset-generation",
      "patterns:",
      "  - browser-local-processing",
      "frameworks:",
      "  - React",
      "---",
      "",
      "## Card",
      "",
      "Another short summary.",
      "",
    ].join("\n"),
  );

  const bundle = await buildBundle(root);

  // The catalogue carries the card, never the dossier body.
  const alpha = bundle.projects.find((p) => p.id === "a");
  assert.equal(alpha.card, "Short index-level summary.");
  assert.equal(alpha.dossier.href, "projects/a.json");
  assert.ok(!JSON.stringify(bundle).includes("only read when selected"),
    "the dossier text must not bloat the catalogue");

  // The dossier lives in its own file, fetched on demand.
  const dossier = JSON.parse(await rf(j(root, "api", "projects", "a.json"), "utf8"));
  assert.match(dossier.dossier.sections.Architecture, /only read when selected/);

  // Cross-project indexes answer "what connects my work" without embeddings.
  assert.deepEqual(bundle.index.capabilities["asset-generation"], ["a", "b"]);
  assert.deepEqual(bundle.index.patterns["browser-local-processing"], ["a", "b"]);
  assert.equal(bundle.index.related.length, 1);
  assert.deepEqual(bundle.index.related[0].pair, ["a", "b"]);
  assert.deepEqual(bundle.index.related[0].shared.capabilities, ["asset-generation"]);
});

test("a shared framework alone is not treated as kinship", async () => {
  const { mkdtemp, mkdir, writeFile: wf } = await import("node:fs/promises");
  const { tmpdir } = await import("node:os");
  const { join: j } = await import("node:path");
  const { buildBundle } = await import("../src/manifest/bundle.js");

  const root = await mkdtemp(j(tmpdir(), "mb-weak-"));
  await mkdir(j(root, "projects"), { recursive: true });
  for (const id of ["a", "b"]) {
    await wf(
      j(root, "projects", `${id}.md`),
      ["---", `id: ${id}`, `name: ${id}`, "frameworks:", "  - React", "---", "", "## Card", "", "x", ""].join("\n"),
    );
  }

  const bundle = await buildBundle(root);
  // Two projects both using React says almost nothing — surfacing that as a
  // relationship would bury the ones that matter.
  assert.equal(bundle.index.related.length, 0);
});

// --- the publish boundary ----------------------------------------------------
//
// A published brain is a public page. A bug here is real-world harm, not an
// inconvenience, so these tests are deliberately paranoid.

test("publishing withholds every project not marked public", async () => {
  const { redactBundle } = await import("../src/manifest/publish.js");

  const local = {
    version: 2,
    projects: [
      { id: "open", name: "Open", visibility: "public", source: {}, relates_to: ["secret"] },
      { id: "secret", name: "Client Thing", visibility: "client", source: {} },
      { id: "mine", name: "Private", visibility: "private", source: {} },
      { id: "unset", name: "Unset", visibility: null, source: {} },
    ],
    index: {
      capabilities: { payments: ["open", "secret"] },
      related: [{ pair: ["open", "secret"], weight: 9, shared: {} }],
    },
  };

  const { bundle, withheld } = redactBundle(local);

  assert.deepEqual(bundle.projects.map((p) => p.id), ["open"]);
  assert.equal(withheld.length, 3, "client, private and unset are all withheld");

  // An index or relation naming a withheld project would leak its existence.
  assert.deepEqual(bundle.index.capabilities.payments, ["open"]);
  assert.equal(bundle.index.related.length, 0);
  assert.deepEqual(bundle.projects[0].relates_to, []);

  const serialized = JSON.stringify(bundle);
  for (const leak of ["secret", "Client Thing", "Private", "Unset"]) {
    assert.ok(!serialized.includes(leak), `published bundle must not mention ${leak}`);
  }
});

test("publishing strips filesystem paths from metadata and from prose", async () => {
  const { redactProject } = await import("../src/manifest/publish.js");

  const project = {
    id: "x",
    name: "X",
    visibility: "public",
    tagline: "Lives in /Users/oscar/secret-client/app",
    card: "Built at /Volumes/CORSAIR/clients/acme — a tool for editors.",
    highlights: ["Shipped from /home/deploy/build"],
    source: {
      path: "/Volumes/CORSAIR/crescenteDEV/supacut",
      remote: "https://github.com/me/supacut",
      branch: "main",
      commits: 42,
      deploy: ["cloudflare"],
      docs: ["README.md"],
      structure: "project",
    },
    dossier: {
      complete: true,
      sections: {
        Architecture: "The worker reads C:\\Users\\me\\data and /mnt/vol/cache.",
      },
    },
  };

  const out = redactProject(project);
  const serialized = JSON.stringify(out);

  // The local brain needs source.path to re-scan; a reader never does.
  assert.equal(out.source.path, undefined);
  assert.ok(!serialized.includes("/Volumes/CORSAIR"), "no volume paths");
  assert.ok(!serialized.includes("/Users/oscar"), "no home paths");
  assert.ok(!serialized.includes("/home/deploy"), "no linux home paths");
  assert.ok(!serialized.includes("/mnt/vol"), "no mount paths");
  assert.ok(!serialized.includes("C:\\Users"), "no windows paths");
  assert.match(out.card, /\[path\]/, "paths are replaced, not silently dropped");

  // What a reader can actually use survives.
  assert.equal(out.source.repo, "https://github.com/me/supacut");
  assert.equal(out.source.commits, 42);
  assert.deepEqual(out.source.deploy, ["cloudflare"]);
  assert.match(out.card, /a tool for editors/, "the prose itself is preserved");
});

test("--include-private is the only way private entries are published", async () => {
  const { redactBundle } = await import("../src/manifest/publish.js");

  const local = {
    version: 2,
    projects: [{ id: "p", name: "P", visibility: "private", source: { path: "/Users/me/p" } }],
    index: {},
  };

  const closed = redactBundle(local);
  assert.equal(closed.bundle.projects.length, 0, "publishing is opt-in per project");

  const opened = redactBundle(local, { includePrivate: true });
  assert.equal(opened.bundle.projects.length, 1);
  // Even then, paths never travel.
  assert.equal(opened.bundle.projects[0].source.path, undefined);
});

test("writing prompts are never published as content", async () => {
  const { mkdtemp, mkdir, writeFile: wf } = await import("node:fs/promises");
  const { tmpdir } = await import("node:os");
  const { join: j } = await import("node:path");
  const { buildBundle } = await import("../src/manifest/bundle.js");

  const root = await mkdtemp(j(tmpdir(), "mb-todo-"));
  await mkdir(j(root, "projects"), { recursive: true });
  // Exactly what `brain add` writes: the card placeholder has no colon right
  // after TODO, which an earlier regex missed — publishing the instructions
  // to the page as though they were the project's description.
  await wf(
    j(root, "projects", "a.md"),
    [
      "---",
      "id: a",
      "name: Alpha",
      "---",
      "",
      "## Card",
      "",
      "<!-- TODO (~120 words): Under 120 words, self-contained: what this is. -->",
      "",
      "## Architecture",
      "",
      "<!-- TODO: How it is put together. -->",
      "",
      "## Outcome",
      "",
      "It shipped in March.",
      "",
    ].join("\n"),
  );

  const bundle = await buildBundle(root);
  const project = bundle.projects[0];

  assert.equal(project.card, null, "an unwritten card is absent, not a prompt");
  assert.ok(
    !JSON.stringify(bundle).includes("TODO"),
    "no writing instructions may reach a consumer",
  );
  assert.ok(
    !JSON.stringify(bundle).includes("Under 120 words"),
    "no prompt text may reach a consumer",
  );
  // Unwritten sections are simply not there; written ones survive intact.
  assert.deepEqual(project.dossier.sections, ["Outcome"]);
});

test("the briefing ignores generated files when ranking by size", async () => {
  const { mkdtemp, mkdir, writeFile: wf } = await import("node:fs/promises");
  const { tmpdir } = await import("node:os");
  const { join: j } = await import("node:path");
  const { collectBrief } = await import("../src/ingest/brief.js");

  const dir = await mkdtemp(j(tmpdir(), "mb-gen-"));
  await mkdir(j(dir, "src"), { recursive: true });
  await wf(j(dir, "package.json"), JSON.stringify({ name: "g" }));
  // Machine output, and far larger than anything a person wrote.
  await wf(j(dir, "worker-configuration.d.ts"), "declare type X = 1;\n".repeat(4000));
  await wf(j(dir, "src", "planner.ts"), "export const plan = () => {};\n".repeat(20));

  const brief = await collectBrief({
    id: "g",
    name: "G",
    source: { path: dir, docs: [], git: false, deploy: [] },
  });

  const ranked = brief.largest_source_files.map((f) => f.path);
  assert.ok(
    !ranked.some((p) => p.includes("worker-configuration")),
    "generated types must not be presented as the substance of a project",
  );
  assert.ok(ranked.some((p) => p.endsWith("planner.ts")), "real source still ranks");
});

// --- images: discovered automatically, published only on confirmation -------

test("images are proposed from audience-facing directories only", async () => {
  const { mkdtemp, mkdir, writeFile: wf } = await import("node:fs/promises");
  const { tmpdir } = await import("node:os");
  const { join: j } = await import("node:path");
  const { discoverImages } = await import("../src/scan/images.js");

  const dir = await mkdtemp(j(tmpdir(), "mb-img-"));
  for (const path of [
    "assets/branding/hook.webp",
    "screenshots/01-home.png",
    "lib/widgets/placeholder.png",        // source tree: not audience-facing
    "test/fixtures/sample.png",           // fixture
    "assets/branding/debug-overlay.png",  // internal by name
    "ios/Runner/Assets.xcassets/AppIcon.appiconset/icon.png", // platform asset
  ]) {
    await mkdir(j(dir, path.slice(0, path.lastIndexOf("/"))), { recursive: true });
    await wf(j(dir, path), "x".repeat(64));
  }

  const found = (await discoverImages(dir)).map((i) => i.path);

  assert.ok(found.includes("assets/branding/hook.webp"), "branding is made to be shown");
  assert.ok(found.includes("screenshots/01-home.png"), "screenshots are made to be shown");
  assert.ok(!found.some((p) => p.startsWith("lib/")), "the source tree is not a gallery");
  assert.ok(!found.some((p) => p.includes("fixtures")), "fixtures are not artwork");
  assert.ok(!found.some((p) => p.includes("debug")), "an internal name is excluded");
  assert.ok(!found.some((p) => p.includes("AppIcon")), "platform assets describe a platform");
});

test("an optimised derivative wins over its heavy original", async () => {
  const { dedupeByStem } = await import("../src/scan/images.js");

  // Authors commit both; publishing the 1.6MB PNG when a 20KB webp sits beside
  // it is simply wrong.
  const kept = dedupeByStem([
    { path: "assets/branding/hook.png", bytes: 1_600_000, from: "assets/branding" },
    { path: "assets/branding/hook.webp", bytes: 20_000, from: "assets/branding" },
    { path: "assets/branding/story.png", bytes: 861_000, from: "assets/branding" },
  ]);

  assert.deepEqual(
    kept.map((i) => i.path),
    ["assets/branding/hook.webp", "assets/branding/story.png"],
    "the webp replaces its png, and a png with no derivative survives",
  );
});

test("heavy images are still proposed, but flagged for re-encoding", async () => {
  const { mkdtemp, mkdir, writeFile: wf } = await import("node:fs/promises");
  const { tmpdir } = await import("node:os");
  const { join: j } = await import("node:path");
  const { discoverImages, proposeImages, needsOptimising, RASTER_SIZE_LIMIT } = await import(
    "../src/scan/images.js"
  );

  const dir = await mkdtemp(j(tmpdir(), "mb-heavy-"));
  await mkdir(j(dir, "assets/branding"), { recursive: true });
  // A phone screenshot: usually both the largest file and the most useful
  // picture, so excluding it would drop the best material.
  await wf(j(dir, "assets/branding/teleprompter.png"), "x".repeat(RASTER_SIZE_LIMIT + 1024));
  await wf(j(dir, "assets/branding/hook.webp"), "x".repeat(18 * 1024));
  // SVG is text; a large one is usually a detailed diagram.
  await wf(j(dir, "assets/branding/diagram.svg"), "<svg>" + "x".repeat(RASTER_SIZE_LIMIT) + "</svg>");

  const proposed = proposeImages(await discoverImages(dir));
  const byPath = new Map(proposed.map((i) => [i.path, i]));

  assert.ok(byPath.has("assets/branding/teleprompter.png"), "the heavy one is offered");
  assert.equal(byPath.get("assets/branding/teleprompter.png").needs_optimising, true);
  assert.equal(byPath.get("assets/branding/hook.webp").needs_optimising, undefined);
  assert.equal(
    byPath.get("assets/branding/diagram.svg").needs_optimising,
    undefined,
    "svg is exempt from the byte budget",
  );

  assert.equal(needsOptimising({ path: "a.png", bytes: RASTER_SIZE_LIMIT + 1 }), true);
  assert.equal(needsOptimising({ path: "a.svg", bytes: RASTER_SIZE_LIMIT * 4 }), false);
});

// --- publish-time optimisation ----------------------------------------------

test("the publish threshold is stricter than the discovery threshold", async () => {
  const { OPTIMISE_ABOVE } = await import("../src/media/optimise.js");
  const { RASTER_SIZE_LIMIT } = await import("../src/scan/images.js");

  // Discovery asks "is this worth offering to the author", where a heavy file
  // is still a good picture. Publishing asks "does this belong on a page", and
  // the answer is stricter. A 424KB PNG once slipped through unchanged while
  // its 2.2MB siblings were re-encoded to 38-51KB.
  assert.ok(
    OPTIMISE_ABOVE < RASTER_SIZE_LIMIT,
    "a file small enough to propose can still be too heavy to publish as-is",
  );
});

test("an image within budget is published untouched", async () => {
  const { mkdtemp, writeFile: wf, readFile: rf } = await import("node:fs/promises");
  const { tmpdir } = await import("node:os");
  const { join: j } = await import("node:path");
  const { placeImage } = await import("../src/media/optimise.js");

  const dir = await mkdtemp(j(tmpdir(), "mb-place-"));
  const from = j(dir, "hook.webp");
  // Re-encoding an author's already-optimised file can only lose quality.
  await wf(from, "original-bytes");

  const result = await placeImage({ from, to: j(dir, "out", "hook.webp"), budget: 1024 });

  assert.equal(result.ok, true);
  assert.equal(result.action, "copied");
  assert.equal(await rf(j(dir, "out", "hook.webp"), "utf8"), "original-bytes");
});

test("an svg is never rasterised, however large", async () => {
  const { mkdtemp, writeFile: wf, stat: st } = await import("node:fs/promises");
  const { tmpdir } = await import("node:os");
  const { join: j } = await import("node:path");
  const { placeImage } = await import("../src/media/optimise.js");

  const dir = await mkdtemp(j(tmpdir(), "mb-svg-"));
  const from = j(dir, "diagram.svg");
  await wf(from, `<svg>${"x".repeat(4096)}</svg>`);

  const result = await placeImage({ from, to: j(dir, "out", "diagram.svg"), budget: 512 });

  assert.equal(result.action, "copied", "a diagram stays a diagram");
  assert.ok((await st(j(dir, "out", "diagram.svg"))).size > 512);
});

test("publishing without an encoder reports the gap instead of shipping megabytes", async () => {
  const { mkdtemp, writeFile: wf } = await import("node:fs/promises");
  const { tmpdir } = await import("node:os");
  const { join: j } = await import("node:path");
  const optimise = await import("../src/media/optimise.js");

  const dir = await mkdtemp(j(tmpdir(), "mb-noenc-"));
  const from = j(dir, "huge.png");
  await wf(from, "x".repeat(4096));

  // Simulate a machine with no ffmpeg, cwebp, magick or sips on PATH.
  const originalPath = process.env.PATH;
  optimise.resetEncoderCache();
  process.env.PATH = j(dir, "empty-bin");
  try {
    const result = await optimise.placeImage({
      from,
      to: j(dir, "out", "huge.png"),
      budget: 512,
    });
    assert.equal(result.ok, false);
    assert.equal(result.action, "skipped");
    assert.equal(result.reason, "no image encoder available");
    assert.match(optimise.INSTALL_HINT, /ffmpeg/, "the user is told what to install");
  } finally {
    process.env.PATH = originalPath;
    optimise.resetEncoderCache();
  }
});

test("a re-encoded image is referenced by the name that was actually written", async () => {
  const { publishedImagePath } = await import("../src/manifest/publish.js");

  // Optimisation turns a PNG into a webp. Without the new extension the markup
  // would point at a file that was never written.
  assert.equal(
    publishedImagePath("supafilm", "assets/app_store/01-idea.png", ".webp"),
    "media/supafilm/01-idea.webp",
  );
  // An untouched file keeps its own name.
  assert.equal(
    publishedImagePath("supafilm", "assets/branding/hook.webp"),
    "media/supafilm/hook.webp",
  );
});

test("refreshing never undoes an image the author confirmed", async () => {
  const { mkdtemp, mkdir, writeFile: wf, readFile: rf } = await import("node:fs/promises");
  const { tmpdir } = await import("node:os");
  const { join: j } = await import("node:path");
  const { refreshEntries } = await import("../src/manifest/store.js");

  const projectDir = await mkdtemp(j(tmpdir(), "mb-proj-"));
  await mkdir(j(projectDir, "assets/branding"), { recursive: true });
  await wf(j(projectDir, "package.json"), JSON.stringify({ name: "thing" }));
  await wf(j(projectDir, "assets/branding/hook.webp"), "x".repeat(2048));
  await wf(j(projectDir, "assets/branding/new-shot.webp"), "x".repeat(2048));

  const root = await mkdtemp(j(tmpdir(), "mb-root-"));
  await mkdir(j(root, "projects"), { recursive: true });
  await wf(
    j(root, "projects", "thing.md"),
    [
      "---",
      "id: thing",
      "name: Thing",
      "images:",
      "  - path: assets/branding/hook.webp",
      "    alt: The reading tile",
      "    confirmed: true",
      "source:",
      `  path: ${projectDir}`,
      "---",
      "",
      "## Card",
      "",
      "x",
      "",
    ].join("\n"),
  );

  const { scan } = await import("../src/scan/index.js");
  await refreshEntries(root, scan);

  const after = await rf(j(root, "projects", "thing.md"), "utf8");
  assert.match(after, /alt: The reading tile/, "alt text written by a human survives");
  assert.match(after, /confirmed: true/, "a confirmation is a human decision and must persist");
  assert.match(after, /new-shot\.webp/, "newly discovered candidates are added");
  // The new one arrives unconfirmed: discovery proposes, it never approves.
  const newBlock = after.slice(after.indexOf("new-shot.webp"));
  assert.match(newBlock.slice(0, 120), /confirmed: false/, "new candidates start unconfirmed");
});

test("the wiki names the toolchain, not only the libraries", async () => {
  // Ten of nineteen published projects were Flutter and the page never said
  // so: the rail's facets read `index.frameworks` only, and the facts box
  // showed `ecosystem` solely as a fallback for an empty `frameworks`. A
  // Flutter project that also used Firebase therefore hid the one fact a
  // reader wants first.
  const { buildWikiPayload, renderWiki } = await import("../src/dashboard/wiki.js");

  const projects = [
    {
      id: "flutter-and-firebase",
      name: "Flutter and Firebase",
      visibility: "public",
      kind: "mobile-app",
      ecosystem: ["flutter"],
      frameworks: ["Firebase", "Riverpod"],
      capabilities: ["authentication"],
      patterns: [],
      card: "A Flutter application backed by Firebase.",
      documents: [],
      images: [],
    },
    {
      id: "flutter-only",
      name: "Flutter only",
      visibility: "public",
      kind: "package",
      ecosystem: ["flutter"],
      frameworks: [],
      capabilities: ["asset-generation"],
      patterns: [],
      card: "A Flutter package with no other libraries recorded.",
      documents: [],
      images: [],
    },
  ];

  const bundle = {
    title: "T",
    author: "A",
    projects,
    index: {
      capabilities: {},
      patterns: {},
      // Both projects share the toolchain; the facet needs more than one id.
      ecosystem: { flutter: ["flutter-and-firebase", "flutter-only"] },
      frameworks: { Firebase: ["flutter-and-firebase"] },
    },
  };

  const html = renderWiki(buildWikiPayload(bundle));

  assert.match(html, /Toolchain/, "the facts box and rail label the toolchain");
  assert.match(
    html,
    /"ecosystem"/,
    "the rail's facet list reads the ecosystem index, not only frameworks",
  );
  // The regression itself: a project with frameworks must still carry flutter.
  const payload = buildWikiPayload(bundle);
  const first = payload.projects.find((p) => p.id === "flutter-and-firebase");
  assert.deepEqual(first.ecosystem, ["flutter"], "ecosystem survives into the page payload");
  assert.deepEqual(first.frameworks, ["Firebase", "Riverpod"]);
});

test("the shipped example entry is never published", async () => {
  // It reached a real wiki build: an article about `/path/to/your/project`,
  // sitting among twenty real projects. The example documents the schema; it
  // describes nothing, so it has no place on anyone's public page.
  const { isPublishable } = await import("../src/manifest/publish.js");

  const example = {
    id: "example-project",
    visibility: "public",
    source: { path: "/path/to/your/project" },
  };

  assert.equal(isPublishable(example), false, "even marked public");
  assert.equal(
    isPublishable(example, { includePrivate: true }),
    false,
    "--include-private publishes private *work*, never our placeholder",
  );

  // Recognised by the placeholder path too, so renaming the file is covered.
  assert.equal(
    isPublishable({ id: "my-first-project", visibility: "public", source: { path: "/path/to/your/thing" } }),
    false,
  );

  // And a real project is unaffected.
  assert.equal(
    isPublishable({ id: "real", visibility: "public", source: { path: "/Users/someone/code/real" } }),
    true,
  );
});

test("a written card counts as a card, even with the dossier still empty", async () => {
  // The bug this pins: `narrativeGaps().complete` answers "is the whole
  // write-up done", and using it to ask "is there a card" made twenty-two
  // finished cards report as missing — so `ingest --cards` collected them all
  // again and told the author to write prose that already existed.
  const { hasCard, narrativeGaps } = await import("../src/manifest/store.js");

  const carded = {
    id: "carded",
    _body: [
      "## Card",
      "",
      "A Flutter game in which players cook real meals and a model generates a creature.",
      "",
      "## What it is",
      "",
      "<!-- TODO: write this -->",
      "",
      "## How it works",
      "",
      "<!-- TODO: write this -->",
      "",
    ].join("\n"),
  };

  assert.equal(hasCard(carded), true, "a card with prose is a card");
  assert.equal(
    narrativeGaps(carded).complete,
    false,
    "and the dossier is still unwritten — the two questions are different",
  );
});

test("a placeholder comment is not a card", async () => {
  const { hasCard } = await import("../src/manifest/store.js");

  assert.equal(
    hasCard({ _body: "## Card\n\n<!-- TODO (~120 words): write it -->\n\n## What it is\n" }),
    false,
    "the placeholder the schema ships must not count as written",
  );
  assert.equal(hasCard({ _body: "## Card\n\n   \n\n## What it is\n" }), false, "whitespace is not prose");
  assert.equal(hasCard({ _body: "## What it is\n\ntext\n" }), false, "no Card heading at all");
  assert.equal(hasCard({}), false, "an entry with no body does not throw");
});

test("a fully written entry is both carded and complete", async () => {
  const { hasCard, narrativeGaps } = await import("../src/manifest/store.js");

  const entry = { _body: "## Card\n\nReal prose.\n\n## What it is\n\nAlso real prose.\n" };
  assert.equal(hasCard(entry), true);
  assert.equal(narrativeGaps(entry).complete, true);
});

test("a scoped refresh touches only the entries it was given", async () => {
  // `brain doctor --fix` repairs the entries that drifted. Rewriting the whole
  // catalogue to fix one of them would move the mtime of every other file and
  // rewrite prose-carrying documents that had nothing wrong.
  const { mkdtemp, mkdir, writeFile: wf, readFile: rf, stat } = await import("node:fs/promises");
  const { tmpdir } = await import("node:os");
  const { join: j } = await import("node:path");
  const { refreshEntries } = await import("../src/manifest/store.js");
  const { scan } = await import("../src/scan/index.js");

  const root = await mkdtemp(j(tmpdir(), "mb-scope-"));
  await mkdir(j(root, "projects"), { recursive: true });

  const dirs = {};
  for (const id of ["drifted", "untouched"]) {
    const dir = await mkdtemp(j(tmpdir(), `mb-${id}-`));
    await wf(j(dir, "package.json"), JSON.stringify({ name: id }));
    dirs[id] = dir;
    await wf(
      j(root, "projects", `${id}.md`),
      [
        "---",
        `id: ${id}`,
        `name: ${id}`,
        // A stale framework list: proof that a refresh reached this entry.
        "frameworks:",
        "  - Stale Framework",
        "source:",
        `  path: ${dir}`,
        "---",
        "",
        "## Card",
        "",
        `${id} does a thing.`,
        "",
      ].join("\n"),
    );
  }

  const before = await rf(j(root, "projects", "untouched.md"), "utf8");
  const beforeStat = await stat(j(root, "projects", "untouched.md"));

  const results = await refreshEntries(root, scan, ["drifted"]);

  assert.deepEqual(
    results.refreshed.map((r) => r.id),
    ["drifted"],
    "only the named entry is reported as refreshed",
  );

  const after = await rf(j(root, "projects", "untouched.md"), "utf8");
  assert.equal(after, before, "an entry that was not named is left byte for byte alone");
  const afterStat = await stat(j(root, "projects", "untouched.md"));
  assert.equal(
    afterStat.mtimeMs,
    beforeStat.mtimeMs,
    "and is not even rewritten with identical content",
  );

  // The named one really was refreshed, so the test cannot pass by doing nothing.
  const repaired = await rf(j(root, "projects", "drifted.md"), "utf8");
  assert.doesNotMatch(repaired, /Stale Framework/, "the named entry's machine facts are re-read");
});

test("a refresh with no scope still covers the whole catalogue", async () => {
  // The default must stay unchanged: `brain refresh` means everything.
  const { mkdtemp, mkdir, writeFile: wf } = await import("node:fs/promises");
  const { tmpdir } = await import("node:os");
  const { join: j } = await import("node:path");
  const { refreshEntries } = await import("../src/manifest/store.js");
  const { scan } = await import("../src/scan/index.js");

  const root = await mkdtemp(j(tmpdir(), "mb-all-"));
  await mkdir(j(root, "projects"), { recursive: true });
  for (const id of ["one", "two"]) {
    const dir = await mkdtemp(j(tmpdir(), `mb-${id}-`));
    await wf(j(dir, "package.json"), JSON.stringify({ name: id }));
    await wf(
      j(root, "projects", `${id}.md`),
      ["---", `id: ${id}`, `name: ${id}`, "source:", `  path: ${dir}`, "---", "", "## Card", "", "x", ""].join("\n"),
    );
  }

  const results = await refreshEntries(root, scan);
  assert.deepEqual(results.refreshed.map((r) => r.id).sort(), ["one", "two"]);
});

test("a proposed image is never published until the author confirms it", async () => {
  const { proposeImages, confirmedImages } = await import("../src/scan/images.js");

  const proposed = proposeImages([
    { path: "assets/branding/hook.webp", bytes: 20_000, from: "assets/branding" },
  ]);
  assert.equal(proposed[0].confirmed, false, "discovery proposes, it does not approve");
  assert.deepEqual(confirmedImages(proposed), [], "nothing unconfirmed reaches a consumer");

  // Confirmation is the author's act, after looking at the picture.
  const approved = confirmedImages([
    { path: "assets/branding/hook.webp", alt: "The reading tile over a camera preview", confirmed: true },
    { path: "screenshots/private.png", alt: null, confirmed: false },
    { path: "screenshots/truthy.png", alt: null, confirmed: "yes" },
  ]);
  assert.equal(approved.length, 1, "only an explicit true counts");
  assert.equal(approved[0].path, "assets/branding/hook.webp");
});

test("published image paths carry no repository structure", async () => {
  const { publishedImagePath, redactProject } = await import("../src/manifest/publish.js");

  // A directory name can carry a client name or an internal codename, so the
  // published path is flattened under the project id.
  assert.equal(
    publishedImagePath("supafilm", "assets/clients/acme-internal/hook.webp"),
    "media/supafilm/hook.webp",
  );

  const out = redactProject({
    id: "supafilm",
    visibility: "public",
    source: { path: "/Users/someone/code/supafilm" },
    images: [{ path: "assets/branding/hook.webp", alt: "Reading tile over the camera" }],
  });

  assert.deepEqual(out.images, [
    { src: "media/supafilm/hook.webp", alt: "Reading tile over the camera" },
  ]);
  assert.ok(!JSON.stringify(out).includes("assets/branding"), "no repository path in the output");
});

// --- the agent-file hook -----------------------------------------------------

test("hook writes only into agent files the developer already keeps", async () => {
  const { mkdtemp, writeFile: wf, readFile: rf, readdir } = await import("node:fs/promises");
  const { tmpdir } = await import("node:os");
  const { join: j } = await import("node:path");
  const { execFile } = await import("node:child_process");
  const { promisify } = await import("node:util");
  const run = promisify(execFile);

  const cli = "/Volumes/CORSAIR/MOTHER_BRAIN/bin/brain.js";
  const project = await mkdtemp(j(tmpdir(), "mb-hook-"));
  await wf(j(project, "CLAUDE.md"), "# My rules\n\nExisting content the author wrote.\n");

  const first = await run("node", [cli, "hook", project], { env: { ...process.env } });
  assert.match(first.stdout, /CLAUDE\.md/);

  const after = await rf(j(project, "CLAUDE.md"), "utf8");
  assert.match(after, /Existing content the author wrote/, "their content is preserved");
  assert.match(after, /<!-- motherbrain -->/, "the block is marked");
  assert.match(after, /<!-- \/motherbrain -->/, "and closed with a matching marker");
  assert.match(after, /brain add/, "it tells the agent what to run");
  assert.match(after, /Describe, do not assess/, "and carries the rule that protects the data");

  // Running it twice must not duplicate the block.
  const second = await run("node", [cli, "hook", project], { env: { ...process.env } });
  assert.match(second.stdout, /already hooked/);
  const twice = await rf(j(project, "CLAUDE.md"), "utf8");
  assert.equal(
    twice.split("<!-- motherbrain -->").length - 1,
    1,
    "the marker makes a second run a no-op",
  );

  // A project with no agent file gets a refusal, not a file it never asked for.
  const bare = await mkdtemp(j(tmpdir(), "mb-hook-bare-"));
  await assert.rejects(
    () => run("node", [cli, "hook", bare], { env: { ...process.env } }),
    /./,
    "it exits non-zero rather than creating a file",
  );
  assert.deepEqual(await readdir(bare), [], "and writes nothing");
});

// --- terminal presentation ---------------------------------------------------

test("the banner degrades instead of breaking", async () => {
  const { banner, mark, rule, bar } = await import("../src/ui/brand.js");

  const original = process.stdout.columns;
  try {
    // A wide terminal gets the full wordmark.
    process.stdout.columns = 100;
    const wide = banner({ version: "1.2.3" });
    assert.ok(wide.some((l) => l.includes("███")), "the wordmark is drawn when there is room");
    assert.ok(wide.some((l) => l.includes("v1.2.3")), "the version is shown");

    // A narrow one gets a compact mark: a wrapped wordmark is worse than none.
    process.stdout.columns = 40;
    const narrow = banner();
    assert.ok(!narrow.some((l) => l.includes("███")), "no wordmark in a narrow terminal");
    assert.ok(narrow.some((l) => l.includes("MOTHER BRAIN")), "but it still says what it is");
    for (const line of narrow) {
      // Escape sequences do not occupy columns, so measure the visible text.
      const visible = line.replace(/\[[0-9;]*m/g, "");
      assert.ok(visible.length <= 40, `line overflows a 40-column terminal: ${visible.length}`);
    }

    // Under test, stdout is not a TTY, so paint() should already be returning
    // plain text — this is what makes piping to a file safe.
    assert.ok(
      !banner({ version: "1.0.0" }).join("\n").includes("["),
      "no escape codes when stdout is not a terminal",
    );
    assert.ok(!mark().includes("["));
    assert.ok(!rule("x").join("").includes("["));
    assert.ok(!bar(1, 2).includes("["));

    // The bar is still readable without colour: filled and empty differ.
    assert.equal(bar(0, 10, 10), "░".repeat(10));
    assert.equal(bar(10, 10, 10), "█".repeat(10));
    assert.equal(bar(5, 10, 10), "█".repeat(5) + "░".repeat(5));
    assert.equal(bar(1, 0, 10), "░".repeat(10), "an empty brain must not divide by zero");
  } finally {
    process.stdout.columns = original;
  }
});

// --- the card pass -----------------------------------------------------------

test("the card briefing is small enough to cover every project at once", async () => {
  const { mkdtemp, mkdir, writeFile: wf } = await import("node:fs/promises");
  const { tmpdir } = await import("node:os");
  const { join: j } = await import("node:path");
  const { collectCardBrief, renderCardBatch } = await import("../src/ingest/cards.js");

  // Two projects, one documented and one bare — the usual mix on a real disk.
  const a = await mkdtemp(j(tmpdir(), "mb-card-a-"));
  await mkdir(j(a, "lib", "screens"), { recursive: true });
  await wf(j(a, "pubspec.yaml"), "name: thing\ndependencies:\n  flutter:\n    sdk: flutter\n  firebase_core: ^2.0.0\n  riverpod: ^2.0.0\n");
  await wf(j(a, "README.md"), "# Thing\n\nWhat the author actually says it does.\n");

  const b = await mkdtemp(j(tmpdir(), "mb-card-b-"));
  await wf(j(b, "package.json"), JSON.stringify({ name: "bare", dependencies: { next: "15" } }));

  const briefs = [
    await collectCardBrief({
      id: "thing",
      name: "Thing",
      kind: "mobile-app",
      ecosystem: ["flutter"],
      frameworks: ["Firebase"],
      documents: [{ path: "README.md" }],
      source: { path: a, deploy: [], commits: 12 },
    }),
    await collectCardBrief({
      id: "bare",
      name: "Bare",
      kind: "web-app",
      ecosystem: ["node"],
      frameworks: ["Next.js"],
      documents: [],
      source: { path: b, deploy: [], commits: 1 },
    }),
  ];

  const doc = renderCardBatch(briefs);

  // The author's own words travel; the deep-briefing sections do not.
  assert.match(doc, /What the author actually says it does/);
  assert.match(doc, /firebase_core/, "dependencies help decide what a project is");
  assert.ok(!doc.includes("Largest source files"), "the card pass skips the deep material");
  assert.ok(!doc.includes("Recent commit subjects"), "and skips the commit log");

  // A project with nothing to read is named as such rather than skipped.
  assert.match(doc, /No documentation in this project/);

  // The instruction is a card, explicitly not a dossier.
  assert.match(doc, /under 120 words/i);
  assert.match(doc, /narrative_status: card/);
  assert.match(doc, /Leave the dossier sections as they are/);

  // A shared vocabulary list, so twenty cards do not invent twenty synonyms.
  assert.match(doc, /Vocabulary already in use/);
  assert.match(doc, /two-pass-llm/);

  // And the rule that protects the data.
  assert.match(doc, /Never invent/);
});

test("a missing project path is reported, not thrown", async () => {
  const { collectCardBrief } = await import("../src/ingest/cards.js");

  const brief = await collectCardBrief({
    id: "gone",
    name: "Gone",
    documents: [],
    source: { path: "/nowhere/at/all" },
  });

  assert.equal(brief.missing, true, "an unmounted disk must not abort the batch");

  const { renderCardBatch } = await import("../src/ingest/cards.js");
  const doc = renderCardBatch([brief]);
  assert.match(doc, /Paths that no longer exist/);
  assert.match(doc, /gone/);
});

// --- the published encyclopedia ----------------------------------------------

test("every generated page is syntactically valid, inline script included", async () => {
  const { renderWiki, buildWikiPayload } = await import("../src/dashboard/wiki.js");
  const { renderPickPage, buildPickPayload } = await import("../src/dashboard/pick.js");
  const { renderDashboard } = await import("../src/dashboard/render.js");

  // Both page renderers build HTML inside a JS template literal, which makes
  // two mistakes easy and invisible: a backtick in a CSS comment closes the
  // template early, and a literal U+2028/U+2029 terminates a regex. Both have
  // happened here. Parsing the emitted script is what catches them.
  const project = {
    id: "a",
    name: "A",
    frameworks: [],
    ecosystem: [],
    capabilities: [],
    patterns: [],
    tags: [],
    relates_to: [],
    links: {},
    card: "**Bold** and `code`.",
    images: [],
    documents: [],
    source: {},
    narrative: { status: "missing", complete: false, todos: 1, sections: {}, text: "" },
    dossier: { status: "missing", complete: false, sections: {} },
    metrics: {},
    highlights: [],
  };

  const pages = {
    wiki: renderWiki(
      buildWikiPayload(
        { title: "T", generated: new Date().toISOString(), counts: {}, index: {}, projects: [project] },
        new Map(),
      ),
    ),
    pick: renderPickPage(
      buildPickPayload([{ path: "/d/a", name: "A", depth: 0, ecosystems: ["node"], frameworks: [], docs: [], deploy: [], git: {} }], { roots: ["/d"] }),
    ),
    dashboard: await renderDashboard({
      version: 2,
      generated: new Date().toISOString(),
      counts: { projects: 1, carded: 0, documented: 0, public: 0, shipped: 0 },
      index: { frameworks: {}, ecosystem: {} },
      projects: [project],
    }),
  };

  for (const [name, html] of Object.entries(pages)) {
    const scripts = [...html.matchAll(/<script(?![^>]*type="application\/json")[^>]*>([\s\S]*?)<\/script>/g)];
    assert.ok(scripts.length > 0, `${name}: expected an inline script`);
    for (const [, body] of scripts) {
      assert.doesNotThrow(
        () => new Function(body),
        `${name}: inline script does not parse`,
      );
    }
    // A stray U+2028/U+2029 in source would have terminated a regex literal.
    assert.ok(!/[\u2028\u2029]/.test(html), `${name}: raw line separator in output`);
  }
});

test("the wiki renders articles and never leaks a path or a prompt", async () => {
  const { buildWikiPayload, renderWiki } = await import("../src/dashboard/wiki.js");

  const bundle = {
    title: "Someone — Project Brain",
    author: "Someone",
    generated: "2026-09-15T00:00:00.000Z",
    counts: { projects: 2, documented: 1 },
    index: { frameworks: { React: ["a", "b"] }, capabilities: {}, patterns: {} },
    projects: [
      {
        id: "a",
        name: "Alpha",
        tagline: "Does a thing",
        kind: "web-app",
        status: "shipped",
        frameworks: ["React"],
        ecosystem: ["node"],
        capabilities: ["asset-generation"],
        patterns: [],
        tags: [],
        relates_to: ["b"],
        links: { repo: "https://github.com/me/a", site: null, demo: null, docs: null },
        card: "A short standalone summary.",
        source: {},
      },
      {
        id: "b",
        name: "Beta",
        kind: "cli",
        frameworks: ["React"],
        ecosystem: ["node"],
        capabilities: [],
        patterns: [],
        tags: [],
        relates_to: [],
        links: {},
        card: null,
        source: {},
      },
    ],
  };

  const dossiers = new Map([
    ["a", { dossier: { sections: { Architecture: "One paragraph.\n\nAnd another." } } }],
  ]);

  const payload = buildWikiPayload(bundle, dossiers);
  assert.equal(payload.projects[0].sections.Architecture, "One paragraph.\n\nAnd another.");
  assert.deepEqual(payload.projects[1].sections, {}, "a project with no dossier still appears");

  const html = renderWiki(payload);

  assert.match(html, /Someone — Project Brain/);
  assert.ok(html.includes("wiki-data"), "the payload is inlined");
  assert.ok(!/\bfetch\(|XMLHttpRequest|WebSocket/.test(html), "a static page makes no requests");
  assert.match(html, /prefers-color-scheme/, "it respects the reader's theme");
  assert.ok(!html.includes("TODO"), "no writing scaffolding reaches the page");

  // A project name is arbitrary filesystem text; inlining it unescaped would
  // let it break out of the data island.
  const hostile = renderWiki(
    buildWikiPayload(
      { ...bundle, projects: [{ ...bundle.projects[0], name: "</script><img src=x onerror=alert(1)>" }] },
      new Map(),
    ),
  );
  assert.ok(!hostile.includes("</script><img"), "the raw tag must never appear");
});

// --- ingest briefing ---------------------------------------------------------

test("collectBrief gathers the material a writer needs, mechanically", async () => {
  const { mkdtemp, mkdir, writeFile: wf } = await import("node:fs/promises");
  const { tmpdir } = await import("node:os");
  const { join: j } = await import("node:path");
  const { collectBrief, renderBrief } = await import("../src/ingest/brief.js");

  const dir = await mkdtemp(j(tmpdir(), "mb-brief-"));
  await mkdir(j(dir, "src"), { recursive: true });
  await mkdir(j(dir, "node_modules", "junk"), { recursive: true });
  await wf(j(dir, "package.json"), JSON.stringify({ name: "thing", scripts: { dev: "vite" } }));
  await wf(j(dir, "README.md"), "# Thing\n\nWhat the author actually said about it.\n");
  await wf(j(dir, "src", "index.ts"), "export const main = () => {};\n".repeat(50));
  await wf(j(dir, "src", "schema.prisma"), "model User { id Int @id }\n");
  await wf(j(dir, "node_modules", "junk", "index.js"), "should never be collected\n");

  const brief = await collectBrief({
    id: "thing",
    name: "Thing",
    kind: "tool",
    ecosystem: ["node"],
    frameworks: ["Vite"],
    source: { path: dir, docs: ["README.md"], git: false, deploy: [] },
  });

  assert.ok(brief.entry_points.some((p) => p.endsWith("index.ts")), "finds entry points");
  assert.ok(brief.domain_model.some((p) => p.endsWith("schema.prisma")), "finds the data model");
  assert.ok(brief.largest_source_files.length > 0, "points at where the substance is");
  assert.deepEqual(brief.scripts, { dev: "vite" }, "records how the project is run");
  assert.equal(brief.docs[0].file, "README.md");
  assert.match(brief.docs[0].text, /What the author actually said/);
  assert.ok(
    !JSON.stringify(brief).includes("should never be collected"),
    "dependency trees are not part of the briefing",
  );

  const rendered = renderBrief(brief);
  assert.match(rendered, /^# Ingest briefing: Thing/m);
  assert.match(rendered, /Never invent/, "the briefing carries the rule that protects the data");
  assert.match(rendered, /map, not a substitute/, "it says what it is");
  assert.match(
    rendered,
    /Describe, do not assess/,
    "the briefing must tell a writer to report facts, not to evaluate the work",
  );
});

// --- picking page -----------------------------------------------------------

test("buildPickPayload checks whole projects and leaves parts alone", () => {
  const payload = buildPickPayload(
    [
      { path: "/d/app", name: "mythika", depth: 0, role: "project", ecosystems: ["flutter"], frameworks: ["Firebase"], docs: [], deploy: [], git: { isRepo: true } },
      { path: "/d/app/android", name: "android", depth: 1, role: "platform", ecosystems: ["kotlin"], frameworks: [], docs: [], deploy: [], git: { isRepo: true } },
      { path: "/d/old", name: "old", depth: 0, role: "project", ecosystems: ["node"], frameworks: [], docs: [], deploy: [], git: {} },
    ],
    { roots: ["/d"], known: new Set(["/d/old"]) },
  );

  assert.equal(payload.rows.length, 3, "every folder reaches the page");
  assert.equal(payload.rows[0].checked, true, "a whole project starts checked");
  assert.equal(payload.rows[1].checked, false, "its internal part does not");
  assert.equal(payload.rows[2].checked, false, "one already catalogued does not");
  assert.equal(payload.rows[2].known, true);
  assert.equal(payload.rows[0].relative, "app", "paths are shown relative to the scan root");
});

test("the picking page cannot be broken out of by a folder name", () => {
  // Folder names are attacker-controlled in the sense that they are arbitrary
  // text from the filesystem; inlining one unescaped would end the script tag.
  const payload = buildPickPayload(
    [
      {
        path: "/d/x",
        name: '</script><img src=x onerror=alert(1)>',
        depth: 0,
        role: "project",
        ecosystems: ["node"],
        frameworks: [],
        docs: [],
        deploy: [],
        git: {},
      },
    ],
    { roots: ["/d"] },
  );

  const html = renderPickPage(payload);
  assert.ok(!html.includes("</script><img"), "the raw tag must never appear");
  assert.ok(html.includes("\\u003c/script"), "it should be escaped inside the JSON payload");
});

test("the picking page ships the data it needs and no server", () => {
  const html = renderPickPage(
    buildPickPayload(
      [{ path: "/d/a", name: "a", depth: 0, ecosystems: ["node"], frameworks: [], docs: [], deploy: [], git: {} }],
      { roots: ["/d"] },
    ),
  );

  assert.ok(html.includes('id="pick-data"'), "the payload is inlined");
  assert.ok(html.includes("prefers-color-scheme"), "it respects the viewer's theme");
  assert.ok(!/\bfetch\(|XMLHttpRequest|WebSocket/.test(html), "it must not talk to a server");
  assert.ok(html.includes("brain add "), "it hands back a command to run");
});

test("slugify produces filename-safe ids", () => {
  assert.equal(slugify("Tu Turno — Club v1"), "tu-turno-club-v1");
  assert.equal(slugify("@scope/pkg"), "scope-pkg");
  assert.equal(slugify(""), "project");
});

test("parseRemote handles ssh and https", () => {
  assert.deepEqual(parseRemote("git@github.com:me/repo.git"), {
    host: "github.com",
    slug: "me/repo",
    url: "https://github.com/me/repo",
  });
  assert.equal(parseRemote("https://github.com/me/repo.git").url, "https://github.com/me/repo");
  assert.equal(parseRemote(null), null);
});
