from datetime import date
from typing import Literal

from pydantic import BaseModel, Field, field_validator


class AccommodationAnchor(BaseModel):
    lat: float
    lng: float
    check_in_date: date
    check_out_date: date


class FixedSlot(BaseModel):
    """사전 고정 슬롯(콘서트 앵커/공유 루트 가져오기 공통 기반) — Spring이 AI 생성 시작 전에
    이미 is_pinned=true로 저장해둔 슬롯. duration_minutes는 _assign_start_times가 그대로
    쓰므로 필수(없으면 체류시간이 0분으로 계산돼 뒷 슬롯들의 시작 시각이 전부 당겨짐)."""
    place_id: str
    day_number: int
    lat: float
    lng: float
    duration_minutes: int = 0


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
