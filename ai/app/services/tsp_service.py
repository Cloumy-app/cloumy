"""
OR-Tools TSP 동선 최적화 서비스.
Sonnet 스트리밍이 끝난 뒤 day별 슬롯을 Haversine 거리 기준으로 재정렬한다.
좌표 없는 슬롯이 있으면 해당 day는 원본 LLM 순서를 유지한다.
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

    manager = pywrapcp.RoutingIndexManager(n, 1, 0)
    routing = pywrapcp.RoutingModel(manager)

    def dist_cb(from_idx: int, to_idx: int) -> int:
        return dist_matrix[manager.IndexToNode(from_idx)][manager.IndexToNode(to_idx)]

    transit_idx = routing.RegisterTransitCallback(dist_cb)
    routing.SetArcCostEvaluatorOfAllVehicles(transit_idx)

    params = pywrapcp.DefaultRoutingSearchParameters()
    params.first_solution_strategy = routing_enums_pb2.FirstSolutionStrategy.PATH_CHEAPEST_ARC
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
    - 좌표 조회 실패 시 해당 day는 LLM 원본 순서 유지
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

        # 좌표 추출 — 하나라도 없으면 day 전체 원본 유지
        coords: list[tuple[float, float]] = []
        has_missing = False
        for s in day_slots:
            pid = str(s.get("place_id", ""))
            if pid not in coord_lookup:
                logger.warning("day=%d: place_id=%s 좌표 없음 — day 원본 순서 유지", day, pid)
                has_missing = True
                break
            coords.append(coord_lookup[pid])

        if has_missing:
            for s in day_slots:
                result.append(json.dumps(s, ensure_ascii=False) + "\n")
            continue

        order = _tsp_order(coords)
        reordered = [day_slots[i] for i in order]

        for new_order, slot in enumerate(reordered, start=1):
            slot = dict(slot)
            slot["order"] = new_order
            result.append(json.dumps(slot, ensure_ascii=False) + "\n")

        logger.info("day=%d: %d슬롯 TSP 재정렬 완료", day, len(day_slots))

    return result
