/**
 * Query, doctor and deploy detection.
 *
 * These three are the "ask the brain things" surface, and each has a rule that
 * is easy to break by accident: filters must AND rather than OR, doctor must
 * never report the shipped example entry, and every deploy URL must arrive as
 * a candidate rather than a fact.
 */

import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, writeFile, mkdir } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { query, facetValues, FILTERS, TOGGLES } from "../src/manifest/query.js";
import { diagnose, summarise, refreshable } from "../src/manifest/doctor.js";
import { findSites } from "../src/scan/deploy.js";

const PROJECTS = [
  {
    id: "alpha",
    name: "Alpha",
    kind: "web app",
    status: "shipped",
    visibility: "public",
    domain: "media",
    architecture: "serverless workers",
    last_active: "2026-09-01",
    started: "2025-01-01",
    frameworks: ["Next.js", "Tailwind CSS"],
    ecosystem: ["node"],
    capabilities: ["video export"],
    patterns: ["queue worker"],
    tags: ["video"],
    card: "Alpha renders timelines in the browser.",
    links: { repo: "https://github.com/x/alpha", site: "https://alpha.app" },
    images: [{ path: "a.png", confirmed: true }],
    dossier: { complete: true, sections: { Overview: "Local rendering." } },
    documents: [{ path: "README.md", summary: "How to run it." }],
    relates_to: ["beta"],
  },
  {
    id: "beta",
    name: "Beta",
    kind: "cli",
    status: "prototype",
    visibility: "private",
    domain: "tooling",
    last_active: "2026-05-01",
    started: "2026-02-01",
    frameworks: ["Next.js"],
    ecosystem: ["node"],
    capabilities: [],
    patterns: [],
    tags: [],
    card: "",
    links: {},
    images: [],
    dossier: { complete: false },
    documents: [],
  },
  {
    id: "gamma",
    name: "Gamma",
    kind: "mobile app",
    status: "shipped",
    visibility: "public",
    domain: "media",
    last_active: "2026-07-01",
    started: "2024-06-01",
    frameworks: ["Flutter"],
    ecosystem: ["dart"],
    capabilities: ["video export"],
    patterns: [],
    tags: [],
    card: "Gamma is a phone client.",
    links: { repo: "https://github.com/x/gamma" },
    images: [],
    dossier: { complete: true, sections: {} },
    documents: [],
  },
];

// --- query -------------------------------------------------------------

test("a single filter selects by list membership", () => {
  const { results } = query(PROJECTS, { filters: { framework: "Next.js" } });
  assert.deepEqual(results.map((p) => p.id), ["alpha", "beta"]);
});

test("filter values ignore case, dots and dashes", () => {
  for (const spelling of ["nextjs", "next.js", "NEXT-JS", "Next.js"]) {
    const { results } = query(PROJECTS, { filters: { framework: spelling } });
    assert.equal(results.length, 2, `failed for ${spelling}`);
  }
});

test("two filters are AND-ed, not OR-ed", () => {
  const { results } = query(PROJECTS, {
    filters: { framework: "Next.js", status: "shipped" },
  });
  assert.deepEqual(results.map((p) => p.id), ["alpha"]);
});

test("a filter and a toggle combine", () => {
  const { results } = query(PROJECTS, {
    filters: { capability: "video export" },
    toggles: ["public"],
  });
  assert.deepEqual(results.map((p) => p.id), ["alpha", "gamma"]);
});

test("toggles select on presence", () => {
  assert.deepEqual(
    query(PROJECTS, { toggles: ["no-card"] }).results.map((p) => p.id),
    ["beta"],
  );
  assert.deepEqual(
    query(PROJECTS, { toggles: ["has-dossier"] }).results.map((p) => p.id),
    ["alpha", "gamma"],
  );
  assert.deepEqual(
    query(PROJECTS, { toggles: ["has-site"] }).results.map((p) => p.id),
    ["alpha"],
  );
});

