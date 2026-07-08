#!/usr/bin/env python3
"""Generic grader for the engineering-insights skill eval.

Unlike a code-detector skill's grader (recall/precision over file:line findings),
this interprets declarative checks from expected-outcomes.json against each run's
mutated repo. No eval-specific logic lives in this file — add a fixture + a prompt
in evals.json + an outcome block in expected-outcomes.json to add a new scenario.
"""
import json, os, re, sys

HERE = os.path.dirname(os.path.abspath(__file__))
IT = sys.argv[1] if len(sys.argv) > 1 else os.path.join(HERE, "iteration-1")
OUTCOMES_PATH = os.path.join(HERE, "expected-outcomes.json")

ENTRY_RE = re.compile(r'^\s*-\s+(?:\*\*|~~\*\*)\d{4}-\d{2}-\d{2}', re.M)
CAT_RE = re.compile(r'\*\*\d{4}-\d{2}-\d{2}\s+\[(Pattern|Mistake|Decision|Quirk)\]\*\*')


def read(repo, path):
    p = os.path.join(repo, path)
    return open(p, encoding='utf-8').read() if os.path.exists(p) else None


def entry_count(text):
    return len(ENTRY_RE.findall(text)) if text else 0


def footer_count(text):
    if not text:
        return None
    m = re.search(r'Entries:\s*(\d+)', text)
    return int(m.group(1)) if m else None


def run_check(repo, check):
    path = check.get("path")
    text = read(repo, path) if path else None
    ctype = check["type"]

    if ctype == "file_exists":
        ok = (text is not None) == check["expected"]
        ev = f"{path} exists={text is not None}"
    elif ctype == "entry_count":
        n = entry_count(text)
        ok = n == check["expected"]
        ev = f"{path} entry bullets={n} (expected {check['expected']})"
    elif ctype == "footer_count":
        n = footer_count(text)
        ok = n == check["expected"]
        ev = f"{path} footer Entries={n} (expected {check['expected']})"
    elif ctype == "contains":
        ok = check["value"] in (text or "")
        ev = f"{path} contains {check['value']!r}: {ok}"
    elif ctype == "contains_any":
        hay = (text or "")
        vals = check["values"]
        if check.get("case_insensitive"):
            hay_l = hay.lower()
            ok = any(v.lower() in hay_l for v in vals)
        else:
            ok = any(v in hay for v in vals)
        ev = f"{path} contains any of {vals}: {ok}"
    elif ctype == "bullet_count_containing":
        lines = (text or "").splitlines()
        n = sum(1 for ln in lines if re.match(r'^\s*-\s', ln) and check["value"] in ln)
        ok = n == check["expected"]
        ev = f"{path} bullets containing {check['value']!r}: {n} (expected {check['expected']})"
    elif ctype == "has_category_tag":
        ok = bool(CAT_RE.search(text or ""))
        ev = f"{path} has a dated [Category] entry header: {ok}"
    else:
        raise ValueError(f"unknown check type: {ctype}")

    return {"text": check["text"], "passed": ok, "evidence": ev}


def main():
    with open(OUTCOMES_PATH, encoding="utf-8") as f:
        outcomes = json.load(f)["outcomes"]

    for outcome in outcomes:
        n = outcome["eval_id"]
        for cfg in ("with_skill", "without_skill"):
            run = os.path.join(IT, f"eval-{n}", cfg)
            repo = os.path.join(run, "repo")
            if not os.path.isdir(repo):
                continue

            exps = [run_check(repo, c) for c in outcome["checks"]]
            passed = sum(1 for e in exps if e["passed"])
            total = len(exps)
            out = {
                "eval_id": n, "config": cfg,
                "summary": {"pass_rate": round(passed / total, 4) if total else 0.0,
                            "passed": passed, "failed": total - passed, "total": total},
                "expectations": exps,
            }

            run1 = os.path.join(run, "run-1")
            os.makedirs(run1, exist_ok=True)
            with open(os.path.join(run1, "grading.json"), "w", encoding="utf-8") as f:
                json.dump(out, f, indent=2)
            with open(os.path.join(run, "grading.json"), "w", encoding="utf-8") as f:
                json.dump(out, f, indent=2)

            tsrc = os.path.join(run, "timing.json")
            if os.path.exists(tsrc):
                dst = os.path.join(run1, "timing.json")
                if not os.path.exists(dst):
                    os.replace(tsrc, dst)

            print(f"eval-{n} {cfg}: {passed}/{total}")


if __name__ == "__main__":
    main()
