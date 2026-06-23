from typing import Literal

from pydantic import BaseModel, field_validator


class RouteGenRequest(BaseModel):
    city: str
    nights: int
    group_type: Literal["solo", "couple", "friends", "family"]
    budget_level: Literal["budget", "mid", "premium"]
    themes: list[str] = []

    @field_validator("nights")
    @classmethod
    def validate_nights(cls, v: int) -> int:
        if not 1 <= v <= 5:
            raise ValueError("nights는 1~5 사이여야 합니다")
        return v
