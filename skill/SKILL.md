---
name: mother-brain
description: Read and write a Mother Brain manifest — a self-contained, factual record of the projects on someone's disk: what each one is, what it does, how it works, what it runs on, and the author's own documents carried verbatim. Trigger when the user says "send to brain", "add this to mother brain", "ingest this repo", asks what they have built, asks to fill in a project's entry, or wants a CV, portfolio, article, content series, or idea bank drawn from their own past work. Also trigger it yourself, unprompted, after finishing work that changes what a project is — a feature merged, a pull request closed, a release cut — to record what shipped with `brain shipped`.
---

# Mother Brain

A factual record of the user's projects. **Not** a copy of their repositories,
and not an index pointing at them: a self-contained library, so a consumer that
has never seen their disk — a hosted agent, an n8n workflow, a cron job at 3am —
can work from it alone.

That constraint drives everything here. If you find yourself needing to open a
repository to answer a question, the brain was under-filled; the fix is to
ingest that project properly, not to reach for the code at query time.

## What this data is, and what it is not

The brain holds **descriptions**: what the software does, how it is assembled,
what it runs on, what state it is in. Every sentence should be contradictable by
opening the repository.

It deliberately holds **no evaluation**. Which decisions were wise, what lesson
the work teaches, whether a project is impressive — none of that is here,
because analysis belongs to whoever consumes the brain, made with their own
prompts and their own purpose. An earlier version of this schema asked for it
and produced essays: one agent's reading of someone else's work, shipped inside
the data and indistinguishable from fact the moment it was quoted into a CV.

So when you write into the brain, **describe**. When you generate an artifact
*from* the brain, analyse all you like — that is your output, not the record.

## Locating the brain

In order:

1. `$MOTHERBRAIN_ROOT`
2. A directory above the cwd containing `brain.config.json`
3. A URL the user gave you (a published brain — fetch `brain.json` from it)
4. Ask the user

If none exists, they have not set it up: tell them to run `brain init`.

## How the data is shaped

Two tiers, and using them correctly is the difference between a fast answer and
a blown context window.

| | what it holds | when you read it |
| --- | --- | --- |
| `brain.json` | every project: typed fields, a ~120-word **card**, and a document **inventory** | always, in full |
| `api/projects/<id>.json` | one project's full **dossier** plus the complete text of its documents | only for the few you selected |

A portfolio of 375 projects is ~68k tokens of cards — read them all. The same
375 dossiers would be ~840k tokens; never attempt that.

`brain.json` also carries an `index`:

- `index.capabilities` — `"asset-generation": ["supacut", "tgc-maker", …]`
- `index.patterns` — `"browser-local-processing": [...]`
- `index.frameworks`, `index.ecosystem`, `index.kind`, `index.domain`, `index.tags`
- `index.related` — project **pairs** sharing facets, strongest first, each with
  what they share. This is the cheap answer to "what connects this work"; use it
  before comparing projects yourself.

There is no vector database, deliberately. At these sizes you reading every card
*reasons* over the portfolio — "these eight share local-first processing, and
these three for the same reason" — which similarity search cannot do.

### Documents are the most objective content here

Each entry lists the author's own Markdown files. They wrote them, so carrying
them is transcription rather than interpretation, and they outrank anything
inferred from the code — including anything you write.

- The **catalogue** lists path, a one-line summary of the contents, and length.
- The **dossier** carries the full text.

When a question touches what a project is *for*, read the documents before
trusting a summary of them. If the author's words contradict your reading of the
code, say so rather than silently choosing.

## Task 1 — Ingest a project

```bash
brain ingest <id>          # writes a briefing to .motherbrain/briefs/<id>.md
brain ingest --all         # every entry whose write-up is incomplete
```

The briefing is a **map, collected mechanically**: entry points, the domain
model, the largest hand-written source files, scripts, dependency manifests, git
history, and the author's own documents. It is not a substitute for reading the
code.

Then:

1. Read the briefing.
2. **Read the files it names.** The largest source files and the domain model
   are where the substance is.
3. Write the `## Card` — under 120 words, factual, self-contained, no stack list
   (the frontmatter has that). A reader who sees nothing else should know what
   the project is and whether it is relevant to them.
4. Write the dossier sections: **What it is · What it does · How it works ·
   Architecture · Stack and dependencies · Constraints and requirements ·
   State**.
5. Write a one-line summary for each document in `documents` — an inventory of
   what is inside, not a review of it. *"Colour tokens, typography, screen
   specifications"* tells a reader whether to open it.
