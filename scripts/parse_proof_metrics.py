"""Parse the metrics block of a saved /proof page into JSON (aggregates + per-project) with derived ratios."""
import json, re, sys
from bs4 import BeautifulSoup

def num(s):
    s = s.replace(" ", " ").replace(" ", "").replace("$", "").replace(",", ".")
    return float(s) if re.fullmatch(r"[0-9.]+", s) else s

def hours(s):
    m = re.fullmatch(r"(\d+)h\s*(\d+)m", s.strip())
    return round(int(m[1]) + int(m[2]) / 60, 3) if m else None

html = open(sys.argv[1], encoding="utf-8").read()
block = html.split("<!-- PROOF_DATA_START -->")[1].split("<!-- PROOF_DATA_END -->")[0]
soup = BeautifulSoup(block, "html.parser")
for s in soup.find_all("script"):
    s.decompose()
lines = [l.strip() for l in soup.get_text("\n").split("\n") if l.strip()]
projects, cur, agg = [], None, {}
LABELS = {"Задачи": "tasks", "Длительность": "duration", "LLM-вызовы": "llm_calls", "Стоимость": "cost_usd",
          "Строки": "lines", "Файлы": "files"}
AGG = {"Строк кода": "lines", "Файлы": "files", "Проекты": "projects", "Последнее обновление": "updated",
       "Всего задач": "tasks", "Общая длительность": "duration", "Общая стоимость": "cost_usd",
       "Всего LLM-вызовов": "llm_calls", "Средняя длительность": "avg_duration", "Среднее LLM-вызовов": "avg_llm_calls",
       "Средняя стоимость": "avg_cost_usd", "Среднее строк": "avg_lines"}
for i, l in enumerate(lines):
    if l.startswith("Проект:"):
        cur = {"name": l.split(":", 1)[1].strip(), "status": lines[i + 1]}
        projects.append(cur)
    elif cur is None and l in AGG and i > 0:
        agg[AGG[l]] = lines[i - 1]
    elif cur is not None and l in LABELS:
        cur[LABELS[l]] = lines[i - 1]
ids = []
for b in BeautifulSoup(block, "html.parser").find_all(attrs={"data-project-id": True}):
    if b["data-project-id"] not in ids:
        ids.append(b["data-project-id"])
for p, pid in zip(projects, ids):
    p["id"] = pid
    p["hours"] = hours(p.pop("duration"))
    for k in ("tasks", "llm_calls", "cost_usd", "lines", "files"):
        p[k] = num(p[k])
    t = p["tasks"]
    p["derived"] = {
        "usd_per_task": round(p["cost_usd"] / t, 3),
        "llm_calls_per_task": round(p["llm_calls"] / t, 1),
        "hours_per_task": round(p["hours"] / t, 2),
        "lines_per_task": round(p["lines"] / t, 0),
        "usd_per_1k_lines": round(p["cost_usd"] / p["lines"] * 1000, 3),
        "usd_per_llm_call": round(p["cost_usd"] / p["llm_calls"], 5),
    }
s = lambda k: round(sum(p[k] for p in projects), 2)
check = {k: s(k) for k in ("tasks", "llm_calls", "cost_usd", "lines", "files", "hours")}
json.dump({"aggregate_as_published": agg, "sum_of_projects": check, "projects": projects},
          open(sys.argv[2], "w", encoding="utf-8"), ensure_ascii=False, indent=2)
print(json.dumps(check, ensure_ascii=False), agg)
for p in projects:
    print(f'{p["id"]:30} {p["status"]:12} {p["tasks"]:6.0f} {p["hours"]:8.1f}h ${p["cost_usd"]:8.2f}  {p["derived"]}')
