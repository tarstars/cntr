"""Extract the embedded proof-docs-data JSON from a saved /proof page into per-doc files."""
import json, os, re, sys
from bs4 import BeautifulSoup

src, outdir = sys.argv[1], sys.argv[2]
soup = BeautifulSoup(open(src, encoding="utf-8").read(), "html.parser")
data = json.loads(soup.find("script", id="proof-docs-data").get_text())
os.makedirs(outdir, exist_ok=True)
json.dump(data, open(os.path.join(outdir, "proof-docs-data.json"), "w", encoding="utf-8"), ensure_ascii=False, indent=1)
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from html2md import walk
print("entries:", len(data), "keys:", sorted({k for d in data for k in d}))
for i, d in enumerate(data):
    keys = {k: (v if not isinstance(v, str) or len(v) < 80 else f"<str {len(v)}>") for k, v in d.items()}
    print(i, keys)
    html = d.get("fullContent", "")
    out = []
    walk(BeautifulSoup(html, "html.parser"), out)
    text = re.sub(r"\n{3,}", "\n\n", "".join(out))
    fn = f"{i:02d}_{d.get('projectId')}_{re.sub(r'[^A-Za-z0-9]+','_',d.get('title',''))}.md"
    open(os.path.join(outdir, fn), "w", encoding="utf-8").write(text)
