<div align="center">

<img src="assets/motherbrain.png" alt="Mother Brain" width="420">

```
███╗   ███╗  ██████╗  ████████╗ ██╗  ██╗ ███████╗ ██████╗
████╗ ████║ ██╔═══██╗ ╚══██╔══╝ ██║  ██║ ██╔════╝ ██╔══██╗
██╔████╔██║ ██║   ██║    ██║    ███████║ █████╗   ██████╔╝
██║╚██╔╝██║ ██║   ██║    ██║    ██╔══██║ ██╔══╝   ██╔══██╗
██║ ╚═╝ ██║ ╚██████╔╝    ██║    ██║  ██║ ███████╗ ██║  ██║
╚═╝     ╚═╝  ╚═════╝     ╚═╝    ╚═╝  ╚═╝ ╚══════╝ ╚═╝  ╚═╝
                 ██████╗  ██████╗   █████╗  ██╗ ███╗   ██╗
                 ██╔══██╗ ██╔══██╗ ██╔══██╗ ██║ ████╗  ██║
                 ██████╔╝ ██████╔╝ ███████║ ██║ ██╔██╗ ██║
                 ██╔══██╗ ██╔══██╗ ██╔══██║ ██║ ██║╚██╗██║
                 ██████╔╝ ██║  ██║ ██║  ██║ ██║ ██║ ╚████║
                 ╚═════╝  ╚═╝  ╚═╝ ╚═╝  ╚═╝ ╚═╝ ╚═╝  ╚═══╝
```

**A local, agent-ready encyclopedia of everything you have ever built.**

Point it at your disk. Get back a catalog you can read, git can version,
an agent can query, and anyone can visit as a URL.

*Zero dependencies · Files on disk · Nothing leaves your machine unless you say so*

</div>

---

## The problem

You have a disk full of projects. Some shipped, some died, some you cannot
remember the point of.

The code is all there. What is missing is what each project **was** — the
problem it solved, how it works, what it runs on, whether anyone used it. That
lives in your head, and your head is not queryable.

So when you need a CV, a portfolio, an article about that pipeline you built, or
just an honest answer to *"what have I actually made?"* — you go spelunking
through folders, reading your own code like a stranger.

## What this does

```
your disk                  Mother Brain                  what you get
─────────                  ────────────                  ────────────
~/code/supacut      →      projects/supacut.md     →     brain.json    → agents, n8n, ChatGPT
~/code/invitta      →      projects/invitta.md     →     index.html    → a shareable wiki
/Volumes/DISK/app   →      projects/app.md         →     api/*.json    → per-project dossiers
```

One Markdown file per project: **YAML frontmatter** for filtering, **prose** for
what a CV or an article actually needs. It never moves, modifies, or uploads
your repositories — it records what they are.

---

## Quick start

```bash
git clone https://github.com/YOUR_USER/motherbrain.git
cd motherbrain && npm link      # gives you the `brain` command

brain init                      # point it at your project directories
brain pick                      # tick what belongs, in your browser
brain ingest --cards            # one briefing covering every project
#   ↳ hand it to your coding agent with skill/SKILL.md
brain publish --out public/     # a wiki + an API, as static files
```

Needs **Node 20+**. No `node_modules`. Clone it in five years and it still runs.

At any point, `brain status` tells you where you are and what to run next:

```
25 projects catalogued

  cards      ████████████████████████  25/25
  dossiers   ███░░░░░░░░░░░░░░░░░░░░░  3/25

19 marked public — those are what `brain publish` includes.
```

---

## How it finds your projects

Projects are not one level down. On a real disk they are buried in grouping
folders, monorepos and client directories. So the scanner looks for **ecosystem
markers** — files that only exist at the root of a real project.

| Ecosystem | Detected by |
| --- | --- |
| Node · Deno · Bun | `package.json`, `deno.json`, `bun.lockb` |
| Flutter · Dart | `pubspec.yaml` *(split by whether the Flutter SDK is used)* |
| Python | `pyproject.toml`, `requirements.txt`, `Pipfile`, `setup.py` |
| Go · Rust | `go.mod`, `Cargo.toml` |
| PHP · WordPress | `composer.json`, `wp-config.php`, theme/plugin headers |
| Ruby · Java · Kotlin · Swift · .NET · Elixir | `Gemfile`, `pom.xml`, `build.gradle`, `Package.swift`, `*.csproj`, `mix.exs` |
| Godot · Unreal | `project.godot`, `*.uproject` |