test("free text reaches the card and the dossier, not just the tags", () => {
  // "timelines" appears only in alpha's card.
  assert.deepEqual(
    query(PROJECTS, { text: "timelines" }).results.map((p) => p.id),
    ["alpha"],
  );
  // "local rendering" appears only inside the dossier prose.
  assert.deepEqual(
    query(PROJECTS, { text: "local rendering" }).results.map((p) => p.id),
    ["alpha"],
  );
});

test("architecture matches a substring, since authors phrase it freely", () => {
  const { results } = query(PROJECTS, { filters: { architecture: "serverless" } });
  assert.deepEqual(results.map((p) => p.id), ["alpha"]);
});

test("an unknown filter is reported rather than silently ignored", () => {
  const { results, unknown } = query(PROJECTS, { filters: { colour: "blue" } });
  assert.deepEqual(unknown, ["--colour"]);
  // The catalogue is not narrowed by a filter that does not exist.
  assert.equal(results.length, PROJECTS.length);
});

test("results default to most recently active first", () => {
  assert.deepEqual(
    query(PROJECTS, {}).results.map((p) => p.id),
    ["alpha", "gamma", "beta"],
  );
});

test("sorting by name and by start date", () => {
  assert.deepEqual(
    query(PROJECTS, { sort: "name" }).results.map((p) => p.id),
    ["alpha", "beta", "gamma"],
  );
  assert.deepEqual(
    query(PROJECTS, { sort: "started" }).results.map((p) => p.id),
    ["gamma", "alpha", "beta"],
  );
});

test("limit truncates after sorting", () => {
  const { results } = query(PROJECTS, { sort: "name", limit: 2 });
  assert.deepEqual(results.map((p) => p.id), ["alpha", "beta"]);
});

test("query does not mutate the projects it was handed", () => {
  const order = PROJECTS.map((p) => p.id);
  query(PROJECTS, { sort: "name" });
  assert.deepEqual(PROJECTS.map((p) => p.id), order);
});

test("applied describes what actually narrowed the result", () => {
  const { applied } = query(PROJECTS, {
    filters: { framework: "Next.js" },
    toggles: ["public"],
    text: "timelines",
  });
  assert.deepEqual(applied, ["framework=Next.js", "--public", '"timelines"']);
});

test("every filter and toggle is callable", () => {
  // Guards against a table entry that is not a function of the documented shape.
  for (const [name, factory] of Object.entries(FILTERS)) {
    assert.equal(typeof factory("x"), "function", `${name} must build a predicate`);
    assert.equal(typeof factory("x")(PROJECTS[0]), "boolean", `${name} must return a boolean`);
  }
  for (const [name, predicate] of Object.entries(TOGGLES)) {
    assert.equal(typeof predicate(PROJECTS[0]), "boolean", `${name} must return a boolean`);
  }
});

test("facetValues reports what exists, most common first", () => {
  assert.deepEqual(facetValues(PROJECTS, "framework"), [
    { value: "Next.js", count: 2 },
    { value: "Flutter", count: 1 },
    { value: "Tailwind CSS", count: 1 },
  ]);
  assert.deepEqual(facetValues(PROJECTS, "nonsense"), []);
});

// --- doctor ------------------------------------------------------------

test("doctor reports an entry whose path no longer resolves", async () => {
  const findings = await diagnose([
    { id: "moved", source: { path: "/definitely/not/here" }, _body: "## Card\ntext\n" },
  ]);
  const dead = findings.find((f) => f.problem.startsWith("path does not resolve"));
  assert.equal(dead.severity, "error");
  assert.equal(dead.id, "moved");
  assert.match(dead.fix, /source\.path/);
});

test("doctor stays silent about the shipped example entry", async () => {
  // A developer's first `brain doctor` must not open with an error of ours.
  const findings = await diagnose([
    { id: "example-project", source: { path: "/path/to/your/project" }, _body: "" },
  ]);
  assert.deepEqual(findings, []);
});

