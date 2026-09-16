#!/usr/bin/env bash
# Install the Mother Brain skill where a coding agent will find it.
#
# A skill in this repository only helps someone standing in this repository.
# Installed globally it travels: the agent reads it while working in any
# project, which is where the developer actually is when a feature ships.
#
# Symlinked, not copied, when the source is a checkout — an upgrade is then a
# git pull rather than a reinstall someone forgets to run.
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
SRC="$ROOT/skill"

# Where each agent looks. Claude Code and Codex read a skills directory;
# others read a single instruction file, and those are left alone — appending
# to a file someone else owns is `brain hook`'s job, by consent, per project.
TARGETS=(
  "$HOME/.claude/skills/mother-brain"
  "$HOME/.codex/skills/mother-brain"
)

installed=0
for dest in "${TARGETS[@]}"; do
  parent="$(dirname "$dest")"
  [ -d "$parent" ] || continue

  if [ -L "$dest" ]; then
    rm "$dest"
  elif [ -e "$dest" ]; then
    echo "  ! $dest exists and is not a link — left alone"
    continue
  fi

  ln -s "$SRC" "$dest"
  echo "  → $dest"
  installed=$((installed + 1))
done

if [ "$installed" -eq 0 ]; then
  echo "No agent skills directory found."
  echo
  echo "Looked for:"
  for dest in "${TARGETS[@]}"; do echo "  $(dirname "$dest")"; done
  echo
  echo "Create one and re-run, or point your agent at $SRC/SKILL.md directly."
  exit 1
fi

# The CLI has to be on PATH for the skill's commands to work from any directory.
if command -v brain >/dev/null 2>&1; then
  echo
  echo "  brain → $(command -v brain)"
else
  echo
  echo "  ! \`brain\` is not on your PATH."
  echo "    From this checkout:  npm link"
  echo "    Or add an alias:     alias brain='node $ROOT/bin/brain.js'"
fi

echo
echo "Installed. Your agent can now read and update the brain from any project."
