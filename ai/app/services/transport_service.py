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

# routes.transport_mode(walk/car/transit) → route_slots.transport_to_next 허용값 매핑
# DB CHECK 제약이 'car'가 아니라 'taxi'를 요구함(V4 마이그레이션 기존 설계)
_MODE_TO_SLOT_LABEL = {"walk": "walk", "car": "taxi", "transit": "transit"}

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


async def _tmap_transit_route(
    client: httpx.AsyncClient, lat1: float, lng1: float, lat2: float, lng2: float, api_key: str
) -> tuple[int, str | None] | None:
    """Tmap 대중교통 API로 소요시간(분)과 노선 요약을 함께 조회. 경로 없으면 None."""
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
    return minutes, _build_transit_summary(itinerary)


async def enrich_transport(
    ordered_slots: list[dict],
    coord_lookup: dict[str, tuple[float, float]],
    transport_mode: str | None,
    tmap_api_key: str,
) -> list[dict]:
    """TSP로 이미 정렬된 하루치 슬롯에 slot[i] -> slot[i+1] 구간 이동시간을 채운다.

    transport_mode가 없으면(대부분의 기존 호출자) 아무것도 안 하고 그대로 반환 —
    완전 하위호환. 대중교통 API가 실패하면(키 미설정 포함) 거리 근사치로 폴백해서
    "정보 없음"보다는 대략적인 값을 보여준다(도보/자동차와 UX 일관성).
    """
    if not transport_mode:
        return ordered_slots

    label = _MODE_TO_SLOT_LABEL[transport_mode]
    async with httpx.AsyncClient() as client:
        for i in range(len(ordered_slots) - 1):
            id_a = str(ordered_slots[i].get("place_id", ""))
            id_b = str(ordered_slots[i + 1].get("place_id", ""))
            if id_a not in coord_lookup or id_b not in coord_lookup:
                continue
            lat1, lng1 = coord_lookup[id_a]
            lat2, lng2 = coord_lookup[id_b]

            minutes, summary = None, None
            if transport_mode == "transit" and tmap_api_key:
                try:
                    result = await _tmap_transit_route(client, lat1, lng1, lat2, lng2, tmap_api_key)
                    if result is not None:
                        minutes, summary = result
                except Exception as e:
                    logger.warning("Tmap 대중교통 API 오류 — 근사치로 폴백: %s", e)

            if minutes is None:
                distance_km = _haversine_m(lat1, lng1, lat2, lng2) / 1000
                minutes = _estimate_minutes(distance_km, "walk" if transport_mode == "walk" else "car")

            ordered_slots[i]["transport_to_next"] = label
            ordered_slots[i]["transport_minutes"] = minutes
            ordered_slots[i]["transit_summary"] = summary

    return ordered_slots
