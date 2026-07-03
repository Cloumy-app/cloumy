from datetime import date
from typing import Literal

from pydantic import BaseModel, Field, field_validator


class AccommodationAnchor(BaseModel):
    lat: float
    lng: float
    check_in_date: date
    check_out_date: date


class RouteGenRequest(BaseModel):
    city: str
    nights: int
    group_type: Literal["solo", "couple", "friends", "family"]
    budget_level: Literal["tight", "budget", "mid", "premium", "luxury"]
    themes: list[str] = Field(default_factory=list)
    hidden_gem_ratio: float | None = None  # 0.0(관광지 위주) ~ 1.0(숨은 명소 위주)
    start_date: date | None = None  # 여행 시작일 — 날씨 예보 조회 + 숙소 day 매핑에 사용
    density: Literal["relaxed", "normal", "packed"] = "normal"
    transport_mode: Literal["transit", "car", "walk"] | None = None
    accommodations: list[AccommodationAnchor] = Field(default_factory=list)

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