test("doctor recognises the example by its placeholder path, not only its id", async () => {
  const findings = await diagnose([
    { id: "renamed-example", source: { path: "/path/to/your/thing" }, _body: "" },
  ]);
  assert.deepEqual(findings, []);
});

test("doctor flags an entry with no source path at all", async () => {
  const findings = await diagnose([{ id: "orphan", _body: "## Card\ntext\n" }]);
  assert.equal(findings.length, 1);
  assert.equal(findings[0].severity, "error");
  assert.equal(findings[0].problem, "no source path recorded");
});

test("doctor finds missing documents and images, and an empty card", async () => {
  const root = await mkdtemp(join(tmpdir(), "brain-doctor-"));
  const findings = await diagnose([
    {
      id: "drifted",
      source: { path: root },
      documents: [{ path: "GONE.md" }],
      images: [
        { path: "missing.png", confirmed: true },
        { path: "proposed.png", confirmed: false },
      ],
      // The card placeholder is a comment, so the card counts as unwritten.
      _body: "## Card\n\n<!-- TODO (~120 words): write it -->\n\n## Overview\n",
    },
  ]);

  const problems = findings.map((f) => f.problem);
  assert.ok(problems.some((p) => p.includes("document is missing: GONE.md")));
  assert.ok(problems.some((p) => p.includes("confirmed image is missing: missing.png")));
  assert.ok(problems.some((p) => p.includes("no card")));
  // The unconfirmed image is a note for the author, not a failure.
  const proposal = findings.find((f) => f.problem.includes("unreviewed"));
  assert.equal(proposal.severity, "note");
});

test("doctor notes a deploy configuration with nowhere to point", async () => {
  const root = await mkdtemp(join(tmpdir(), "brain-doctor-"));
  const findings = await diagnose([
    {
      id: "shipped",
      source: { path: root, deploy: ["firebase"] },
      links: {},
      _body: "## Card\nA real card.\n",
    },
  ]);
  const note = findings.find((f) => f.problem.includes("no site link"));
  assert.equal(note.severity, "note");
  assert.match(note.fix, /brain sites/);
});

test("doctor says nothing about a healthy entry", async () => {
  const root = await mkdtemp(join(tmpdir(), "brain-healthy-"));
  await writeFile(join(root, "README.md"), "# hi\n");
  const findings = await diagnose([
    {
      id: "fine",
      source: { path: root },
      documents: [{ path: "README.md", summary: "Run instructions." }],
      images: [],
      links: { site: "https://fine.app" },
      _body: "## Card\nA card that is actually written.\n",
    },
  ]);
  assert.deepEqual(findings, []);
});

test("findings lead with severity, so errors are never buried", async () => {
  const root = await mkdtemp(join(tmpdir(), "brain-order-"));
  const findings = await diagnose([
    { id: "zeta", source: { path: root }, images: [{ path: "p.png" }], _body: "## Card\nok\n" },
    { id: "alpha", source: { path: "/gone" }, _body: "## Card\nok\n" },
  ]);
  assert.equal(findings[0].severity, "error");

  const counts = summarise(findings);
  assert.equal(counts.error, 1);
  assert.equal(counts.note, 1);
});

test("refreshable lists each affected id once", () => {
  const ids = refreshable([
    { id: "a", fixable: "refresh" },
    { id: "a", fixable: "refresh" },
    { id: "b" },
  ]);
  assert.deepEqual(ids, ["a"]);
});

// --- deploy detection --------------------------------------------------

async function project(files) {
  const root = await mkdtemp(join(tmpdir(), "brain-sites-"));
  for (const [name, body] of Object.entries(files)) {
    const path = join(root, name);
    if (name.includes("/")) await mkdir(join(path, ".."), { recursive: true });
    await writeFile(path, body);
  }
  return root;
}