Then it reads what is inside to name the **frameworks** — preferring config
files over dependencies, because a `next.config.ts` is stronger evidence than a
transitive `next` in a lockfile.

> Next.js · Nuxt · Astro · SvelteKit · Remix · Angular · React · Vue · Svelte ·
> Expo · React Native · Electron · Tauri · Vite · Tailwind · Express · Fastify ·
> NestJS · FastAPI · Django · Laravel · Rails · Prisma · Drizzle · Payload ·
> Firebase · Supabase · PostgreSQL · GraphQL · Zustand · Redux · Riverpod ·
> Bloc · Three.js · GSAP · Remotion · OpenAI · Anthropic · Stripe · Playwright…

### Structure is shown, not hidden

A Flutter app contains an `android/` folder with a real `build.gradle`. A
monorepo contains `apps/web` with a real `package.json`. Marker presence alone
would turn one project into six phantom entries.

So every folder is reported with its **structural role** — `project`, `package`,
`platform`, `nested` — and internal parts appear **indented under their
parent**:

```
 56 projects · 64 internal folders shown beneath them

  Shipaton26
❯ ◉ mythika               Firebase · Riverpod · public repo · 182 commits · CLAUDE.md
    └ my-video            Remotion · React · inside project
    └ match               TypeScript · sub-package
    └ android             Kotlin · platform folder
```

**Nothing is hidden from you; it is arranged.** Which projects matter is your
call — a scaffold with one commit might be the work that paid your rent, and no
heuristic knows that.

---

## Filling it: the cheap path first

This is the part most tools get wrong, and it took building it wrong first to
see it.

### Cards for everything, in one pass

```bash
brain ingest --cards
```

One briefing covering **every** project that lacks a card: your own docs, the
shape of the tree, the dependency list. Hand it to your coding agent with
`skill/SKILL.md` and it writes a ~120-word card into each entry.

Measured on a real 25-project drive:

| | cost |
| --- | --- |
| **All 22 unwritten projects, one batch** | **6,635 words** |
| One project, deep briefing | ~23,000 characters |

The whole batch costs less than three individual deep briefings. And **no
repository needs opening** — the material travels in the document.

A card is enough to make the catalogue work: `index.capabilities`,
`index.patterns` and `index.related` all run on cards. That is what answers a
CV, an idea bank, or *"what have I built"*.

### Dossiers on demand

```bash
brain ingest supacut
```

A deep briefing for one project — entry points, domain model, largest
hand-written source files, scripts, manifests, git history. Worth doing for the
few projects someone wants a full article about.

### The one rule

> **Never invent.** No metric the project does not state, no users it does not
> have, no feature that is planned rather than built.

A blank is honest. A plausible fabrication gets laundered into every CV and
article generated afterwards, where nobody can tell it from fact. The skill
enforces this, and "no test suite" or "no usage data" are recorded as findings.

---

## Two tiers, because that is how this scales

Each entry holds a **card** and a **dossier**, emitted as separate files:

| file | holds | when an agent reads it |
| --- | --- | --- |
| `brain.json` | every project: typed fields + card + cross-index | always, in full |
| `api/projects/<id>.json` | one project's full dossier + its documents | only for the few it picked |

Why it matters, measured:

| projects | catalogue | full dossiers |
| --- | --- | --- |
| 25 | 5k tokens | 56k tokens |
| 100 | 18k tokens | 225k tokens |
| 375 | 68k tokens | 844k tokens |
| 1000 | 180k tokens | 2.25M tokens |

A 200k context fits a catalogue of **~1,100 projects** — or 88 dossiers. So an
agent with 375 projects reads 375 cards, picks five, reads those five dossiers.
The way you use a library catalogue instead of reading the library.

### No vector database, deliberately

At these sizes a model reading every card **reasons** over the portfolio —
*"these eight share local-first processing, and these three for the same
reason"* — which cosine similarity cannot do.

Embeddings start to matter past ~1,000 projects, and `capabilities`, `patterns`
and the dossiers are exactly what they would be computed from. No migration, no
work thrown away. Meanwhile the brain stays a directory you can copy anywhere,
with no service running and no binary index outside git.

### Cross-project questions, for free

