from datetime import date
from typing import Literal

from pydantic import BaseModel, Field, field_validator


class AccommodationAnchor(BaseModel):
    lat: float
    lng: float
    check_in_date: date
    check_out_date: date


class FixedSlot(BaseModel):
    """생성 시작 전 이미 확정된 장소 — 사전 고정 슬롯 기반.
    장소명 등은 이미 place_id로 DB에 있으니 불필요하나, duration_minutes는
    _assign_start_times가 그대로 쓰므로 필수(재조회 없이 Spring이 넘겨준 값을 그대로 사용)."""
    place_id: str
    day_number: int
    lat: float
    lng: float
    duration_minutes: int


class RouteGenRequest(BaseModel):
    city: str
    nights: int
    group_type: Literal["solo", "couple", "friends", "family"]
    budget_level: Literal["tight", "budget", "mid", "premium", "luxury"]
    themes: list[str] = Field(default_factory=list)
    hidden_gem_ratio: float | None = None  # 0.0(관광지 위주) ~ 1.0(숨은 명소 위주)
    start_date: date | None = None  # 여행 시작일 — 날씨 예보 조회 + 숙소 day 매핑에 사용
    density: Literal["relaxed", "normal", "packed"] = "normal"
    accommodations: list[AccommodationAnchor] = Field(default_factory=list)
    language: str | None = None  # ko/en/ja/zh — 앱 설정 언어(tip/day_summary 생성 언어, place_name은 원본 유지)
    fixed_slots: list[FixedSlot] = Field(default_factory=list)

    @field_validator("nights")
    @classmethod
    def validate_nights(cls, v: int) -> int:
        if not 1 <= v <= 5:
            raise ValueError("nights는 1~5 사이여야 합니다")
        return v

    @field_validator("hidden_gem_ratio")
    @classmethod
    def validate_hidden_gem_ratio(cls, v: float | None) -> float | None:
        if v is not None and not 0.0 <= v <= 1.0:
            raise ValueError("hidden_gem_ratio는 0.0~1.0 사이여야 합니다")
        return v
