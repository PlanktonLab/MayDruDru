from types import SimpleNamespace

from app.services.card_context import TENANT_LAYOUT_KEY, merge_layout, resolve_layouts
from app.services.stepcard import default_layout


def _variant(patch=None):
    return SimpleNamespace(replica_width=390, replica_height=844, stepcard_layout=patch, annotations=[])


def test_template_then_built_in_with_the_step_patch_laid_over():
    built_in = default_layout(390, 844)
    assert resolve_layouts(_variant(), None, "mobile_app") == (built_in, built_in, {}, built_in)

    template = {**built_in, "canvas": {**built_in["canvas"], "w": 1600, "h": 1200}}
    tenant = SimpleNamespace(settings={TENANT_LAYOUT_KEY: {"mobile_app": template}})
    assert resolve_layouts(_variant(), tenant, "mobile_app")[:2] == (template, template)
    assert resolve_layouts(_variant(), tenant, "web")[0] == default_layout(390, 844, "web")  # other channel: untouched

    # a step keeps only what it changed; the template still decides the rest
    patch = {"v": 2, "frame": {"h": 500, "zoom": 1.5}, "text": {"align": "center"}}
    layout, tpl, stored, _ = resolve_layouts(_variant(patch), tenant, "mobile_app")
    assert tpl == template and stored == patch
    assert layout["frame"] == {**template["frame"], "h": 500, "zoom": 1.5}
    assert layout["text"] == {**template["text"], "align": "center"}
    assert layout["canvas"] == template["canvas"] and layout["list"] == template["list"]


def test_merge_never_touches_the_template_and_ignores_unknown_blocks():
    template = default_layout(390, 844)
    before = {k: dict(v) if isinstance(v, dict) else v for k, v in template.items()}
    merged = merge_layout(template, {"v": 2, "frame": {"zoom": 2.0}, "nope": {"x": 1}})
    assert template == before and merged["frame"]["zoom"] == 2.0 and "nope" not in merged


def test_invalid_or_old_stored_layouts_are_ignored():
    tenant = SimpleNamespace(settings={TENANT_LAYOUT_KEY: {"mobile_app": {"canvas": {"w": 10}}}})
    built_in = default_layout(390, 844)
    assert resolve_layouts(_variant({"nope": 1}), tenant, "mobile_app")[0] == built_in
    # the shape before v2 stored absolute title/list boxes: dropped, not converted
    old = {"canvas": built_in["canvas"], "frame": built_in["frame"], "title": {"x": 1, "y": 2, "w": 300, "size": 40, "align": "center"},
           "list": {"x": 1, "y": 2, "w": 300, "size": 20, "icon": 40, "gap": 8}}
    assert resolve_layouts(_variant(old), SimpleNamespace(settings={TENANT_LAYOUT_KEY: {"mobile_app": old}}), "mobile_app")[0] == built_in
    # a patch of the right shape but bad values is dropped as a whole
    assert resolve_layouts(_variant({"v": 2, "frame": {"zoom": 99}}), None, "mobile_app")[2] == {}