```json
"index": {
  "capabilities": { "payments": ["bolsito-app", "invitta", "mythika", "ribeye", "yumforge"] },
  "patterns":     { "two-pass-llm": ["supacut", "supafilm", "ultraprompt-worker"] },
  "related":      [{ "pair": ["supacut", "supafilm"], "weight": 9,
                     "shared": { "capabilities": ["video-pipeline"], "patterns": ["two-pass-llm"] } }]
}
```

`capabilities` are what a project **does**; `patterns` are **how it is built**.
`related` ranks pairs by shared facets — and a shared framework alone scores
low, because two projects both using React says almost nothing.

---

## What an entry looks like

```markdown
---
id: supacut
name: SupaCut
tagline: Describe an edit in plain English, get a cut list your editor opens
status: shipped
visibility: public
kind: web-app
ecosystem: [node]
frameworks: [Next.js, React, TypeScript, OpenAI]
architecture: browser-local media processing with a thin API for model calls
capabilities: [video-pipeline, text-generation, audio-processing]
patterns: [two-pass-llm, browser-local-processing, worker-offloading]
relates_to: [supafilm]
documents:
  - path: README.md
    summary: What it does, the browser requirement, and how the pipeline runs
images: []
narrative_status: reviewed
---

## Card

A browser tool for rough-cutting long talking-head footage…

## What it does · How it works · Architecture ·
## Stack and dependencies · Constraints and requirements · State
```

Every section asks for something **verifiable** — a reader can open the
repository and contradict any sentence. Sections that asked which decisions were
*wise* or what *lesson* transfers were deliberately removed: that analysis
belongs to whoever consumes the brain, made with their own prompts.

---

## Publishing: a wiki of your work

```bash
brain publish --out public/ --title "Your Name — Project Brain"
```

Static files. GitHub Pages, Cloudflare Pages, Netlify, S3, any web root. One
artifact, two audiences:

- **people** → `<url>/` — an article per project, contents rail, framework
  facets, search, images floated beside the prose they illustrate
- **n8n** → `HTTP GET <url>/brain.json`
- **ChatGPT / Claude** → give it the URL
- **your own agent** → fetch the catalogue, then the dossiers it picks

A 19-project wiki with images weighs **668K**. No server, no database, nothing
to maintain. `brain build && git push` is a deployment.

### The publish boundary

What leaves your machine is **strictly less** than what lives on it.

| | rule |
| --- | --- |
| **Non-public projects** | Withheld. Publishing is opt-in per project, `--include-private` is the only way past, and withheld projects are erased from every index and from `relates_to` — an index naming a hidden project leaks its existence. |
| **Filesystem paths** | Stripped from metadata *and* from prose. An agent may quote a build path from a briefing; it never reaches the page. |
| **Images** | Published only after you set `confirmed: true`. A screenshot can expose a customer's name or a token in a URL bar, and no text search catches that — only a person looking at the picture. |
| **Source code, credentials** | Never included, at any setting. |

`brain publish` prints exactly what it withheld, every run.

### Images, optimised on the way out

Discovery proposes candidates from directories that conventionally hold material
made for an audience — `assets/branding`, `screenshots/`, `press/`,
`app_store/`. Nothing is published until you confirm it.

Anything over the page budget is re-encoded at publish time using whichever
encoder your machine already has (**ffmpeg**, **cwebp**, **ImageMagick**, or
macOS **sips**). Verified on a real App Store screenshot:

```
2.2MB  1290×2796  →  51KB  scaled to a 1400px edge
```

None of those tools is required — `npm install` stays empty. Without one,
publishing continues, names the images it left out, and says what to install.

---

## Let your agent keep it current

```bash
brain hook                 # run inside a project directory
brain hook --dry-run       # print the block, write nothing
```

A catalogue is only useful if it is updated when work actually happens, and
nobody remembers to run a command after shipping a feature. Your coding agent
**does** read `CLAUDE.md`, `AGENTS.md` or `SOUL.md` on every task — so the
instruction belongs there:

```markdown
<!-- motherbrain -->
## Keeping the project catalogue current

After finishing anything that changes what this project *is* — a shipped
feature, a new dependency, an architectural decision, a deployment — update
its entry in the Mother Brain catalogue…
<!-- /motherbrain -->
```

It writes **only into files you already keep**, and never creates one — if a
project has no agent file, it says so and exits. Running it twice is a no-op,
and removing the block is a search for one word.

---

## For your agent

Install `skill/SKILL.md` into your agent's skills directory. It documents the
two tiers, the ingest workflow, and the four shapes of request that come up:

