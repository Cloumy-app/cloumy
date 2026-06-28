from typing import Literal

from pydantic import BaseModel, field_validator


class RouteGenRequest(BaseModel):
    city: str
    nights: int
    group_type: Literal["solo", "couple", "friends", "family"]
    budget_level: Literal["tight", "budget", "mid", "premium", "luxury"]
    themes: list[str] = []
    hidden_gem_ratio: float | None = None  # 0.0(관광지 위주) ~ 1.0(숨은 명소 위주)

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
