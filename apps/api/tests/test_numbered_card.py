import pytest
from app.services import numbered_card as nc
from app.services.stepcard import build_card_html, default_layout


def _card(number, **layout_changes):
    layout = default_layout(390, 800)
    for k, v in layout_changes.items():
        layout[k] |= v
    html, _ = build_card_html(replica_html="<html></html>", replica_w=390, replica_h=800, annotations=[], title="t",
                              instruction="i", layout=layout, step_number=number)
    return html


def test_keys_sit_next_to_the_base_card():
    assert nc.html_key_for("cards/t1/abc.png") == "cardhtml/t1/abc.html"
    assert nc.html_key_for(None) is None and nc.html_key_for("previews/t1/abc.jpg") is None
    assert nc.numbered_keys("cards/t1/abc.png", 3) == ("cards/t1/abc-n3.png", "previews/t1/abc-n3.jpg")


def test_the_number_is_a_one_token_change():
    html = _card(4)
    out = nc.with_step_number(html, 2)
    assert out is not None and '--step-num:"2";' in out and '--step-num:"4"' not in out
    assert out.replace('--step-num:"2"', '--step-num:"4"') == html  # nothing else moved
    # already that number, no number on the card, or numbers hidden by the layout: nothing to draw
    assert nc.with_step_number(html, 4) is None
    assert nc.with_step_number(_card(None), 2) is None
    assert nc.with_step_number(_card(4, title={"number": False}), 2) is None


async def test_numbered_card_falls_back_to_the_base_card(monkeypatch):
    base = {"stepcard_key": "cards/t1/abc.png", "stepcard_preview_key": "previews/t1/abc.jpg"}
    # a snapshot from before pages were kept, or a card whose page is gone: the base card, untouched
    assert await nc.numbered_card({k: v for k, v in base.items() if k != "stepcard_key"}, 2) == {k: v for k, v in base.items() if k != "stepcard_key"}
    monkeypatch.setattr(nc.storage, "exists", lambda bucket, key: False)
    assert await nc.numbered_card(base, 2) == base
    # the copy exists already: no render, just its keys
    monkeypatch.setattr(nc.storage, "exists", lambda bucket, key: key.endswith("-n2.png"))
    out = await nc.numbered_card(base, 2)
    assert out["stepcard_key"] == "cards/t1/abc-n2.png" and out["stepcard_preview_key"] == "previews/t1/abc-n2.jpg"


async def test_numbered_card_renders_once_and_caches(monkeypatch):
    base = {"stepcard_key": "cards/t1/abc.png", "stepcard_preview_key": "previews/t1/abc.jpg"}
    store: dict[str, bytes] = {"cardhtml/t1/abc.html": _card(5).encode()}
    rendered: list[tuple[str, int]] = []
    monkeypatch.setattr(nc.storage, "exists", lambda bucket, key: key in store)
    monkeypatch.setattr(nc.storage, "get_private", lambda key: store[key])
    monkeypatch.setattr(nc.storage, "put", lambda bucket, key, data, ctype: store.__setitem__(key, data))

    async def fake_render(html, width, scale=2):
        rendered.append((html, width))
        return b"\x89PNG", width, 100
    monkeypatch.setattr(nc, "render_html", fake_render)
    monkeypatch.setattr(nc, "make_preview", lambda png, edge: b"jpg")

    out = await nc.numbered_card(base, 2)
    assert out["stepcard_key"] == "cards/t1/abc-n2.png"
    assert len(rendered) == 1 and '--step-num:"2"' in rendered[0][0] and rendered[0][1] == default_layout(390, 800)["canvas"]["w"]
    assert store["cards/t1/abc-n2.png"] == b"\x89PNG" and store["previews/t1/abc-n2.jpg"] == b"jpg"
    await nc.numbered_card(base, 2)
    assert len(rendered) == 1  # cached
    # the base card already shows 5: no copy, no render
    assert await nc.numbered_card(base, 5) == base and len(rendered) == 1

    async def broken(html, width, scale=2):
        raise RuntimeError("renderer down")
    monkeypatch.setattr(nc, "render_html", broken)
    assert await nc.numbered_card(base, 3) == base  # never in the citizen's way


@pytest.mark.parametrize("n", [0, -1])
async def test_numbered_card_ignores_bad_numbers(n):
    base = {"stepcard_key": "cards/t1/abc.png"}
    assert await nc.numbered_card(base, n) == base
