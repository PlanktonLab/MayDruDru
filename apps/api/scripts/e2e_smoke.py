"""End-to-end smoke test / demo seeder.

Runs the whole content pipeline and the public API against a live stack
(api + worker + renderer + postgres/redis/minio). Works with
LLM_PROVIDER=fake (no network) or a real key.

    .venv/bin/python scripts/e2e_smoke.py [BASE_URL]
"""
import json
import os
import pathlib
import sys
import time

import httpx

B = sys.argv[1] if len(sys.argv) > 1 else os.environ.get("SOP_BASE_URL", "http://localhost:8000")
ROOT = str(pathlib.Path(__file__).resolve().parents[2] / "UImockup")
OUT = pathlib.Path(os.environ.get("SOP_E2E_OUT", "/tmp"))
PW = os.environ.get("SOP_E2E_PASSWORD", "pass1234-demo")  # >= 12 chars (member password policy)
c = httpx.Client(base_url=B, timeout=60)

def j(r):
    if r.status_code >= 400:
        print("ERR", r.request.method, r.request.url, r.status_code, r.text[:500]); sys.exit(1)
    return r.json()

st = j(c.get("/api/auth/bootstrap-status"))
if st["needs_bootstrap"]:
    tok = j(c.post("/api/auth/bootstrap", json={"tenant_name":"新竹市政府","tenant_slug":"hsinchu","owner_email":"owner@example.com","owner_password":PW}))["access_token"]
else:
    tok = j(c.post("/api/auth/login", json={"email":"owner@example.com","password":PW}))["access_token"]
c.headers["Authorization"] = f"Bearer {tok}"
me = j(c.get("/api/auth/me")); print("me:", me["email"], me["role"])

goals = j(c.get("/api/goals"))
if not goals:
    goals = [j(c.post("/api/goals", json={"name":"信用卡消費紀錄","aliases":["刷卡紀錄","消費明細"]})),
             j(c.post("/api/goals", json={"name":"存摺封面","aliases":["存摺"]}))]
goal = goals[0]
plats = j(c.get("/api/platforms"))
if not plats:
    plats = [j(c.post("/api/platforms", json={"display_name":"玉山銀行 行動銀行 App","brand":"玉山銀行","channel":"mobile_app","aliases":["玉山","esun"],"canvas_x":100,"canvas_y":100})),
             j(c.post("/api/platforms", json={"display_name":"玉山銀行 網路銀行","brand":"玉山銀行","channel":"web","aliases":["玉山網銀"],"canvas_x":900,"canvas_y":100})),
             j(c.post("/api/platforms", json={"display_name":"國泰世華 CUBE App","brand":"國泰世華","channel":"mobile_app","aliases":["國泰","cube"],"canvas_x":100,"canvas_y":900}))]
esun = next(p for p in plats if p["display_name"].startswith("玉山銀行 行動"))
canvas = j(c.get("/api/canvas"))
flow = next((f for f in canvas["flows"] if f["platform_id"]==esun["id"] and goal["id"] in f["goal_ids"]), None) \
    or next((f for f in canvas["flows"] if f["platform_id"]==esun["id"]), None)
if not flow:
    flow = j(c.post("/api/flows", json={"platform_id":esun["id"],"name":"查信用卡消費紀錄"}))
canvas = j(c.get("/api/canvas"))
steps = [s for s in canvas["steps"] if s["flow_id"]==flow["id"]]
if len(steps) < 2:
    s1 = steps[0]
    j(c.patch(f"/api/steps/{s1['id']}", json={"title":"開啟帳戶總覽","instruction":"登入後點選下方「帳戶」，找到信用卡區塊"}))
    # the 終點 names the document the citizen holds there — that is how the flow is found for a goal
    s2 = j(c.post("/api/steps", json={"flow_id":flow["id"],"title":"進入交易明細","instruction":"點「交易明細」，截圖需包含日期與金額","canvas_x":420,"canvas_y":220,"is_end":True,"goal_id":goal["id"]}))
    j(c.post("/api/edges", json={"flow_id":flow["id"],"from_step_id":s1["id"],"to_step_id":s2["id"]}))
