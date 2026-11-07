"""Convert a saved HTML page to a rough structured markdown dump (headings, tables, code, lists)."""
import sys
from bs4 import BeautifulSoup, NavigableString, Tag

BLOCK = {"p", "div", "section", "article", "main", "header", "footer", "nav", "li", "blockquote", "details", "summary"}

def walk(node, out, depth=0):
    for ch in node.children:
        if isinstance(ch, NavigableString):
            t = str(ch)
            if t.strip():
                out.append(" ".join(t.split()) + " ")
            continue
        if not isinstance(ch, Tag):
            continue
        name = ch.name
        if name in ("script", "style", "svg", "noscript"):
            if name == "script":
                txt = ch.get_text()
                if txt.strip():
                    out.append(f"\n\n[SCRIPT len={len(txt)} src={ch.get('src')}]\n")
            continue
        if name and len(name) == 2 and name[0] == "h" and name[1].isdigit():
            out.append("\n\n" + "#" * int(name[1]) + " " + " ".join(ch.get_text().split()) + "\n")
            continue
        if name == "pre":
            out.append("\n```\n" + ch.get_text() + "\n```\n")
            continue
        if name == "table":
            out.append("\n")
            for tr in ch.find_all("tr"):
                cells = [" ".join(c.get_text().split()) for c in tr.find_all(["td", "th"])]
                out.append("| " + " | ".join(cells) + " |\n")
            out.append("\n")
            continue
        if name == "a":
            href = ch.get("href")
            txt = " ".join(ch.get_text().split())
            out.append(f"[{txt}]({href}) ")
            continue
        if name == "code":
            out.append("`" + ch.get_text() + "` ")
            continue
        if name == "br":
            out.append("\n")
            continue
        if name == "hr":
            out.append("\n---\n")
            continue
        if name == "li":
            out.append("\n" + "  " * depth + "- ")
            walk(ch, out, depth + 1)
            continue
        if name == "button":
            out.append(f"[BUTTON: {' '.join(ch.get_text().split())} attrs={ {k:v for k,v in ch.attrs.items() if k.startswith('data') or k in ('id','onclick')} }] ")
            continue
        if name in BLOCK:
            attrs = {k: v for k, v in ch.attrs.items() if k.startswith("data-") or k == "id"}
            if attrs:
                out.append(f"\n<{name} {attrs}>")
            out.append("\n")
            walk(ch, out, depth)
            out.append("\n")
            continue
        walk(ch, out, depth)

def main(src, dst):
    soup = BeautifulSoup(open(src, encoding="utf-8").read(), "html.parser")
    out = []
    walk(soup.body or soup, out)
    text = "".join(out)
    import re
    text = re.sub(r"\n[ \t]+\n", "\n\n", text)
    text = re.sub(r"\n{3,}", "\n\n", text)
    open(dst, "w", encoding="utf-8").write(text)
    print(dst, len(text))

if __name__ == "__main__":
    main(sys.argv[1], sys.argv[2])
