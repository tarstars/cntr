#!/usr/bin/env bash
# Download upstream Cline VSIX versions with retries; keep only archives that pass `unzip -t`.
# Usage: scripts/code/fetch_cline.sh OUT_DIR VERSION...
set -u
OUT=$1; shift; mkdir -p "$OUT"
for v in "$@"; do
  f="$OUT/cline-$v.vsix"
  if [ -s "$f" ] && unzip -tq "$f" >/dev/null 2>&1; then echo "$v ok (cached)"; continue; fi
  for attempt in 1 2 3 4 5; do
    rm -f "$f"
    curl -sSL --http1.1 --compressed --retry 3 --retry-delay 3 --max-time 240 -o "$f" \
      "https://marketplace.visualstudio.com/_apis/public/gallery/publishers/saoudrizwan/vsextensions/claude-dev/$v/vspackage" 2>/dev/null
    if unzip -tq "$f" >/dev/null 2>&1; then echo "$v ok ($(wc -c <"$f") bytes, attempt $attempt)"; break; fi
    echo "$v attempt $attempt failed"; sleep $((attempt * 4))
  done
  sleep 2
done