6. Fill the frontmatter you can now support: `tagline`, `architecture`,
   `domain`, `status`, `capabilities`, `patterns`, `relates_to`, `tags`,
   `highlights`, `metrics`, and `narrative_status: dossier`.
7. `brain build`

### Rules that are not negotiable

- **Never invent.** No metric the project does not state, no users it does not
  have, no feature that is planned rather than built. A blank is honest; a
  plausible fabrication is laundered into every artifact generated afterwards,
  where nobody can tell it from fact.
- **Record absence as absence.** "No test suite", "no usage data", "never
  deployed" are findings, and they are what make the present figures
  trustworthy.
- **Describe, do not assess.** Report that data access sits behind one interface
  and that the Firebase calls were later swapped for REST. Do not report that
  this was a good idea, or what it teaches.
- **Mark planned work as planned.** A roadmap is not a feature list. If a
  document describes something unbuilt, say which it is.
- **Ask what only the author knows.** Did it ship? Where? Does anyone use it?
  Why was it abandoned? Ask — never fill it in for them.
- **Write for a reader who cannot see the code.** "Uses a repository pattern" is
  useless; "data access sits behind one interface, and the storage backend was
  swapped once without touching callers" is usable.
- **`capabilities` are what a project *does*** (`asset-generation`,
  `realtime-sync`, `payments`). **`patterns` are *how* it is built**
  (`browser-local-processing`, `two-pass-llm`, `hexagonal-architecture`). Reuse
  values already in `index.capabilities` and `index.patterns` before inventing
  new ones — an index whose every value appears once indexes nothing.
- **`highlights` are factual statements**, phrased so each can be checked
  against the repository. Not "impressive architecture" but "runs the same HTML
  composition in a container and on-device so both renders agree".
- `source.structure` of `package` or `platform` means this is part of a larger
  project. Describe it as a component and cross-link the parent in
  `relates_to`; do not write it up as a standalone product.

## Task 2 — Send a project to the brain

```bash
brain add                  # current directory
brain add <path> [<path>…]
brain pick                 # choose visually in the browser
```

This records structure only — ecosystem, frameworks, git facts, deploy targets,
documents found. It deliberately leaves `status`, `architecture`, `domain` and
the prose empty. Follow it with Task 1; an entry with no write-up is a directory
listing.

## Task 3 — Answer questions about the portfolio

Read `brain.json`. Query the catalogue, not the disk.

```bash
brain list --json
```

If it looks stale against `projects/`, run `brain build` first.

When an entry is thin and the question needs depth, say so and offer to ingest
it. Do not quietly substitute your own guesses for missing data.

## Task 4 — Generate artifacts from the brain

CVs, portfolios, articles, content series, idea banks. **This is where analysis
belongs** — the brain gave you facts; the interpretation is your work.

**"Make me a CV with my best projects"**
Read all cards. Which projects are "best" is the user's judgement, not yours:
surface the candidates with the facts that bear on it — shipped or not, public
or not, real metrics where they exist, what each system actually does — and let
them choose, or ask what the CV is for. Draw bullets from `highlights`, `State`
and `metrics`; every claim must trace to an entry.

**"Write an article about building a portfolio of apps with React"**
This crosses projects. Start at `index.frameworks.React` and `index.related`,
then read the dossiers of the ones sharing a pattern. The spine of the article
is the repetition you find across `How it works` and `Architecture` — that
reading is yours to do, and the brain's job was to make it possible without
opening twenty repositories.

**"Build an idea bank from my work on asset generation"**
Start at `index.capabilities`. The useful signal is often in the gaps:
capabilities the author keeps reaching for, problems they return to, adjacent
domains they have never touched. Ground each idea in the projects that make it
plausible for *them* specifically.

**"Write an article about project X"**
One project, full depth. Read its dossier and its documents — `How it works`,
`Architecture` and `Constraints and requirements` carry the mechanism, and the
author's own docs carry their intent. If the entry cannot support the article,
ingest the project first rather than padding.

In all four: **ground every claim in an entry.** If the brain does not say a
project had 10k users, the artifact does not either. Thin source data is a
reason to ingest, never a licence to invent.

## Frontmatter reference

