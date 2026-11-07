#!/usr/bin/env bash
# Snapshot цнтр.рф (sitemap pages + /proof) into a large-artifact directory outside git.
# Usage: scripts/crawl.sh [OUT_DIR]   (default: ~/database/<YYYYMMDD>_cntr_proof_site)
set -euo pipefail
OUT=${1:-$HOME/database/$(date +%Y%m%d)_cntr_proof_site}
BASE="https://xn--m1agfo.xn--p1ai"   # punycode for цнтр.рф
UA='Mozilla/5.0 (research crawl)'
mkdir -p "$OUT/raw/pages" "$OUT/raw/en"
curl -sS -A "$UA" -o "$OUT/raw/site_robots.txt" "$BASE/robots.txt"
curl -sS -A "$UA" -o "$OUT/raw/site_sitemap.xml" "$BASE/sitemap.xml"
grep -o '<loc>[^<]*</loc>' "$OUT/raw/site_sitemap.xml" | sed 's#</\?loc>##g' > "$OUT/raw/urls.txt"
while read -r u; do
  path=${u#"$BASE"/}; name=$(echo "${path:-index}" | tr '/' '_')
  [ -s "$OUT/raw/pages/$name.html" ] && continue
  code=$(curl -sS -A "$UA" -o "$OUT/raw/pages/$name.html" -w '%{http_code}' "$u")
  echo "$code $name"; sleep 0.7
done < "$OUT/raw/urls.txt"
cp "$OUT/raw/pages/proof.html" "$OUT/raw/proof.html"
curl -sS -A "$UA" -o "$OUT/raw/en/proof.html" https://thinkingos.tech/proof
curl -sS -A "$UA" -o "$OUT/raw/en/sitemap.xml" https://thinkingos.tech/sitemap.xml
echo "snapshot in $OUT"