canvas = j(c.get("/api/canvas"))
steps = sorted([s for s in canvas["steps"] if s["flow_id"]==flow["id"]], key=lambda s: not s["is_start"])
print("steps:", [(s["title"], s["is_start"], s["is_end"]) for s in steps])
print("validate:", j(c.get(f"/api/flows/{flow['id']}/validate")))

def wait(vid, statuses, timeout=180):
    t0=time.time()
    while time.time()-t0 < timeout:
        v = j(c.get(f"/api/variants/{vid}"))
        if v["status"] in statuses: return v
        if v["status"] == "failed": print("FAILED:", v["error"]); sys.exit(1)
        time.sleep(1.5)
    print("timeout waiting", statuses, v["status"], v["progress"]); sys.exit(1)

for s, img in zip(steps, ["ESUN_UI.png", "Cathay_UI.png"]):
    v = next(x for x in s["variants"] if x["theme"]=="light")
    if v["status"] == "completed":
        print("variant already completed", s["title"]); continue
    vid = v["id"]
    with open(f"{ROOT}/{img}","rb") as f:
        j(c.post(f"/api/variants/{vid}/original", files={"file": (img, f, "image/png")}))
    print(" original viewable:", c.get(f"/api/variants/{vid}/original.png").status_code)
    j(c.put(f"/api/variants/{vid}/focus-boxes", json={"boxes":[{"id":"fb1","type":"data_region","x":0.05,"y":0.3,"w":0.9,"h":0.25},{"id":"fb2","type":"keep_text","x":0.1,"y":0.05,"w":0.5,"h":0.06}]}))
    j(c.post(f"/api/variants/{vid}/process"))
    v = wait(vid, ["pending_review"]); print(" pending_review, attempts", v["attempts"], "check ok", v["check_report"]["ok"], "kept", v["kept_texts"][:3])
    print(" review queue:", len(j(c.get("/api/review/queue"))))
    # 假資料同步 (SPEC §6.5): keep what the replica had to invent, so the next screen reuses it
    fresh = [f for f in v["fake_data"] if f.get("source") == "new"]
    print(" fake data:", len(v["fake_data"]), "new:", [f["label"] for f in fresh][:4])
    if fresh:
        j(c.post(f"/api/variants/{vid}/fake-data", json={"adopt": [{"key": "", "label": f["label"], "value": f["value"]} for f in fresh]}))
        demo = next(p for p in j(c.get("/api/platforms")) if p["id"] == esun["id"])["demo_data"]
        print(" adopted -> 示範資料:", [f["label"] for f in demo])
    j(c.post(f"/api/variants/{vid}/review", json={"decision":"regenerate","feedback":"色塊太少，請把清單全部色塊化"}))
    v = wait(vid, ["pending_review"]); print(" regenerated -> pending_review again, history", len(v["review_history"]))
    j(c.post(f"/api/variants/{vid}/review", json={"decision":"approve"}))
    v = wait(vid, ["annotating"]); print(" approved; original kept?", v["has_original"], "desc:", v["description"][:60])
    j(c.put(f"/api/variants/{vid}/annotations", json={"annotations":[
        {"id":"a1","type":"tap","number":1,"label":"點選「交易明細」","x":0.1,"y":0.4,"w":0.3,"h":0.06},
        {"id":"a2","type":"capture","number":2,"label":"截圖須包含這一區","x":0.05,"y":0.5,"w":0.9,"h":0.2},
        {"id":"a3","type":"input","number":3,"label":"輸入查詢月份","x":0.1,"y":0.75,"w":0.5,"h":0.06,"example_text":"2026/09"},
        {"id":"a4","type":"gesture","number":4,"label":"往下滑到底","x":0.4,"y":0.85,"w":0.2,"h":0.1,"direction":"down"}]}))
    j(c.post(f"/api/variants/{vid}/render-card"))
    v = wait(vid, ["completed"]); print(" completed card:", v["stepcard_url"], v["stepcard_preview_url"])
    r = httpx.get(v["stepcard_url"]); print(" card fetch:", r.status_code, r.headers.get("content-type"), len(r.content))
    open(OUT / f"card_{s['title']}.png", "wb").write(r.content)

