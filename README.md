# cntr — teardown of the TAO·CODER agent behind цнтр.рф/proof

What the agent behind https://цнтр.рф/proof is and how its pipeline works, reconstructed from public material:
the site (75 pages), the 24 project documents embedded in /proof, and the published VS Code extension
`thinkingos.tao-coder` 3.1.2.

| Path | What |
|---|---|
| `diagram/taocoder_teardown.html` | the one-page diagram (generated) |
| `diagram/build_diagram.py`, `diagram/teardown.css` | generator for the diagram; zone references are computed from the box coordinates |
| `analysis/ANALYSIS.md` | first-pass findings with evidence levels ([code] / [site] / [inf]) |
| `analysis/CODE_ANALYSIS.md` | second pass: diff against upstream Cline, TAO code read module by module |
| `analysis/code/*.md` | detailed per-subsystem reports with bundle offsets |
| `scripts/code/` | fingerprinting, novel-code extraction, offset viewer, Cline downloader |
| `data/code/` | upstream similarity table, novel-code indexes and hook points |
| `data/proof_metrics_20261107.json` | /proof metrics parsed, with per-task ratios and a totals cross-check |
| `data/sitemap_urls_20261107.txt` | URLs crawled |
| `data/snapshot_manifest_20261107.sha256` | checksums of the large snapshot files |
| `scripts/crawl.sh` | snapshot the site into `~/database/<date>_cntr_proof_site/` |
| `scripts/html2md.py` | rough HTML → markdown for reading |
| `scripts/extract_proof_docs.py` | pull the 24 embedded docs out of /proof |
| `scripts/parse_proof_metrics.py` | /proof metrics → JSON |

Large artifacts (not in git): `~/database/20261107_cntr_proof_site/`

- `raw/` — HTML snapshots (`pages/`, `proof.html`, `en/proof.html`, robots, sitemap)
- `pages_md/` — markdown conversions of every page
- `docs/` — the 24 /proof documents as markdown + `proof-docs-data.json`
- `vsix/` — `tao-coder-latest.vsix` (3.1.2) and its unpacked contents (read only, never executed)
- `code/upstream/` — 12 upstream Cline VSIX releases (3.70.0 … 4.0.12) and their bundles
- `code/novel_ext/`, `code/novel_webview/` — TAO code with no upstream match: `index.tsv`, `hooks.tsv`, prettified `chunks/`
- `code/reports/` — the per-subsystem reports (copied into `analysis/code/`)
- `code/tools/` — pinned acorn 8.12.1 / prettier 3.3.3 used by `scripts/code/`

Rebuild:

```bash
scripts/crawl.sh                                   # new snapshot
python3 -I scripts/extract_proof_docs.py ~/database/<snap>/raw/proof.html ~/database/<snap>/docs
python3 -I scripts/parse_proof_metrics.py ~/database/<snap>/raw/proof.html data/proof_metrics_<date>.json
python3 -I diagram/build_diagram.py               # regenerates the diagram page
# code diff (needs ~20 GB RAM headroom for the largest step)
scripts/code/fetch_cline.sh ~/database/<snap>/code/upstream 3.79.0 3.82.0 …   # then unzip extension/dist + webview
node --max-old-space-size=22000 scripts/code/novel.mjs <tao extension.js> <out dir> <upstream extension.js>…
```
