from datetime import date, datetime, time
from typing import Annotated, Literal, Union

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


# ============================================================
# 프로액티브 개입 컨텍스트 — /ai/chat이 받는 {type, params}를 검증한다.
#
# 결함: 예전엔 앱이 완성된 한국어 문장(proactive_context: str)을 보내 서버가 시스템
# 프롬프트 맨 끝에 그대로 붙였다. 검증이 경로 전체에 없어 인증된 사용자가 시스템 지시
# 자리에 아무 문장이나 써넣을 수 있었다. 해결책은 앱이 type+params만 보내고 서버가
# 문장을 조립하는 것 — 서술 조립은 app/services/chat_service.py._build_proactive_descriptor.
#
# params 필드는 반드시 app/services/proactive_service.py의 각 규칙 함수가 반환하는
# params 딕셔너리와 일치해야 한다(camelCase 그대로) — 서버 규칙이 그 형식으로 내보내고
# 앱이 그대로 되돌려주기 때문이다. 규칙을 바꾸면 이 스키마도 함께 바꿔야 한다.
#
# extra="forbid"는 쓰지 않는다 — 앱이 캐시된 오래된 개입을 보낼 수 있고(staleTime 5분),
# 규칙에 필드가 추가되면 구버전 캐시가 거부되기 때문이다. Pydantic 기본(미지 필드 무시)이 맞다.
# ============================================================

# ---- PRE_TRIP_BRIEFING.flags — kind로 판별되는 7종 태그드 유니온 (_rule_pre_trip_briefing) ----
class RainFlag(BaseModel):
    kind: Literal["rain"]


class HeatFlag(BaseModel):
    kind: Literal["heat"]


class ColdFlag(BaseModel):
    kind: Literal["cold"]


class PackedDayFlag(BaseModel):
    kind: Literal["packed_day"]
    day: int


class FarFromStayFlag(BaseModel):
    kind: Literal["far_from_stay"]
    day: int
    distanceM: int


class LongWalkFlag(BaseModel):
    kind: Literal["long_walk"]
    day: int
    minutes: int


class FirstSlotFlag(BaseModel):
    kind: Literal["first_slot"]
    time: time  # 자유 텍스트가 들어갈 수 없도록 시각 타입으로 강제(자유 문자열이 아님)
    placeName: str  # 자유 문자열 — 앱이 보내므로 스키마엔 두되 서술 조립 시 제외한다


ProactiveFlag = Annotated[
    Union[RainFlag, HeatFlag, ColdFlag, PackedDayFlag, FarFromStayFlag, LongWalkFlag, FirstSlotFlag],
    Field(discriminator="kind"),
]


# ---- 개입 9종의 params — proactive_service.py 각 규칙 함수의 반환값과 1:1 대응 ----
class PreTripBriefingParams(BaseModel):
    nights: int
    destination: str  # 자유 문자열 — 서술 조립 시 제외
    flags: list[ProactiveFlag] = Field(max_length=7)  # 실제 최대 동시 발생은 6종


class FlightDepartureParams(BaseModel):
    departureAt: datetime
    leaveByTime: datetime


class ReturnDepartureParams(BaseModel):
    returnAt: datetime
    leaveByTime: datetime


class DepartureSoonParams(BaseModel):
    nextPlaceName: str  # 자유 문자열 — 서술 조립 시 제외
    minutesLeft: int
    transportMinutes: int


class EmptyDayParams(BaseModel):
    day: int
    slotCount: int


class WeatherAlertParams(BaseModel):
    day: int
    kind: Literal["rain", "heat", "cold"]
    outdoorCount: int


class BudgetOverParams(BaseModel):
    spentToday: int
    dailyBudget: int


class BookmarkNearbyParams(BaseModel):
    placeName: str  # 자유 문자열 — 서술 조립 시 제외
    distanceM: int


class FreeGapParams(BaseModel):
    gapMinutes: int


# ---- type이 어떤 params 모델인지 판별하는 태그드 유니온 ----
class PreTripBriefingContext(BaseModel):
    type: Literal["PRE_TRIP_BRIEFING"]
    params: PreTripBriefingParams


class FlightDepartureContext(BaseModel):
    type: Literal["FLIGHT_DEPARTURE"]
    params: FlightDepartureParams


class ReturnDepartureContext(BaseModel):
    type: Literal["RETURN_DEPARTURE"]
    params: ReturnDepartureParams


class DepartureSoonContext(BaseModel):
    type: Literal["DEPARTURE_SOON"]
    params: DepartureSoonParams


class EmptyDayContext(BaseModel):
    type: Literal["EMPTY_DAY"]
    params: EmptyDayParams


class WeatherAlertContext(BaseModel):
    type: Literal["WEATHER_ALERT"]
    params: WeatherAlertParams


class BudgetOverContext(BaseModel):
    type: Literal["BUDGET_OVER"]
    params: BudgetOverParams


class BookmarkNearbyContext(BaseModel):
    type: Literal["BOOKMARK_NEARBY"]
    params: BookmarkNearbyParams


class FreeGapContext(BaseModel):
    type: Literal["FREE_GAP"]
    params: FreeGapParams


# type으로 params 모델을 판별한다 — type과 params가 어긋나면 422(FFE #6).
ProactiveContext = Annotated[
    Union[
        PreTripBriefingContext,
        FlightDepartureContext,
        ReturnDepartureContext,
        DepartureSoonContext,
        EmptyDayContext,
        WeatherAlertContext,
        BudgetOverContext,
        BookmarkNearbyContext,
        FreeGapContext,
    ],
    Field(discriminator="type"),
]