| you ask | the agent does |
| --- | --- |
| *"Make me a CV with my best projects"* | Reads all cards, surfaces defensible candidates, lets **you** rank them |
| *"Write an article on building app portfolios with React"* | Crosses projects via `index.related`; the spine is the repeated decision |
| *"Build an idea bank from my asset-generation work"* | Starts at `index.capabilities`; the signal is in the gaps |
| *"Write an article about project X"* | One dossier, full depth, plus your own documents |

**Vendor-neutral by design.** Nothing here tells you which agent to use, and no
opinion about your code is shipped inside the data. It detects `CLAUDE.md` and
`AGENTS.md` the way it detects `README.md` — they are statements you already
made, and reading a file is not endorsing a vendor.

```bash
brain scan --json     # every folder found, with structure
brain list --json     # the manifest
brain build           # compile brain.json + api/ + dashboard
```

---

## Commands

```bash
brain init                 # point it at the directories holding projects
brain status               # where you are, and what to run next
brain pick [path…]         # choose projects in the browser
brain scan [path…]         # choose projects in the terminal
brain add [path…]          # send projects to the brain (alias: send)
brain ingest --cards       # one light briefing for every project  ← start here
brain ingest <id>          # a deep briefing for one project's dossier
brain list [--json]        # what is catalogued, what needs a write-up
brain build                # regenerate brain.json + api/ + dashboard
brain hook [path]          # let your agent keep an entry current as it works
brain refresh              # re-read git and structure; never your prose
brain migrate              # add fields and sections from a newer schema
brain wiki --out public/   # build the encyclopedia (alias of publish)
brain publish [--out dir]  # static files for hosting
brain dashboard [--open]   # the local maintainer's dashboard
```

**Two views, two audiences.** `brain dashboard` is your control panel — what is
catalogued, what still needs prose. `brain publish` is the public encyclopedia,
with the boundary applied.

---

## How this differs from pointing an agent at your GitHub

A fair question. On the drive this was built against, of 25 catalogued projects:

- **6 are not on GitHub at all** — no remote, so an agent with repository access
  cannot see they exist
- Of the rest, package descriptions were mostly absent, and several READMEs read
  literally *"A new Flutter project."*

But the real difference is structural. A repository holds code and metadata
about code. It has nowhere to put:

- what problem the project solved
- how it works, for a reader who will not open the source
- whether it shipped, who used it, what it earned
- **what connects your projects to each other**

That last one is the point. *"Write an article about building app portfolios
with React"* needs to know which decision **repeats** across projects. A
repository host has nowhere to store that, so an agent would clone everything
and re-derive it on every question — assuming it has disk access, which a
hosted content pipeline does not.

**Mother Brain is the library catalogue, not the archive.** It does not replace
your repositories; it means nobody has to read all of them to find what they
need.

---

## Design rules

1. **The tool describes; you decide.** Structure is detected and reported. What
   is worth cataloguing, and what is worth publishing, is never inferred.
2. **Files are the source of truth.** `brain.json`, the dashboard and any
   memory backend are derived and safe to delete.
3. **Zero dependencies.** Clone it in five years, on any machine, and it runs.
4. **Your repos are never touched.** Mother Brain reads. It records paths.
5. **Machine facts refresh; your prose never gets clobbered.** A `refresh`
   re-reads git and structure and leaves every word you wrote alone — including
   image confirmations and document summaries.
6. **Never invent.** Not a metric, not a tagline, not an outcome. The manifest
   is only worth as much as its weakest claim.

## Layout

```
bin/brain.js               the CLI
src/scan/detect.js         ecosystem markers, project roots, doc discovery
src/scan/classify.js       frameworks, structural role, project kind
src/scan/docs.js           which documents the brain carries
src/scan/images.js         image discovery and the confirmation gate
src/scan/tree.js           arranging findings as an indented tree
src/scan/git.js            remotes, activity, commit depth
src/ingest/cards.js        the light batch briefing
src/ingest/brief.js        the deep per-project briefing
src/manifest/              schema, frontmatter, store, bundle, publish boundary
src/media/optimise.js      publish-time image encoding
src/dashboard/render.js    the maintainer's dashboard
src/dashboard/pick.js      the picking page
src/dashboard/wiki.js      the published encyclopedia
skill/SKILL.md             the agent skill
projects/                  your manifest — one file per project
```

60 tests, `node --test test/*.test.js`.

## License

MIT
