---
id: example-project
name: Example Project
tagline: One factual line a stranger understands
status: shipped
visibility: public
kind: web-app
ecosystem:
  - node
frameworks:
  - Next.js
  - React
  - TypeScript
architecture: server-rendered pages with a queue-backed worker
domain: developer-tools
capabilities:
  - authentication
  - file-upload
patterns:
  - queue-backed-jobs
  - edge-rendering
relates_to: []
documents:
  - path: README.md
    summary: What it does, how to run it, and the deployment steps
images: []
role: author
started: "2026-01-14"
last_active: "2026-03-02"
links:
  site: null
  repo: https://github.com/you/example-project
  demo: null
  docs: null
source:
  path: /path/to/your/project
  structure: project
  part_of: null
  git: true
  remote: https://github.com/you/example-project
  branch: main
  commits: 42
  deploy:
    - vercel
  docs:
    - README.md
tags:
  - example
highlights:
  - A checkable statement about what the system does, not about how good it is
metrics:
  tests: 128
added_to_brain: "2026-03-02"
narrative_status: reviewed
---

# Example Project

> One factual line a stranger understands

This file exists to show the shape of an entry. It is the only one this
repository ships — your own entries are gitignored, because they carry absolute
paths to your disk and describe projects you may never have marked public.

Delete it whenever you like. `brain pick` will write real ones.

## Card

Under 120 words, factual, self-contained: what this is, who uses it, what it
does, and how it is built at a glance. No stack list — the frontmatter above
already carries that. No claims about quality or significance.

A reader who sees nothing else should know what the project is and whether it
is relevant to them. This is the tier every agent reads for every project, so
it has to stay cheap.

## What it is

What the software does and who uses it, in plain terms a stranger understands.
Describe behaviour, not merit.

## What it does

The features, concretely: what a user can actually do with it, screen by screen
or capability by capability. What exists, not what is planned — and anything
incomplete is marked as incomplete.

## How it works

The mechanism. Data flow from input to output, where state lives, which parts
run where, what talks to what. Enough that someone could describe the system
without opening the repository.

## Architecture

The structure: modules or layers and their responsibilities, the pattern the
code follows, the storage and its schema. How it is organised, not whether that
was wise.

## Stack and dependencies

What it is built on and what each significant piece is used for — framework,
storage, auth, payments, third-party services, models. Versions and hosting
where the project states them.

## Constraints and requirements

What it needs to run and what it cannot do: platform minimums, required keys or
accounts, known limitations, unsupported cases. Taken from the project's own
docs and configuration.

## State

Where the project stands: what is built versus planned, whether it shipped and
where, test counts and deployment facts if the project records them. Only
figures the project or its author states — never an estimate, and the absence
of data is recorded as absence.
