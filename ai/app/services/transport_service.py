"""
슬롯 간 이동시간 계산 서비스.
자동차/도보는 거리 기반 근사치, 대중교통만 Tmap 대중교통 API를 실제로 호출한다.
(카카오/네이버는 도보·대중교통 오픈API가 없고, 구글은 한국 내 도보 길찾기가
정밀지도 반출 규제로 막혀 있어 Tmap 단일 벤더로 결정 — 2026-07-04)
"""
import logging

import httpx

from app.services.tsp_service import _haversine_m

logger = logging.getLogger(__name__)

_WALK_SPEED_KMH = 4.0
_CAR_SPEED_KMH = 25.0
_DETOUR_FACTOR = 1.3  # 직선거리 대비 실제 도로/보행로 왜곡 보정
_TMAP_TRANSIT_URL = "https://apis.openapi.sk.com/transit/routes"

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
    client: httpx.AsyncClient, lat1: float, lng1: float, lat2: float, lng2: float, api_key: str
) -> tuple[int, str | None, list[dict] | None] | None:
    """Tmap 대중교통 API로 소요시간(분)·노선 요약·구간별 상세를 함께 조회. 경로 없으면 None."""
    resp = await client.post(
        _TMAP_TRANSIT_URL,
        headers={"accept": "application/json", "appKey": api_key, "content-type": "application/json"},
        json={
            "startX": str(lng1), "startY": str(lat1),
            "endX": str(lng2), "endY": str(lat2),
            "count": 1, "lang": 0, "format": "json",
        },
        timeout=5.0,
    )
    resp.raise_for_status()
    itineraries = resp.json().get("metaData", {}).get("plan", {}).get("itineraries", [])
    if not itineraries:
        return None
    itinerary = itineraries[0]
    minutes = round(itinerary["totalTime"] / 60)
    return minutes, _build_transit_summary(itinerary), _build_transit_detail(itinerary)


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
            label = "walk" if distance_m < _WALK_MAX_METERS else "transit"

            minutes, summary, detail = None, None, None
            if label == "transit" and tmap_api_key:
                try:
                    result = await _tmap_transit_route(client, lat1, lng1, lat2, lng2, tmap_api_key)
                    if result is not None:
                        minutes, summary, detail = result
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
