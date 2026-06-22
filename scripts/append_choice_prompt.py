#!/usr/bin/env python3
"""Append an INTERACTIVE CHOICES section to app_config.agent_base_prompt.

Read-modify-write against Supabase PostgREST using the service-role key. The
section is appended only if a marker is not already present (idempotent).
Does NOT print the existing prompt value — only the result of the operation.
"""
import json
import os
import re
import urllib.request
import urllib.error

ENV_PATH = os.path.join(os.path.dirname(__file__), "..", ".env.local")


def load_env(path):
    env = {}
    with open(path, "r", encoding="utf-8") as f:
        for line in f:
            line = line.strip()
            if not line or line.startswith("#") or "=" not in line:
                continue
            k, _, v = line.partition("=")
            env[k.strip()] = v.strip()
    return env


env = load_env(ENV_PATH)
BASE = env["NEXT_PUBLIC_SUPABASE_URL"].rstrip("/")
KEY = env["SUPABASE_SERVICE_ROLE_KEY"]
REST = f"{BASE}/rest/v1/app_config"

HEADERS = {
    "apikey": KEY,
    "Authorization": f"Bearer {KEY}",
    "Content-Type": "application/json",
}

MARKER = "INTERACTIVE CHOICES"

SECTION = """

## INTERACTIVE CHOICES

When you want the user to pick from a fixed set of replies, emit a hidden choice marker INSTEAD of writing the question and its options as prose. Use one marker PER QUESTION (you may emit several markers if you are asking several questions):

<!--mase-choice {"question":"<the question>","options":["<short label A>","<short label B>"],"multi":false}-->

Rules:
- Put the question text in the "question" field. Do NOT also write the same question or its options anywhere in your visible prose — the marker renders as a clickable card, so writing them again duplicates the UI.
- "options" must be short, self-contained reply labels (each one reads as a complete answer the user could send back). Keep them concise.
- Set "multi" to true ONLY when the user may legitimately pick several options at once; otherwise use false (single choice).
- The marker is an HTML comment, so it is invisible to anyone whose client does not render it — never rely on it being seen as text.
- You may still write a short lead-in sentence before the marker(s); just don't restate the question/options."""


def http(method, url, body=None):
    data = json.dumps(body).encode("utf-8") if body is not None else None
    req = urllib.request.Request(url, data=data, headers=HEADERS, method=method)
    with urllib.request.urlopen(req) as resp:
        raw = resp.read().decode("utf-8")
        return json.loads(raw) if raw else None


# 1. READ
rows = http("GET", f"{REST}?key=eq.agent_base_prompt&select=value")
if not rows:
    print("RESULT: no row with key='agent_base_prompt' found — nothing updated")
    raise SystemExit(1)

current = rows[0].get("value") or ""

if MARKER in current:
    print("RESULT: section already present — no change (idempotent skip)")
    raise SystemExit(0)

# 2. MODIFY
new_value = current.rstrip() + "\n" + SECTION

# 3. WRITE
http(
    "PATCH",
    f"{REST}?key=eq.agent_base_prompt",
    {"value": new_value},
)

# Verify length grew by the section size (sanity check without printing content)
check = http("GET", f"{REST}?key=eq.agent_base_prompt&select=value")
new_len = len(check[0].get("value") or "")
print(
    f"RESULT: appended INTERACTIVE CHOICES section. "
    f"old_len={len(current)} new_len={new_len} delta={new_len - len(current)} "
    f"marker_now_present={MARKER in (check[0].get('value') or '')}"
)
