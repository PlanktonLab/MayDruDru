
from app.ai import fake
from app.ai.schemas import IntentResult, ReplicaOutput, StructureAnalysis
from app.security import create_token, decode_token, generate_api_key, hash_api_key, hash_password, verify_password

PLATS = [
    {"id": "p1", "display_name": "玉山銀行 行動銀行 App", "brand": "玉山銀行", "channel": "mobile_app", "aliases": ["玉山", "esun"]},
    {"id": "p2", "display_name": "玉山銀行 網路銀行", "brand": "玉山銀行", "channel": "web", "aliases": []},
    {"id": "p3", "display_name": "國泰世華 CUBE App", "brand": "國泰世華", "channel": "mobile_app", "aliases": ["國泰"]},
]
GOALS = [{"id": "g1", "name": "信用卡消費紀錄", "aliases": ["刷卡紀錄"]}, {"id": "g2", "name": "存摺封面", "aliases": []}]


def test_fake_intent_channel_ambiguity():
    r = fake.respond("intent", IntentResult, "", [], {"platforms": PLATS, "goals": GOALS, "text": "玉山 刷卡紀錄"})
    assert r.channel_ambiguous and "channel" in r.needs and r.goal_id == "g1"
    r2 = fake.respond("intent", IntentResult, "", [], {"platforms": PLATS, "goals": GOALS, "text": "玉山 app 信用卡消費紀錄"})
    assert r2.platform_id == "p1" and r2.needs == []
    r3 = fake.respond("intent", IntentResult, "", [], {"platforms": PLATS, "goals": GOALS, "text": "我要存摺"})
    assert "platform" in r3.needs and r3.goal_id == "g2"


def test_fake_replica_is_self_contained():
    s = fake.respond("structure", StructureAnalysis, "", [b"img"], {"focus_boxes": [{"id": "a"}], "theme": "light"})
    r = fake.respond("replica", ReplicaOutput, "", [b"img"], {"structure": s.model_dump(), "focus_boxes": [], "width": 390, "theme": "dark"})
    assert "<html" in r.html and "http" not in r.html and "<script" not in r.html
    assert "王小明" not in r.html


def test_fake_embedding_similarity():
    a, b, c = fake.embed("帳戶總覽 交易明細 綠色", 256), fake.embed("帳戶總覽 交易明細 綠", 256), fake.embed("完全不同的東西 zzz", 256)
    dot = lambda x, y: sum(i * j for i, j in zip(x, y))
    assert dot(a, b) > dot(a, c)


def test_password_and_tokens():
    h = hash_password("secret123")
    assert verify_password("secret123", h) and not verify_password("nope", h)
    t = create_token("u1", "t1", "admin")
    assert decode_token(t)["tid"] == "t1"
    raw, prefix, digest = generate_api_key()
    assert raw.startswith(prefix) and hash_api_key(raw) == digest


def test_fake_replica_passes_static_safety_check():
    from app.ai.checks import unsafe_html_problems

    s = fake.respond("structure", StructureAnalysis, "", [b"img"], {"focus_boxes": [], "theme": "light"})
    r = fake.respond("replica", ReplicaOutput, "", [b"img"], {"structure": s.model_dump(), "focus_boxes": [], "width": 390, "theme": "light"})
    assert unsafe_html_problems(r.html) == []
