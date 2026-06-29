import logging
from datetime import date, timedelta

import httpx
from langchain_core.documents import Document

logger = logging.getLogger(__name__)

# 강수확률이 이 값을 초과하면 야외/실내 가중치 조정 적용
_RAIN_THRESHOLD = 0.6

OUTDOOR_TAGS = {"야외", "해변", "공원", "등산", "산", "바다", "호수", "전망대", "테마파크"}
INDOOR_TAGS = {"실내", "박물관", "미술관", "카페", "식당", "쇼핑몰", "쇼핑", "수족관", "영화관"}


async def _get_daily_rain_probs(
    lat: float,
    lon: float,
    api_key: str,
) -> dict[str, float]:
    """OpenWeatherMap /forecast로 날짜별 최대 강수확률 반환.
    반환 형식: {"2026-07-01": 0.64, "2026-07-02": 0.20, ...}
    """
    async with httpx.AsyncClient(timeout=5.0) as client:
        resp = await client.get(
            "https://api.openweathermap.org/data/2.5/forecast",
            params={
                "lat": lat,
                "lon": lon,
                "appid": api_key,
                "units": "metric",
                "cnt": 40,  # 5일 × 8회 (3시간 간격)
            },
        )
        resp.raise_for_status()

    daily: dict[str, float] = {}
    for item in resp.json().get("list", []):
        date_str = item["dt_txt"][:10]  # "2026-07-01 09:00:00" → "2026-07-01"
        pop = float(item.get("pop", 0.0))
        daily[date_str] = max(daily.get(date_str, 0.0), pop)
    return daily


async def apply_weather_weights(
    candidates: list[Document],
    destination: str,
    start_date: date,
    nights: int,
    api_key: str,
    city_centers: dict[str, tuple[float, float]],  # (lon, lat) 순서
) -> list[Document]:
    """강수확률 60% 초과 시 야외 하향(×0.3) / 실내 상향(×1.5) 후 재정렬.

    API 장애, 키 미설정, 미지원 도시 등 어떤 이유로든 실패하면
    candidates 원본을 그대로 반환 (graceful fallback).
    """
    if not api_key or destination not in city_centers:
        return candidates

    try:
        lon, lat = city_centers[destination]  # CITY_CENTERS는 (lon, lat) 순서
        forecast = await _get_daily_rain_probs(lat, lon, api_key)

        travel_dates = [
            (start_date + timedelta(days=i)).isoformat()
            for i in range(nights + 1)
        ]
        probs = [forecast.get(d, 0.0) for d in travel_dates]
        avg_prob = sum(probs) / len(probs) if probs else 0.0

        if avg_prob <= _RAIN_THRESHOLD:
            return candidates  # 맑은 날씨 — 조정 불필요

        # 강수확률 60% 초과 → 야외 하향 / 실내 상향
        for doc in candidates:
            raw_tags = doc.metadata.get("category_tags", [])
            tags = set(raw_tags) if isinstance(raw_tags, list) else set(str(raw_tags).split(","))

            if tags & OUTDOOR_TAGS:
                doc.metadata["_weather_score"] = 0.3
            elif tags & INDOOR_TAGS:
                doc.metadata["_weather_score"] = 1.5
            else:
                doc.metadata["_weather_score"] = 1.0

        candidates.sort(key=lambda d: d.metadata.get("_weather_score", 1.0), reverse=True)
        logger.info("날씨 가중치 적용: %s 강수확률 %.0f%%", destination, avg_prob * 100)

    except Exception as e:
        logger.warning("날씨 API 오류, 가중치 조정 스킵: %s", e)

    return candidates
