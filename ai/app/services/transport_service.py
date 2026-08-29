"""
슬롯 간 이동시간 계산 서비스.
자동차/도보는 거리 기반 근사치, 대중교통만 Tmap 대중교통 API를 실제로 호출한다.
(카카오/네이버는 도보·대중교통 오픈API가 없고, 구글은 한국 내 도보 길찾기가
정밀지도 반출 규제로 막혀 있어 Tmap 단일 벤더로 결정 — 2026-07-04)
"""
import logging
from datetime import date, datetime, time, timedelta
from zoneinfo import ZoneInfo

import httpx

from app.services.tsp_service import _haversine_m

logger = logging.getLogger(__name__)

# KST — chat_service._KST를 재사용하지 않고 이 파일 안에 독립 상수로 둔다.
# route_service가 transport_service를 임포트하고(enrich_transport), chat_service는
# route_service를 임포트한다(_anthropic). 여기서 chat_service._KST를 가져오면
# transport_service → chat_service → route_service → transport_service 순환 임포트가 된다.
# proactive_service가 chat_service._KST를 재사용하는 선례가 있지만, proactive_service는
# 이 순환 경로 밖에 있어 안전하다 — 이 파일은 그 경로 안이라 로컬 상수가 맞는 선택이다.
_KST = ZoneInfo("Asia/Seoul")

_WALK_SPEED_KMH = 4.0
_CAR_SPEED_KMH = 25.0
_DETOUR_FACTOR = 1.3  # 직선거리 대비 실제 도로/보행로 왜곡 보정
_TMAP_TRANSIT_URL = "https://apis.openapi.sk.com/transit/routes"

# find_last_departure 이분 탐색 정밀도(분). 22:00~26:00(4시간) 구간을 15분 단위로
# 좁히면 호출 5~6회로 수렴한다.
_LAST_TRANSIT_PRECISION_MIN: int = 15

# 슬롯 간 직선거리가 이 값 이하면 walk, 초과면 transit으로 자동 판단한다.
# 500m는 관광지 밀집 구역의 흔한 이동 거리(예: 북촌↔경복궁 약 1km)까지 대중교통으로
# 유도할 위험이 있고, 이런 짧은 거리는 정류장 이동·대기·환승 오버헤드 때문에
# 대중교통이 오히려 도보보다 느린 경우가 많아 1km로 설정.
_WALK_MAX_METERS = 1000

# Tmap 대중교통 API legs[].mode → 노선 요약 표시용 한글 라벨(도보는 요약에서 제외)
_TRANSIT_MODE_LABEL = {"BUS": "버스", "SUBWAY": "지하철", "TRAIN": "기차", "EXPRESSBUS": "고속버스"}


def _estimate_minutes(distance_km: float, mode: str) -> int:
    """거리 기반 근사치. mode는 'walk' 또는 그 외(자동차 취급)."""
    speed = _WALK_SPEED_KMH if mode == "walk" else _CAR_SPEED_KMH
    return max(1, round(distance_km * _DETOUR_FACTOR / speed * 60))


def _build_transit_summary(itinerary: dict) -> str | None:
    """legs 중 대중교통 구간만 추출해 '버스 143 → 지하철 2호선 (환승 1회)' 형태로 요약.
    도보 구간뿐이거나 legs 구조가 예상과 다르면 None(요약 없이 소요시간만 표시)."""
    hops = []
    for leg in itinerary.get("legs", []):
        label = _TRANSIT_MODE_LABEL.get(leg.get("mode", ""))
        if label is None:
            continue
        route = leg.get("route", "").strip()
        hops.append(f"{label} {route}".strip())

    if not hops:
        return None
    summary = " → ".join(hops)
    transfers = len(hops) - 1
    return f"{summary} (환승 {transfers}회)" if transfers > 0 else summary


def _build_transit_detail(itinerary: dict) -> list[dict] | None:
    """legs 중 대중교통 구간만 추출해 구간별 승하차 정류장/노선/소요시간을 담은 리스트로 반환.
    탭하면 펼쳐지는 상세 노선 UI용 — 실시간 도착정보는 아니고 생성 시점에 받은 정적 정보."""
    hops = []
    for leg in itinerary.get("legs", []):
        label = _TRANSIT_MODE_LABEL.get(leg.get("mode", ""))
        if label is None:
            continue
        hops.append({
            "mode": label,
            "route": leg.get("route", "").strip(),
            "board_stop": leg.get("start", {}).get("name", ""),
            "alight_stop": leg.get("end", {}).get("name", ""),
            "minutes": round(leg.get("sectionTime", 0) / 60),
        })
    return hops or None


async def _tmap_transit_route(
    client: httpx.AsyncClient, lat1: float, lng1: float, lat2: float, lng2: float, api_key: str,
    search_dttm: str | None = None,
) -> dict | None:
    """Tmap 대중교통 API로 소요시간(분)·요금·노선 요약·구간별 상세를 함께 조회. 경로 없으면 None.

    search_dttm(yyyymmddhhmi)을 넘기면 그 시각 기준 타임머신 조회(미래 시각 조회)를 한다.
    기본값 None이면 기존과 동일하게 현재 시각 기준 조회다 — enrich_transport는 이 인자를
    넘기지 않으므로 동작이 바뀌지 않는다.

    반환: {"minutes": int, "fare": int | None, "summary": str | None, "detail": list[dict] | None}
    """
    body = {
        "startX": str(lng1), "startY": str(lat1),
        "endX": str(lng2), "endY": str(lat2),
        "count": 1, "lang": 0, "format": "json",
    }
    if search_dttm is not None:
        body["searchDttm"] = search_dttm  # yyyymmddhhmi — 미래 시각 조회(타임머신)

    resp = await client.post(
        _TMAP_TRANSIT_URL,
        headers={"accept": "application/json", "appKey": api_key, "content-type": "application/json"},
        json=body,
        timeout=5.0,
    )
    resp.raise_for_status()
    itineraries = resp.json().get("metaData", {}).get("plan", {}).get("itineraries", [])
    if not itineraries:
        return None
    itinerary = itineraries[0]
    return {
        "minutes": round(itinerary["totalTime"] / 60),
        "fare": itinerary.get("fare", {}).get("regular", {}).get("totalFare"),  # 없을 수 있다
        "summary": _build_transit_summary(itinerary),
        "detail": _build_transit_detail(itinerary),
    }