print("style doc:", json.dumps(j(c.get(f"/api/platforms/{esun['id']}/style-doc")), ensure_ascii=False)[:300])
val = j(c.get(f"/api/flows/{flow['id']}/validate")); print("validate:", val)
if val["publishable"]:
    print("publish:", j(c.post(f"/api/flows/{flow['id']}/publish"))["status"])
print("versions:", j(c.get(f"/api/flows/{flow['id']}/versions")))

# ---- public API
keys = j(c.get("/api/api-keys"))
key = j(c.post("/api/api-keys", json={"name":"line-bot"}))["plaintext"]
p = httpx.Client(base_url=B, headers={"X-API-Key": key}, timeout=60)
print("catalog platforms:", [x["display_name"] for x in j(p.get("/v1/catalog/platforms"))])
r = j(p.post("/v1/sessions", json={"external_user_id":"U123","hint":"我用玉山的 app 要找信用卡消費紀錄"})); print("session:", r["type"], r.get("step",{}).get("title"), r.get("card",{}) and r["card"]["image_url"])
sid = r["session_id"]
r = j(p.post(f"/v1/sessions/{sid}/actions", json={"action":"next"})); print("next:", r["type"], r.get("step",{}).get("title"), r["actions"] if r["type"]=="step" else "")
r = j(p.post(f"/v1/sessions/{sid}/actions", json={"action":"next"})); print("next:", r["type"], r.get("message"), r.get("suggestions"))
# ambiguous channel
r = j(p.post("/v1/sessions", json={"external_user_id":"U124","hint":"玉山 信用卡消費紀錄"})); print("ambiguous:", r["type"], r.get("kind"), [o["label"] for o in r.get("options",[])])
sid2 = r["session_id"]
r = j(p.post(f"/v1/sessions/{sid2}/actions", json={"action":"choose_option","option_id": r["options"][0]["option_id"]})); print("chose:", r["type"], r.get("step",{}).get("title"))
# screenshot locate
with open(f"{ROOT}/Cathay_UI.png","rb") as f:
    r = j(p.post(f"/v1/sessions/{sid2}/screenshots", files={"file":("s.png", f, "image/png")}))
print("locate:", r["type"], r.get("note"), r.get("step",{}).get("title"), r.get("code"))
print("status:", j(p.get(f"/v1/sessions/{sid2}")))
# no key
print("no key ->", p.get("/v1/catalog/goals", headers={"X-API-Key":"bad"}).status_code)

# ---- playground with debug
r = j(c.post("/api/playground/sessions", json={"hint":"玉山 app 刷卡紀錄","content_mode":"draft","theme":"dark"})); print("playground:", r["type"], list(r["_debug"].keys()), r["_debug"]["state"]["theme"])
# ---- eval
with open(f"{ROOT}/ESUN_UI.png","rb") as f:
    case = j(c.post("/api/evals/cases", files={"file":("e.png", f, "image/png")}, data={"platform_id": esun["id"], "step_id": steps[0]["id"], "goal_id": goal["id"], "text":"玉山 app 信用卡消費"}))
run = j(c.post("/api/evals/runs", json={"label":"smoke","content_mode":"published"}))
for _ in range(60):
    run = j(c.get(f"/api/evals/runs/{run['id']}"))
    if run["status"]=="done": break
    time.sleep(1.5)
print("eval:", run["status"], run["summary"])
print("dashboard:", {k:v for k,v in j(c.get("/api/dashboard/summary")).items() if k in ("sessions","completed","completion_rate","stuck_uploads","llm_cost_usd")})
print("ALL OK")
