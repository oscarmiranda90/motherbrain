#!/usr/bin/env bash
# Regenerate the catalogue and push it to a Hermes server.
#
# The brain can only be generated here: the scanner reads repositories that
# exist on this machine and nowhere else. So this machine stays the source of
# truth and the server holds a copy.
#
# No HTTP, no open port, no service to maintain. The agent reads the files off
# its own disk, and they travel over the SSH port that is already open.
set -euo pipefail

# The server is yours to name. An SSH alias in ~/.ssh/config keeps the
# hostname, user and key out of this script and out of your shell history.
HOST="${HERMES_HOST:-}"
DEST="${HERMES_BRAIN_DIR:-.hermes/brain}"

if [ -z "$HOST" ]; then
  cat >&2 <<'MSG'
Set HERMES_HOST to the server holding your agent.

  export HERMES_HOST=my-agent-box        # an ~/.ssh/config alias, or user@host

Optionally set where the catalogue lands (default: .hermes/brain):

  export HERMES_BRAIN_DIR=.hermes/brain
MSG
  exit 1
fi
ROOT="$(cd "$(dirname "$0")/.." && pwd)"

cd "$ROOT"

echo "Rebuilding the catalogue"
node bin/brain.js build >/dev/null

# Strip filesystem paths. They name directories on this machine, which do not
# exist on the server: leaving them in offers the agent a path it can never
# open, and copies the shape of a private disk into a remote prompt.
echo "Stripping local paths"
TMP="$(mktemp -d)"
trap 'rm -rf "$TMP"' EXIT
mkdir -p "$TMP/projects"

node -e '
const fs = require("fs");
const PATHS = /(?:\/(?:Users|home|Volumes|mnt|media|opt|srv|var|tmp|private)\/[^\s"`)\]]+)/g;
function strip(value) {
  if (typeof value === "string") return value.replace(PATHS, "[local]");
  if (Array.isArray(value)) return value.map(strip);
  if (value && typeof value === "object") {
    const out = {};
    for (const [k, v] of Object.entries(value)) {
      if (k === "path" && typeof v === "string" && PATHS.test(v)) continue;
      out[k] = strip(v);
    }
    return out;
  }
  return value;
}
const dir = process.argv[1];
const read = (p) => JSON.parse(fs.readFileSync(p, "utf8"));

// The shipped example entry describes no real project. A remote agent asked
// to write about this work would treat it as one, so it is dropped here for
// the same reason `brain publish` refuses it.
const TEMPLATE = (p) =>
  p.id === "example-project" || /^\/path\/to\/your\//.test(p.source?.path ?? "");

const catalogue = read("brain.json");
catalogue.projects = catalogue.projects.filter((p) => !TEMPLATE(p));
const kept = new Set(catalogue.projects.map((p) => p.id));

// Rebuild the indexes over what survived, so no index names a dropped
// project. The facets do not share one shape: most map a value to a list of
// ids, `status` holds counts, and `related` is a list of weighted pairs.
if (catalogue.index) {
  for (const [facet, groups] of Object.entries(catalogue.index)) {
    if (Array.isArray(groups)) {
      // `related`: pairs of ids, both of which must have survived.
      catalogue.index[facet] = groups.filter(
        (row) => !Array.isArray(row?.pair) || row.pair.every((id) => kept.has(id)),
      );
      continue;
    }
    const entries = Object.entries(groups ?? {});
    // Counts, not id lists — recount from the survivors instead of filtering.
    if (entries.some(([, v]) => typeof v === "number")) {
      const counts = {};
      for (const p of catalogue.projects) {
        const value = p[facet];
        if (typeof value === "string" && value) counts[value] = (counts[value] ?? 0) + 1;
      }
      catalogue.index[facet] = counts;
      continue;
    }
    catalogue.index[facet] = Object.fromEntries(
      entries
        .filter(([, ids]) => Array.isArray(ids))
        .map(([k, ids]) => [k, ids.filter((id) => kept.has(id))])
        .filter(([, ids]) => ids.length > 0),
    );
  }
}

fs.writeFileSync(dir + "/brain.json", JSON.stringify(strip(catalogue), null, 1));
for (const f of fs.readdirSync("api/projects")) {
  const project = read("api/projects/" + f);
  if (TEMPLATE(project)) continue;
  fs.writeFileSync(dir + "/projects/" + f, JSON.stringify(strip(project), null, 1));
}
' "$TMP"

cp skill/SKILL.md "$TMP/SKILL.md"

# The approved images themselves, not only their descriptions. An agent asked
# for a carousel needs the pixels, and `brain publish` has already re-encoded
# them: 4MB App Store PNGs become ~140KB webp. Reuse that output rather than
# shipping originals.
if [ -d public/media ]; then
  echo "Including approved images"
  cp -R public/media "$TMP/media"
else
  echo "No public/media yet — run 'brain publish --out public/' to optimise approved images"
fi

echo "Syncing to $HOST:$DEST"
ssh "$HOST" "mkdir -p '$DEST'"
rsync -az --delete "$TMP/" "$HOST:$DEST/"

COUNT=$(ssh "$HOST" "ls -1 '$DEST/projects' 2>/dev/null | wc -l | tr -d ' '")
SHOTS=$(ssh "$HOST" "find '$DEST/media' -type f 2>/dev/null | wc -l | tr -d ' '")
LEFT=$(ssh "$HOST" "grep -ro '/Volumes/\|/Users/' '$DEST' 2>/dev/null | wc -l | tr -d ' '")
echo "Done — $COUNT dossiers, $SHOTS images, $LEFT local paths remaining"
