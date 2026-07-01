import logging
from datetime import date, timedelta

import httpx

logger = logging.getLogger(__name__)


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


async def build_weather_forecast_text(
    destination: str,
    start_date: date,
    nights: int,
    api_key: str,
    lon: float,
    lat: float,
) -> str:
    """Day별 강수확률을 프롬프트 삽입용 텍스트로 반환.

    API 장애, 키 미설정 등 어떤 이유로든 실패하면
    빈 문자열을 반환 (날씨 정보 없이 루트 생성 계속, graceful fallback).
    """
    if not api_key:
        return ""

    try:
        forecast = await _get_daily_rain_probs(lat, lon, api_key)
        lines = [
            f"Day {i + 1} ({(start_date + timedelta(days=i)).isoformat()}): "
            f"강수확률 {forecast.get((start_date + timedelta(days=i)).isoformat(), 0.0):.0%}"
            for i in range(nights + 1)
        ]
        logger.info("날씨 예보 조회: %s", destination)
        return "\n".join(lines)

    except Exception as e:
        logger.warning("날씨 API 오류, 날씨 정보 없이 진행: %s", e)
        return ""