| Field | Meaning |
| --- | --- |
| `id` | slug; matches the filename |
| `name` | display name |
| `tagline` | one factual line a stranger understands |
| `status` | `idea` `prototype` `wip` `shipped` `live` `paused` `archived` — from what the author states, never inferred from commit activity |
| `visibility` | `public` `private` `client` `internal` — only `public` is published |
| `kind` | `web-app` `website` `landing` `docs-site` `mobile-app` `desktop-app` `game` `cli` `library` `api` `service` `agent` `tool` `content-pipeline` `monorepo` `experiment` `platform-scaffold` `unknown` |
| `ecosystem` | language ecosystems (`node`, `flutter`, `python`, `wordpress`, …) |
| `frameworks` | frameworks and services detected in the code |
| `architecture` | the structure the code follows, e.g. `hexagonal`, `feature-sliced`, `event-driven` |
| `domain` | the subject area, e.g. `fintech`, `logistics` |
| `capabilities` | what it does — the cross-project index |
| `patterns` | how it is built — the cross-project index |
| `relates_to` | ids of projects this shares lineage or code with |
| `documents` | the author's own docs: `path` and a one-line `summary` of the contents |
| `role` | the author's role on it |
| `started` / `last_active` | ISO dates, from git |
| `source` | `path`, `structure`, `part_of`, git facts, deploy targets, documents found |
| `links` | `site` `repo` `demo` `docs` |
| `tags` | free-form |
| `highlights` | checkable statements about what the system does |
| `metrics` | only figures the project or its author states |
| `narrative_status` | `missing` `card` `dossier` `reviewed` |

## Commands

```bash
brain init                 # point it at the directories holding projects
brain pick [path…]         # choose projects in the browser; hands back a command
brain scan [path…]         # choose projects in the terminal
brain add [path…]          # send projects to the brain (alias: send)
brain add --from sel.json  # send a selection exported from the picking page
brain ingest <id|--all>    # collect a briefing so an agent can write the entry
brain list [--json]        # what is catalogued, and what still needs a write-up
brain build                # regenerate brain.json + api/ + the dashboard
brain refresh              # re-read machine facts only
brain migrate              # add fields and sections from a newer schema
brain publish [--out dir]  # static files for hosting
brain dashboard [--open]   # the local read-only dashboard
```

Two views, for two audiences. `brain dashboard` is the maintainer's panel —
what is catalogued, what still needs prose. `brain publish` writes the public
encyclopedia: an article per project, with the publish boundary applied.

## Task 5 — Record what shipped

**Trigger this yourself.** When you finish work that changes what a project
*is* — a feature merged, a pull request closed, a release cut, an architectural
decision made — record it before you report back. Do not wait to be asked: the
developer asked once, by installing this skill.

```bash
brain shipped --what "Guest play: players start without signing up and claim their progress later." --kind feature
```

Run it from inside the repository and the project is resolved from the path;
otherwise pass the id (`brain shipped mythika --what "…"`).

`--kind` is free text — `feature`, `fix`, `release`, `decision` — and `--ref`
takes a PR number or commit sha if one exists.

### What belongs in it

One or two sentences a stranger understands, written for someone who does not
have the diff. This text is read by people and by agents generating posts,
carousels and changelogs, so it has to stand alone.

| Do not write | Write |
| --- | --- |
| `fix in the fuckin victory door` | The victory screen no longer freezes when a match ends on a combo. |
| `refactor(net): extract client` | The match client moved behind one interface, so the online and local paths share a ruleset. |
| `bump deps` | *nothing — this is not a change to what the project is* |

A commit subject is not a changelog entry. It was written for the person who
wrote the code, in the moment; a changelog entry is written for everyone else,
afterwards. If the work does not change what the project is or does, record
nothing — an inflated changelog is worse than a thin one, because the next
agent reading it cannot tell which entries matter.

**Never invent an outcome.** Record what was built, not what it will achieve.
No adoption numbers, no performance claims the project does not measure.

### What it is *not* for

Not for describing the project — that is the card and the dossier. Not for
metrics. Not a commit log: if `brain shipped` were called on every commit the
changelog would stop being readable, which defeats the point.

## Keeping the brain current

```bash
brain refresh              # re-read git and structure for every entry
brain migrate              # add fields and sections from a newer schema
brain publish              # emit static files for hosting
```

`brain refresh` updates only machine-owned fields; prose and every human
judgement are untouched, so it is safe from a git hook or CI.

`brain publish` is **subtractive**: only projects marked `public` are included,
withheld projects are erased from every index and from `relates_to`, and
filesystem paths are stripped from metadata *and* from prose. Source code and
credentials are never published at any setting. The command prints what it
withheld on every run.

The published output is both a page people can read and an API agents can fetch
— `brain.json` plus `api/projects/*.json` on any static host.

## Working memory

If the user has a persistent memory tool available, it is reasonable to use it
for *working* state across sessions: which project you were mid-way through
ingesting, decisions made about the manifest's shape.

Never let it hold a fact that is not also in `projects/*.md`. The manifest is
the source of truth precisely because it is plain files — an external memory
that outlives its tool is not memory, it is a leak.
