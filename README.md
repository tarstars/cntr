# cntr — teardown of the TAO·CODER agent behind цнтр.рф/proof

What the agent behind https://цнтр.рф/proof is and how its pipeline works, reconstructed from public material:
the site (75 pages), the 24 project documents embedded in /proof, and the published VS Code extension
`thinkingos.tao-coder` 3.1.2.

| Path | What |
|---|---|
| `diagram/taocoder_teardown.html` | the one-page diagram (generated) |
| `diagram/build_diagram.py`, `diagram/teardown.css` | generator for the diagram; zone references are computed from the box coordinates |
| `analysis/ANALYSIS.md` | written findings with evidence levels ([code] / [site] / [inf]) |
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

Rebuild:

```bash
scripts/crawl.sh                                   # new snapshot
python3 -I scripts/extract_proof_docs.py ~/database/<snap>/raw/proof.html ~/database/<snap>/docs
python3 -I scripts/parse_proof_metrics.py ~/database/<snap>/raw/proof.html data/proof_metrics_<date>.json
python3 -I diagram/build_diagram.py               # regenerates the diagram page
```
