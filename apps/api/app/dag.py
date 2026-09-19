"""DAG validation for flows: acyclic, exactly one start, reachable ends."""

from collections import defaultdict, deque


def paths_from_start(edges: list[tuple[str, str]], start_id: str) -> set[str]:
    """Every step reachable from the start (the start included)."""
    adj = defaultdict(list)
    for a, b in edges:
        adj[a].append(b)
    reach, stack = set(), [start_id]
    while stack:
        n = stack.pop()
        if n in reach:
            continue
        reach.add(n)
        stack.extend(adj[n])
    return reach


def step_number(edges: list[tuple[str, str]], start_id: str, step_id: str) -> int | None:
    """1-based position of a step: the longest path from the start, so a step
    after two merging branches comes after both. None when it is unreachable
    or the graph has a cycle."""
    adj = defaultdict(list)
    for a, b in edges:
        adj[a].append(b)
    reach = paths_from_start(edges, start_id)
    if step_id not in reach or _has_cycle(reach, edges):
        return None
    indeg = {i: 0 for i in reach}
    for a, b in edges:
        if a in reach and b in reach:
            indeg[b] += 1
    depth = {start_id: 1}
    q = deque(i for i in reach if indeg[i] == 0)
    while q:
        n = q.popleft()
        for m in adj[n]:
            depth[m] = max(depth.get(m, 0), depth.get(n, 1) + 1)
            indeg[m] -= 1
            if indeg[m] == 0:
                q.append(m)
    return depth.get(step_id)


def _has_cycle(ids: set[str], edges: list[tuple[str, str]]) -> bool:
    indeg = {i: 0 for i in ids}
    adj = defaultdict(list)
    for a, b in edges:
        if a in ids and b in ids:
            adj[a].append(b)
            indeg[b] += 1
    q = deque(i for i in ids if indeg[i] == 0)
    seen = 0
    while q:
        n = q.popleft()
        seen += 1
        for m in adj[n]:
            indeg[m] -= 1
            if indeg[m] == 0:
                q.append(m)
    return seen != len(ids)


def validate_dag(step_ids: list[str], edges: list[tuple[str, str]], start_ids: list[str], end_ids: list[str]) -> list[str]:
    errors: list[str] = []
    ids = set(step_ids)
    if not ids:
        return ["flow 沒有任何步驟"]
    if len(start_ids) != 1:
        errors.append(f"flow 必須恰有一個起點，目前 {len(start_ids)} 個")
    if any(a not in ids or b not in ids for a, b in edges):
        errors.append("有邊連到不存在的步驟")
    if any(a == b for a, b in edges):
        errors.append("步驟不可連到自己")
    if _has_cycle(ids, edges):
        errors.append("流程含有循環（必須是有向無環圖）")
    if start_ids:
        reach = paths_from_start([(a, b) for a, b in edges if a in ids and b in ids], start_ids[0])
        unreachable = ids - reach
        if unreachable:
            errors.append(f"有 {len(unreachable)} 個步驟無法從起點到達")
        if not end_ids:
            errors.append("flow 至少要有一個終點")
        elif not any(e in reach for e in end_ids):
            errors.append("沒有任何終點可從起點到達")
    return errors
