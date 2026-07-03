"""
OR-Tools TSP 동선 최적화 서비스.
Sonnet 스트리밍이 끝난 뒤 day별 슬롯을 Haversine 거리 기준으로 재정렬한다.
좌표 없는 슬롯은 최적화 대상에서 제외하고 순서 뒤쪽에 붙인다.
"""
import json
import logging
import math

from ortools.constraint_solver import pywrapcp, routing_enums_pb2

logger = logging.getLogger(__name__)

TSP_TIME_LIMIT_SECONDS = 3  # day당 TSP 제한 시간


def _haversine_m(lat1: float, lng1: float, lat2: float, lng2: float) -> int:
    """두 WGS-84 좌표 간 직선 거리(미터, 정수)를 반환한다."""
    R = 6_371_000
    dlat = math.radians(lat2 - lat1)
    dlng = math.radians(lng2 - lng1)
    a = (
        math.sin(dlat / 2) ** 2
        + math.cos(math.radians(lat1))
        * math.cos(math.radians(lat2))
        * math.sin(dlng / 2) ** 2
    )
    return int(R * 2 * math.asin(math.sqrt(max(0.0, a))))


def _tsp_order(coords: list[tuple[float, float]]) -> list[int]:
    """
    (lat, lng) 좌표 리스트의 최적 방문 순서 인덱스를 반환한다.
    OR-Tools PATH_CHEAPEST_ARC, 3초 제한.
    해를 못 찾으면 원본 순서(range(n))를 반환한다.
    """
    n = len(coords)
    if n <= 2:
        return list(range(n))

    dist_matrix = [
        [_haversine_m(*coords[i], *coords[j]) for j in range(n)]
        for i in range(n)
    ]

    # 편도(open-path) 최적화: 하루 일정은 왕복이 아니므로 "마지막 지점 -> 시작점"
    # 복귀 비용이 없어야 한다. 비용 0인 더미 종점 노드(인덱스 n)를 추가해
    # 시작=0번(기존과 동일), 끝=더미로 고정하면 복귀 비용 없이 최단 편도 경로를 얻는다.
    for row in dist_matrix:
        row.append(0)
    dist_matrix.append([0] * (n + 1))

    manager = pywrapcp.RoutingIndexManager(n + 1, 1, [0], [n])
    routing = pywrapcp.RoutingModel(manager)

    def dist_cb(from_idx: int, to_idx: int) -> int:
        return dist_matrix[manager.IndexToNode(from_idx)][manager.IndexToNode(to_idx)]

    transit_idx = routing.RegisterTransitCallback(dist_cb)
    routing.SetArcCostEvaluatorOfAllVehicles(transit_idx)

    params = pywrapcp.DefaultRoutingSearchParameters()
    params.first_solution_strategy = routing_enums_pb2.FirstSolutionStrategy.PATH_CHEAPEST_ARC
    # local_search_metaheuristic 없이는 첫 해(그리디)가 나오는 즉시 반환되어 time_limit이
    # 사실상 무시된다 — 마지막에 멀리 남은 노드를 억지로 방문하는 비효율 경로가 생기는 원인.
    # GUIDED_LOCAL_SEARCH로 2-opt/Or-opt류 개선 탐색을 time_limit 동안 수행하게 한다.
    params.local_search_metaheuristic = routing_enums_pb2.LocalSearchMetaheuristic.GUIDED_LOCAL_SEARCH
    params.time_limit.seconds = TSP_TIME_LIMIT_SECONDS
    params.log_search = False

    solution = routing.SolveWithParameters(params)
    if solution is None:
        logger.warning("TSP 해 없음 — 원본 순서 유지 (n=%d)", n)
        return list(range(n))

    order: list[int] = []
    idx = routing.Start(0)
    while not routing.IsEnd(idx):
        order.append(manager.IndexToNode(idx))
        idx = solution.Value(routing.NextVar(idx))
    return order


def reorder_slots(
    collected: list[str],
    coord_lookup: dict[str, tuple[float, float]],  # {place_id: (lat, lng)}
) -> list[str]:
    """
    ndjson 슬롯 리스트를 day별 TSP 최적 순서로 재정렬해 반환한다.
    - day 단위로 분리해 각각 독립적으로 최적화
    - 좌표 있는 슬롯만 TSP로 재정렬하고, 좌표 없는 슬롯은 원본 상대순서를 유지한 채 뒤에 붙인다
    - order 필드를 1부터 재할당
    """
    # 파싱
    slots: list[dict] = []
    for line in collected:
        try:
            slots.append(json.loads(line.strip()))
        except json.JSONDecodeError:
            logger.warning("TSP 슬롯 파싱 실패 — 건너뜀: %.60s", line)

    if not slots:
        return collected

    # day별 그룹화 (원래 입력 순서 유지)
    days = list(dict.fromkeys(s.get("day", 1) for s in slots))
    result: list[str] = []

    for day in days:
        day_slots = [s for s in slots if s.get("day") == day]

        if len(day_slots) <= 1:
            for s in day_slots:
                result.append(json.dumps(s, ensure_ascii=False) + "\n")
            continue

        # 좌표 있는 슬롯만 TSP 대상으로 분리 (원본 상대순서 유지)
        with_coords = [s for s in day_slots if str(s.get("place_id", "")) in coord_lookup]
        without_coords = [s for s in day_slots if str(s.get("place_id", "")) not in coord_lookup]

        if without_coords:
            missing_ids = [str(s.get("place_id", "")) for s in without_coords]
            logger.warning(
                "day=%d: 좌표 없는 슬롯 %d건(%s) — 해당 슬롯 제외하고 TSP 최적화, 뒤에 추가",
                day, len(without_coords), missing_ids,
            )

        if len(with_coords) >= 2:
            coords = [coord_lookup[str(s["place_id"])] for s in with_coords]
            order = _tsp_order(coords)
            with_coords = [with_coords[i] for i in order]

        final = with_coords + without_coords
        for new_order, slot in enumerate(final, start=1):
            slot = dict(slot)
            slot["order"] = new_order
            result.append(json.dumps(slot, ensure_ascii=False) + "\n")

        logger.info("day=%d: %d슬롯 TSP 재정렬 완료 (좌표없음 %d건)", day, len(day_slots), len(without_coords))

    return result
