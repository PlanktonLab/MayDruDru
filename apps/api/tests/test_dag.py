from app.dag import paths_from_start, step_number, validate_dag


def test_valid_chain():
    assert validate_dag(["a", "b", "c"], [("a", "b"), ("b", "c")], ["a"], ["c"]) == []


def test_cycle_detected():
    errs = validate_dag(["a", "b"], [("a", "b"), ("b", "a")], ["a"], ["b"])
    assert any("循環" in e for e in errs)


def test_needs_single_start():
    assert any("起點" in e for e in validate_dag(["a", "b"], [("a", "b")], [], ["b"]))
    assert any("起點" in e for e in validate_dag(["a", "b"], [("a", "b")], ["a", "b"], ["b"]))


def test_unreachable_and_missing_end():
    errs = validate_dag(["a", "b", "c"], [("a", "b")], ["a"], [])
    assert any("無法從起點到達" in e for e in errs)
    assert any("終點" in e for e in errs)


def test_branching_ok():
    edges = [("a", "b"), ("a", "c"), ("b", "d"), ("c", "d")]
    assert validate_dag(["a", "b", "c", "d"], edges, ["a"], ["d"]) == []
    assert paths_from_start(edges, "a") == {"a", "b", "c", "d"}


def test_edge_errors_reported_once():
    errs = validate_dag(["a", "b"], [("a", "x"), ("a", "y"), ("a", "b")], ["a"], ["b"])
    assert errs.count("有邊連到不存在的步驟") == 1


def test_step_number_follows_the_longest_path():
    # s → a → c, s → b → d → c: c comes after both branches
    edges = [("s", "a"), ("a", "c"), ("s", "b"), ("b", "d"), ("d", "c")]
    assert [step_number(edges, "s", i) for i in ("s", "a", "b", "d", "c")] == [1, 2, 2, 3, 4]
    assert step_number(edges, "s", "x") is None
    assert step_number([("s", "a"), ("a", "s")], "s", "a") is None