test("a homepage field is read as a high-confidence candidate", async () => {
  const root = await project({
    "package.json": JSON.stringify({ homepage: "https://alpha.app/" }),
  });
  const [site] = await findSites(root);
  // The trailing slash is normalised away.
  assert.equal(site.url, "https://alpha.app");
  assert.equal(site.confidence, "high");
  assert.match(site.source, /homepage/);
});

test("an npm readme homepage is not a deployed site", async () => {
  const root = await project({
    "package.json": JSON.stringify({ homepage: "https://github.com/x/y#readme" }),
  });
  assert.deepEqual(await findSites(root), []);
});

test("placeholder and localhost URLs are noise, not findings", async () => {
  for (const homepage of [
    "http://localhost:3000",
    "https://example.com",
    "https://your-site.com",
  ]) {
    const root = await project({ "package.json": JSON.stringify({ homepage }) });
    assert.deepEqual(await findSites(root), [], `${homepage} should be ignored`);
  }
});

test("wrangler routes are read from toml and jsonc alike", async () => {
  const toml = await project({ "wrangler.toml": 'pattern = "app.example.dev/*"\n' });
  assert.equal((await findSites(toml))[0].url, "https://app.example.dev");

  const jsonc = await project({
    "wrangler.jsonc": '{ "routes": [{ "pattern": "*.invitta.app/*" }] }',
  });
  const [site] = await findSites(jsonc);
  assert.equal(site.url, "https://invitta.app");
  assert.equal(site.confidence, "medium");
});

test("a vercel alias outranks a guessed vercel subdomain", async () => {
  const root = await project({
    "vercel.json": JSON.stringify({ alias: ["beta.app"], name: "beta" }),
  });
  const sites = await findSites(root);
  assert.equal(sites[0].url, "https://beta.app");
  assert.equal(sites[0].confidence, "high");
  // The guess is still offered, but ranked last.
  assert.equal(sites.at(-1).confidence, "low");
});

test("firebase site ids and default projects imply web.app addresses", async () => {
  const root = await project({
    "firebase.json": JSON.stringify({ hosting: { site: "gamma" } }),
    ".firebaserc": JSON.stringify({ projects: { default: "gamma-1234" } }),
  });
  const urls = (await findSites(root)).map((s) => s.url);
  assert.ok(urls.includes("https://gamma.web.app"));
  assert.ok(urls.includes("https://gamma-1234.web.app"));
});

test("a CNAME file is the custom domain GitHub Pages serves", async () => {
  const root = await project({ "public/CNAME": "docs.example.dev\n" });
  const [site] = await findSites(root);
  assert.equal(site.url, "https://docs.example.dev");
  assert.equal(site.confidence, "high");
});

test("the same URL from two sources is reported once, at its best confidence", async () => {
  const root = await project({
    "package.json": JSON.stringify({ homepage: "https://delta.app" }),
    "CNAME": "delta.app\n",
  });
  const sites = await findSites(root);
  assert.equal(sites.length, 1);
  assert.equal(sites[0].confidence, "high");
});

test("malformed configuration is skipped, not thrown", async () => {
  const root = await project({
    "package.json": "{ not json",
    "vercel.json": "{{{",
    "firebase.json": "nope",
  });
  assert.deepEqual(await findSites(root), []);
});

test("a project with no deploy configuration yields nothing", async () => {
  const root = await project({ "README.md": "# hi\n" });
  assert.deepEqual(await findSites(root), []);
});

test("every candidate carries its provenance", async () => {
  const root = await project({
    "package.json": JSON.stringify({ homepage: "https://eps.app" }),
    ".firebaserc": JSON.stringify({ projects: { default: "eps" } }),
  });
  for (const site of await findSites(root)) {
    // Nothing is written without the author seeing where it came from.
    assert.ok(site.source, "a candidate must say where it was found");
    assert.ok(["high", "medium", "low"].includes(site.confidence));
  }
});
