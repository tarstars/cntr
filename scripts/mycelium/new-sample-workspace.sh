#!/usr/bin/env bash
# Create an empty Mycelium workspace for an experiment run.
# Usage: scripts/mycelium/new-sample-workspace.sh <dir> <tao|improved> [models.json to copy]
set -euo pipefail
dir=$1; profile=$2; models=${3:-}
case "$profile" in tao|improved) ;; *) echo "profile must be tao or improved" >&2; exit 2 ;; esac
mkdir -p "$dir/.mycelium"
cd "$dir"
[ -d .git ] || git init -q
printf '{\n  "profile": "%s",\n  "defaultMode": "architect"\n}\n' "$profile" > .mycelium/profile.json
if [ -n "$models" ]; then cp "$models" .mycelium/models.json; fi
printf '.mycelium/tasks/*/snapshots/\n.mycelium/check_runs/\n' >> .gitignore
echo "workspace ready: $dir (profile $profile)"
