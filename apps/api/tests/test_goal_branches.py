"""Goals on 終點 steps (SPEC §5.2): reading a multi-goal flow as one straight
line per document, and the compatibility shims for snapshots published when a
flow still carried one goal."""

from app.services.content import goal_name, goals_below, relevant_edges, snapshot_goals, step_goal, straight_from, walk

from tests.test_assistant import MULTI_SNAPSHOT

OLD = {  # published before goals moved onto steps
    "flow": {"id": "f0", "name": "舊流程", "platform_id": "p", "platform_name": "P", "goal_id": "g9", "goal_name": "存摺封面", "status": "published"},
    "steps": [{"id": "a", "title": "A", "instruction": "", "is_start": True, "is_end": False, "variants": {}},
              {"id": "b", "title": "B", "instruction": "", "is_start": False, "is_end": True, "variants": {}}],
    "edges": [{"id": "e", "from": "a", "to": "b", "label": "", "sort": 0}],
}


def test_goals_below_collects_every_document_under_a_step():
    below = goals_below(MULTI_SNAPSHOT)
    assert below["m1"] == {"g2", "g3"} and below["m2"] == {"g2", "g3"}
    assert below["m3"] == {"g2"} and below["m4"] == {"g2"} and below["m5"] == {"g3"}


def test_relevant_edges_keeps_the_fork_only_while_the_goal_is_unknown():
    assert [e["id"] for e in relevant_edges(MULTI_SNAPSHOT, "m2", None)] == ["x2", "x3"]
    assert [e["id"] for e in relevant_edges(MULTI_SNAPSHOT, "m2", "g2")] == ["x2"]
    assert [e["id"] for e in relevant_edges(MULTI_SNAPSHOT, "m2", "g3")] == ["x3"]
    # a goal the flow does not deliver: nothing is hidden, the fork is still a question
    assert [e["id"] for e in relevant_edges(MULTI_SNAPSHOT, "m2", "nope")] == ["x2", "x3"]


def test_situational_fork_under_one_goal_is_still_asked():
    snap = {**MULTI_SNAPSHOT, "steps": [*MULTI_SNAPSHOT["steps"],
            {"id": "m6", "title": "帳單明細（舊版）", "instruction": "", "is_start": False, "is_end": True, "goal_id": "g2", "goal_name": "信用卡帳單", "variants": {}}],
            "edges": [*MULTI_SNAPSHOT["edges"], {"id": "x5", "from": "m3", "to": "m6", "label": "舊版介面", "sort": 1}]}
    assert [e["id"] for e in relevant_edges(snap, "m3", "g2")] == ["x4", "x5"]
    assert straight_from(snap, "m1", "g2") == ["m1", "m2", "m3"]
    assert [s["id"] for s in walk(snap, "g2")] == ["m1", "m2", "m3", "m4", "m6"]


def test_walk_can_start_mid_flow():
    assert [s["id"] for s in walk(MULTI_SNAPSHOT, "g2", start_id="m2")] == ["m2", "m3", "m4"]


def test_old_snapshot_reads_as_a_single_goal_flow():
    assert snapshot_goals(OLD) == [{"id": "g9", "name": "存摺封面"}]
    assert goal_name(OLD, "g9") == "存摺封面"
    assert step_goal(OLD, OLD["steps"][1]) == "g9" and step_goal(OLD, OLD["steps"][0]) is None
    assert goals_below(OLD)["a"] == {"g9"}
    assert snapshot_goals({"flow": {"id": "x"}, "steps": [], "edges": []}) == []