async def find_last_departure(
    client: httpx.AsyncClient, lat1: float, lng1: float, lat2: float, lng2: float,
    api_key: str, base_date: date,
    search_from_hour: int = 22,
    search_to_hour: int = 26,  # 26 = 다음 날 02:00 (자정 넘김을 시각이 아니라 시간으로 표현)
) -> dict | None:
    """search_from_hour~search_to_hour(기본 22시~다음날 02시) 구간을 이분 탐색해
    경로가 존재하는 마지막 출발 시각을 찾는다.

    ⚠️ 자정 경계가 이 함수의 핵심이다. 시각을 hour 단위 float로 다루고
    base_date에 timedelta(hours=h)를 더해서 실제 datetime을 계산한다 — 이렇게 해야
    h가 24를 넘어갈 때 yyyymmdd가 자동으로 다음 날이 된다. `hour % 24`처럼 시각만
    감싸버리면 날짜가 넘어가지 않아 자정 이후 막차를 전부 놓친다.

    search_from_hour 시점에서부터 경로가 하나도 없으면(그 구간에 대중교통 자체가 없는
    경우) None을 반환한다. 이분 탐색 도중 Tmap 호출이 실패하는 등 모든 예외는 None으로
    수렴한다(enrich_transport의 기존 폴백과 같은 톤).

    반환: {"leave_by": datetime(KST aware), "minutes": int,
           "fare": int | None, "summary": str | None} / 경로를 아예 못 찾으면 None
    """
    try:
        lo, hi = float(search_from_hour), float(search_to_hour)

        def _at(hour: float) -> datetime:
            return datetime.combine(base_date, time(0, 0), tzinfo=_KST) + timedelta(hours=hour)

        lo_at = _at(lo)
        lo_route = await _tmap_transit_route(
            client, lat1, lng1, lat2, lng2, api_key, search_dttm=lo_at.strftime("%Y%m%d%H%M")
        )
        if lo_route is None:
            return None  # 탐색 시작 시각부터 경로가 없다 — 그 구간은 애초에 대중교통이 없다

        best_at, best_route = lo_at, lo_route
        while hi - lo > _LAST_TRANSIT_PRECISION_MIN / 60:
            mid = (lo + hi) / 2
            mid_at = _at(mid)
            mid_route = await _tmap_transit_route(
                client, lat1, lng1, lat2, lng2, api_key, search_dttm=mid_at.strftime("%Y%m%d%H%M")
            )
            if mid_route is not None:
                lo, best_at, best_route = mid, mid_at, mid_route  # 아직 경로가 있다 → 더 늦게
            else:
                hi = mid  # 경로가 끊겼다 → 더 이르게

        return {
            "leave_by": best_at,
            "minutes": best_route["minutes"],
            "fare": best_route["fare"],
            "summary": best_route["summary"],
        }
    except Exception as e:
        logger.warning("막차 이분 탐색 오류 — None으로 폴백: %s", e)
        return None


async def enrich_transport(
    ordered_slots: list[dict],
    coord_lookup: dict[str, tuple[float, float]],
    tmap_api_key: str,
) -> list[dict]:
    """TSP로 이미 정렬된 하루치 슬롯에 slot[i] -> slot[i+1] 구간 이동시간을 채운다.

    각 구간의 직선거리로 walk/transit을 자동 판단한다(_WALK_MAX_METERS 이하=walk).
    대중교통 API가 실패하면(키 미설정 포함) 거리 근사치로 폴백해서
    "정보 없음"보다는 대략적인 값을 보여준다.
    """
    async with httpx.AsyncClient() as client:
        for i in range(len(ordered_slots) - 1):
            id_a = str(ordered_slots[i].get("place_id", ""))
            id_b = str(ordered_slots[i + 1].get("place_id", ""))
            if id_a not in coord_lookup or id_b not in coord_lookup:
                continue
            lat1, lng1 = coord_lookup[id_a]
            lat2, lng2 = coord_lookup[id_b]

            distance_m = _haversine_m(lat1, lng1, lat2, lng2)
            label = "walk" if distance_m <= _WALK_MAX_METERS else "transit"

            minutes, summary, detail = None, None, None
            if label == "transit" and tmap_api_key:
                try:
                    result = await _tmap_transit_route(client, lat1, lng1, lat2, lng2, tmap_api_key)
                    if result is not None:
                        minutes, summary, detail = result["minutes"], result["summary"], result["detail"]
                        # fare는 이번 범위에서 route_slots에 저장하지 않는다(요금 UI 표기는 범위 밖) —
                        # find_last_departure를 통해서만 소비된다.
                except Exception as e:
                    logger.warning("Tmap 대중교통 API 오류 — 근사치로 폴백: %s", e)

            if minutes is None:
                distance_km = distance_m / 1000
                minutes = _estimate_minutes(distance_km, label)

            ordered_slots[i]["transport_to_next"] = label
            ordered_slots[i]["transport_minutes"] = minutes
            ordered_slots[i]["transit_summary"] = summary
            ordered_slots[i]["transit_detail"] = detail

    return ordered_slots
