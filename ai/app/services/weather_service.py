import logging
from datetime import date, timedelta

import httpx

logger = logging.getLogger(__name__)

FORECAST_WINDOW_DAYS = 5  # OpenWeatherMap 무료 티어 /forecast 제공 범위
_RAIN_THRESHOLD = 0.6
_BLOCK_HOURS = {"오전": range(6, 12), "오후": range(12, 18), "저녁": range(18, 24)}


def _hour_to_block(hour: int) -> str | None:
    for block, hours in _BLOCK_HOURS.items():
        if hour in hours:
            return block
    return None  # 00~05시는 여행 활동 시간대 아님


async def _get_forecast_by_block(
    lat: float,
    lon: float,
    api_key: str,
) -> dict[str, dict[str, float]]:
    """OpenWeatherMap /forecast를 오전/오후/저녁 블록별 최대 강수확률로 집계.
    반환 형식: {"2026-07-01": {"오후": 0.8, "저녁": 0.3}, ...}
    """
    async with httpx.AsyncClient(timeout=5.0) as client:
        resp = await client.get(
            "https://api.openweathermap.org/data/2.5/forecast",
            params={
                "lat": lat,
                "lon": lon,
                "appid": api_key,
                "units": "metric",
                "cnt": 8 * FORECAST_WINDOW_DAYS,  # 3시간 간격
            },
        )
        resp.raise_for_status()

    blocks: dict[str, dict[str, float]] = {}
    for item in resp.json().get("list", []):
        date_str, time_str = item["dt_txt"].split(" ")  # "2026-07-01 09:00:00"
        block = _hour_to_block(int(time_str[:2]))
        if block is None:
            continue
        pop = float(item.get("pop", 0.0))
        day = blocks.setdefault(date_str, {})
        day[block] = max(day.get(block, 0.0), pop)
    return blocks


def _label_for_day(day_blocks: dict[str, float]) -> str:
    """블록별 강수확률을 사람이 읽는 라벨로 압축.
    임계치 넘는 블록 조합에 따라 맑음/한때 비/부분 비/종일 비로 분류.
    """
    rainy = [b for b in ("오전", "오후", "저녁") if day_blocks.get(b, 0.0) >= _RAIN_THRESHOLD]
    if not rainy:
        return "맑음"
    if len(rainy) == 3:
        return "종일 비"
    if len(rainy) == 1:
        return f"{rainy[0]} 한때 비"
    return "·".join(rainy) + " 비"


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
        forecast = await _get_forecast_by_block(lat, lon, api_key)
        lines = [
            f"Day {i + 1} ({(start_date + timedelta(days=i)).isoformat()}): "
            f"{_label_for_day(forecast.get((start_date + timedelta(days=i)).isoformat(), {}))}"
            for i in range(nights + 1)
        ]
        logger.info("날씨 예보 조회: %s", destination)
        return "\n".join(lines)

    except Exception as e:
        logger.warning("날씨 API 오류, 날씨 정보 없이 진행: %s", e)
        return ""
