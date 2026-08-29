"""프로액티브 개입 엔진 — "지금 이 유저에게 말을 걸 것인가, 건다면 무엇을"을 결정한다.

설계 원칙(docs/superpowers/specs/2026-07-27-proactive-chatbot-design.md):
- 판단은 규칙이, 표현은 앱이 한다 — 서버 응답에 문구가 없다(type + params만).
- 규칙 함수는 전부 순수 함수다. DB·datetime.now()·네트워크를 규칙 함수 안에서 부르지 않는다.
  스냅샷 dict만 받아 dict | None을 반환한다 — 이래야 pytest에서 dict 하나로 단독 검증된다.
- route_slots.start_time은 계획일 뿐 실제 진행 상황이 아니다. _estimate_current_slot()의
  confidence != "high"면 위치에 의존하는 규칙(T2·T6·T7)을 건너뛴다.
"""
import json
import logging
from datetime import date, datetime, time, timedelta

import asyncpg
import httpx

from app.config.city_centers import CITY_CENTERS
from app.config.settings import settings
from app.services.chat_service import _KST, _estimate_current_slot, _load_route
from app.services.transport_service import find_last_departure
from app.services.weather_service import _RAIN_THRESHOLD, _aggregate_blocks, _fetch_forecast_raw, _temps_by_date

logger = logging.getLogger(__name__)

# ============================================================
# 규칙 임계 상수 — 베타에서 조정할 값들이라 한곳에 모은다
# ============================================================
_DEPARTURE_SOON_WINDOW_MIN = 15  # T2 — 조정 예정
_EMPTY_DAY_MORNING_HOUR_END = 12  # T3 — 오전에만 뜨게(저녁엔 이미 늦음)
_BUDGET_OVER_RATIO = 1.2  # T5 — 조정 예정
_BOOKMARK_RADIUS_M = 500  # T6
_FREE_GAP_EXTRA_MIN = 60  # T7
_HEAT_C, _COLD_C = 33.0, -5.0  # P1·T4
_PACKED_SLOTS, _PACKED_TRANSPORT_MIN = 5, 180  # P1
_FAR_FROM_STAY_M = 8000  # P1 — 직선거리(이동시간 계산 불가, 근사치로 충분)
_LONG_WALK_MIN = 40  # P1
_AIRPORT_MINUTES = {"서울": 90, "부산": 60, "제주": 30}  # T1·RETURN
_AIRPORT_MINUTES_DEFAULT = 90  # T1·RETURN — 표에 없는 도시
_CHECKIN_BUFFER_MIN = 120  # T1·RETURN
_FLIGHT_WINDOW_MIN = 60  # T1·RETURN — leave_by까지 남은 시간이 이 안이면 발동
_DISMISS_TTL_HOURS = 48  # Spring ProactiveController와 맞춘 값(기록은 Spring이 한다)
_ARRIVAL_WARN_WINDOW_MIN = 60  # 다음 슬롯 도착 N분 전부터 BREAK_TIME·LAST_ENTRY 평가
_LAST_TRANSIT_WINDOW_MIN = 60  # 막차 출발 N분 전부터 LAST_TRANSIT 발동
_LAST_TRANSIT_EVAL_FROM_HOUR = 18  # 이 시각 이후에만 막차를 계산한다(비용 방어)
_LAST_TRANSIT_CACHE_TTL_S = 86_400  # 막차는 (출발지, 도착지, 날짜)에 하루 불변


def _trip_phase(route: asyncpg.Record, now: datetime) -> str:
    """여행 전(D-1) / 여행 중 / 범위 밖을 구분한다.

    쿼리 없이 route 레코드와 now만으로 즉시 판단해야 한다 — out_of_range면
    get_intervention()이 여기서 바로 종료한다. 이게 비용 방어의 핵심(FFE #1)이다.
    """
    today = now.date()
    if today == route["start_date"] - timedelta(days=1):
        return "pre_trip"
    if route["start_date"] <= today <= route["end_date"]:
        return "during"
    return "out_of_range"


def _combine(d: date, t: time) -> datetime:
    """route_slots.start_time(TIME, naive)을 날짜와 합쳐 KST aware datetime으로 만든다."""
    return datetime.combine(d, t, tzinfo=_KST)


def _flight_leave_by(snap: dict, at_key: str) -> datetime | None:
    """항공편 출발 시각(departure_at 또는 return_at)에서 '집을 나서야 하는 시각'을 역산한다.
    가는 편/오는 편이 같은 계산이라 T1·RETURN_DEPARTURE가 함께 쓰는 헬퍼다. 미입력이면 None."""
    at = snap["route"][at_key]
    if at is None:
        return None  # FFE #5 — 선택 입력이라 미입력이면 해당 규칙만 스킵
    airport_minutes = _AIRPORT_MINUTES.get(snap["route"]["destination"], _AIRPORT_MINUTES_DEFAULT)
    return at - timedelta(minutes=airport_minutes + _CHECKIN_BUFFER_MIN)


def _hours_for(business_hours: dict | None, weekday: int) -> tuple[time, time] | None:
    """{"open","close","weekday_overrides"} → 그 요일의 (open, close).

    weekday는 ISO 1=월…7=일(V21 closed_weekdays 규약과 동일). 미조사(None)거나
    형식이 깨졌으면 None — 수기 CSV라 깨진 값이 들어올 수 있다(FFE #4)."""
    if business_hours is None:
        return None
    try:
        overrides = business_hours.get("weekday_overrides") or {}
        override = overrides.get(str(weekday))
        if override is not None:
            return time.fromisoformat(override["open"]), time.fromisoformat(override["close"])
        return time.fromisoformat(business_hours["open"]), time.fromisoformat(business_hours["close"])
    except (KeyError, ValueError, TypeError):
        return None


def _break_for(break_time: dict | None, weekday: int) -> tuple[time, time] | None:
    """{"start","end","except_weekdays"} → 그 요일의 (start, end).

    except_weekdays에 포함된 요일이면 None(그날은 브레이크타임 없음)."""
    if break_time is None:
        return None
    try:
        except_weekdays = break_time.get("except_weekdays") or []
        if weekday in except_weekdays:
            return None
        return time.fromisoformat(break_time["start"]), time.fromisoformat(break_time["end"])
    except (KeyError, ValueError, TypeError):
        return None


# ============================================================
# 규칙 — 전부 순수 함수. 스냅샷 dict만 읽고 dict | None만 반환한다.
# ============================================================

def _rule_pre_trip_briefing(snap: dict) -> dict | None:
    """P1. 여행 전날(D-1) 브리핑 — 여러 진단을 한 배너에 묶어 flags 배열로 전달한다.

    진단마다 스코프가 다르다:
    - rain/heat/cold/first_slot: Day1만. 짐 싸기·첫 일정 안내가 목적이라 내일(Day1) 것만 의미가 있다.
    - packed_day/far_from_stay/long_walk: 전체 Day 스캔. 구조적 문제라 D-1이 고칠 마지막 기회이고,
      Day1이 아니어도(예: Day3) 미리 알아야 손 쓸 수 있다.
    같은 kind가 여러 Day에서 걸리면 가장 심한 것 1개만 담는다(packed는 이동시간 최대,
    far_from_stay는 거리 최대, long_walk는 도보시간 최대)."""
    day1_slots = snap.get("day1_slots") or []
    days_slots: dict[int, list] = snap.get("days_slots") or {}
    flags: list[dict] = []

    # rain/heat/cold — Day1만(day_forecast/day_temps 자체가 이미 start_date 기준으로 로드됨)
    forecast = snap.get("day_forecast") or {}
    if any(pop >= _RAIN_THRESHOLD for pop in forecast.values()):
        flags.append({"kind": "rain"})

    temps = snap.get("day_temps")
    if temps is not None:
        if temps["max"] >= _HEAT_C:
            flags.append({"kind": "heat"})
        elif temps["min"] <= _COLD_C:
            flags.append({"kind": "cold"})

    # packed_day — 전체 Day 스캔, 총 이동시간이 가장 큰 Day 1개만
    packed_candidates = [
        (day, sum(s["transport_minutes"] or 0 for s in slots))
        for day, slots in days_slots.items()
        if len(slots) >= _PACKED_SLOTS
    ]
    packed_candidates = [(day, total) for day, total in packed_candidates if total >= _PACKED_TRANSPORT_MIN]
    if packed_candidates:
        worst_day, _ = max(packed_candidates, key=lambda c: c[1])
        flags.append({"kind": "packed_day", "day": worst_day})

    # far_from_stay — 전체 Day 스캔, 직선거리가 가장 먼 Day 1개만
    stay_distances: dict[int, float] = snap.get("stay_distances") or {}
    far_candidates = [(day, dist) for day, dist in stay_distances.items() if dist >= _FAR_FROM_STAY_M]
    if far_candidates:
        worst_day, worst_dist = max(far_candidates, key=lambda c: c[1])
        flags.append({"kind": "far_from_stay", "day": worst_day, "distanceM": round(worst_dist)})

    # long_walk — 전체 Day 스캔, 도보 이동시간이 가장 긴 슬롯 1개만
    long_walk_candidates = [
        (day, s["transport_minutes"])
        for day, slots in days_slots.items()
        for s in slots
        if s["transport_to_next"] == "walk" and (s["transport_minutes"] or 0) >= _LONG_WALK_MIN
    ]
    if long_walk_candidates:
        worst_day, worst_minutes = max(long_walk_candidates, key=lambda c: c[1])
        flags.append({"kind": "long_walk", "day": worst_day, "minutes": worst_minutes})

    # first_slot — Day1만(정의상)
    if day1_slots and day1_slots[0]["start_time"] is not None:
        first = day1_slots[0]  # day1_slots는 order_index순으로 이미 정렬돼 들어온다
        flags.append({
            "kind": "first_slot",
            "time": first["start_time"].isoformat(),
            "placeName": first["place_name"],
        })

    if not flags:
        return None  # 진단 0개 — 브리핑 안 뜸

    return {
        "type": "PRE_TRIP_BRIEFING",
        "priority": 1,
        "params": {
            "nights": snap["route"]["nights"],
            "destination": snap["route"]["destination"],
            "flags": flags,
        },
    }


def _rule_flight_departure(snap: dict) -> dict | None:
    """T1. 출국 준비 — 실패 비용이 가장 큰 규칙이라 우선순위 1위.
    leave_by(_flight_leave_by)까지 남은 시간이 0~_FLIGHT_WINDOW_MIN분이면 발동."""
    leave_by = _flight_leave_by(snap, "departure_at")
    if leave_by is None:
        return None  # FFE #5 — 미입력(선택 입력)이면 T1만 스킵

    minutes_left = (leave_by - snap["now"]).total_seconds() / 60
    if not (0 <= minutes_left <= _FLIGHT_WINDOW_MIN):
        return None

    return {
        "type": "FLIGHT_DEPARTURE",
        "priority": 1,
        "params": {"departureAt": snap["route"]["departure_at"].isoformat(), "leaveByTime": leave_by.isoformat()},
    }


def _rule_return_departure(snap: dict) -> dict | None:
    """RETURN. 귀가 준비 — T1(가는 편)과 대칭인 오는 편 규칙. 우선순위도 T1과 동일하게 1위다
    (실패 비용이 똑같이 크다 — 비행기를 놓치는 건 가는 편이든 오는 편이든 같은 무게다)."""
    leave_by = _flight_leave_by(snap, "return_at")
    if leave_by is None:
        return None  # FFE #4 — 오는 편은 가는 편과 독립적인 선택 입력이라 미입력이면 이 규칙만 스킵

    minutes_left = (leave_by - snap["now"]).total_seconds() / 60
    if not (0 <= minutes_left <= _FLIGHT_WINDOW_MIN):
        return None

    return {
        "type": "RETURN_DEPARTURE",
        "priority": 1,
        "params": {"returnAt": snap["route"]["return_at"].isoformat(), "leaveByTime": leave_by.isoformat()},
    }


def _rule_departure_soon(snap: dict) -> dict | None:
    """T2. 다음 일정 출발 임박 — 위치 추정에 의존하므로 confidence가 high일 때만 평가."""
    if snap["estimated"]["confidence"] != "high":
        return None
    current, next_slot = snap.get("current_slot"), snap.get("next_slot")
    if current is None or next_slot is None:
        return None
    if next_slot["start_time"] is None or current["transport_minutes"] is None:
        return None  # FFE #8 — start_time NULL이면 시간 의존 규칙 스킵

    leave_by = _combine(snap["today_date"], next_slot["start_time"]) - timedelta(
        minutes=current["transport_minutes"]
    )
    minutes_left = (leave_by - snap["now"]).total_seconds() / 60
    if not (0 <= minutes_left <= _DEPARTURE_SOON_WINDOW_MIN):
        return None

    return {
        "type": "DEPARTURE_SOON",
        "priority": 2,
        "params": {
            "nextPlaceName": next_slot["place_name"],
            "minutesLeft": round(minutes_left),
            "transportMinutes": current["transport_minutes"],
        },
    }


def _rule_empty_day(snap: dict) -> dict | None:
    """T3. 오늘 일정 비었음 — 계획이 아니라 사실이라 위치 추정과 무관하게 항상 평가한다.
    오전에만 뜨게 한다: 저녁에 '오늘 일정 없어요'는 늦었다."""
    if snap["now"].hour >= _EMPTY_DAY_MORNING_HOUR_END:
        return None
    slot_count = len(snap["today_slots"])
    if slot_count > 1:
        return None
    return {
        "type": "EMPTY_DAY",
        "priority": 3,
        "params": {"day": snap["today_day_number"], "slotCount": slot_count},
    }


def _rule_weather_alert(snap: dict) -> dict | None:
    """T4. 날씨 경고 — 위치와 무관하게 항상 평가. 실외 슬롯이 하나도 없으면 의미 없어 스킵."""
    forecast = snap.get("day_forecast") or {}
    temps = snap.get("day_temps")
    rain = any(pop >= _RAIN_THRESHOLD for pop in forecast.values())
    heat = temps is not None and temps["max"] >= _HEAT_C
    cold = temps is not None and temps["min"] <= _COLD_C
    if not (rain or heat or cold):
        return None

    outdoor_count = sum(1 for s in snap["today_slots"] if "#실내" not in (s["category_tags"] or []))
    if outdoor_count == 0:
        return None

    kind = "rain" if rain else ("heat" if heat else "cold")
    return {
        "type": "WEATHER_ALERT",
        "priority": 4,
        "params": {"day": snap["today_day_number"], "kind": kind, "outdoorCount": outdoor_count},
    }


def _rule_budget_over(snap: dict) -> dict | None:
    """T5. 오늘 지출이 하루 예산의 1.2배를 넘으면 개입. 위치와 무관하게 항상 평가."""
    budget = snap.get("budget")
    if budget is None:
        return None  # FFE #6 — 예산 미설정이면 정상 경로
    daily = budget["total"] / (snap["route"]["nights"] + 1)
    spent = snap["spent_today"]
    if spent <= daily * _BUDGET_OVER_RATIO:
        return None
    return {
        "type": "BUDGET_OVER",
        "priority": 5,
        "params": {"spentToday": spent, "dailyBudget": round(daily)},
    }


def _rule_bookmark_nearby(snap: dict) -> dict | None:
    """T6. 추정 위치 근처에 유저 북마크 장소가 있으면 개입 — 개인화 가설의 시금석.
    위치 추정에 의존하므로 confidence가 high일 때만 평가."""
    if snap["estimated"]["confidence"] != "high":
        return None
    bookmarks = snap.get("nearby_bookmarks") or []
    if not bookmarks:
        return None
    nearest = bookmarks[0]  # 쿼리에서 이미 거리순 정렬됨
    return {
        "type": "BOOKMARK_NEARBY",
        "priority": 6,
        "params": {"placeName": nearest["place_name"], "distanceM": round(nearest["distance_m"])},
    }


def _rule_free_gap(snap: dict) -> dict | None:
    """T7. 지금 다음 슬롯까지 남은 여유가 크면 개입. 위치 추정에 의존한다."""
    if snap["estimated"]["confidence"] != "high":
        return None
    current, next_slot = snap.get("current_slot"), snap.get("next_slot")
    if current is None or next_slot is None:
        return None
    if current["start_time"] is None or next_slot["start_time"] is None:
        return None  # FFE #8

    current_end = _combine(snap["today_date"], current["start_time"]) + timedelta(
        minutes=current["duration_minutes"] or 120
    )
    next_start = _combine(snap["today_date"], next_slot["start_time"])

    # 계획상 공백이 아니라 '지금 남은 여유'를 본다. 계획 시각만 보면 두 가지가 틀어진다 —
    # _estimate_current_slot이 첫 일정 시작 전에도 slots[0]을 high로 잡아주므로 아침에
    # 열어도 발동해 그날 dismiss를 소모해버리고(정작 실제 공백엔 안 뜬다), 공백 한가운데선
    # 이미 지나간 시간까지 여유로 세어 과대 안내가 된다.
    if not (current_end <= snap["now"] < next_start):
        return None
    gap_minutes = (next_start - snap["now"]).total_seconds() / 60

    threshold = (current["transport_minutes"] or 0) + _FREE_GAP_EXTRA_MIN
    if gap_minutes < threshold:
        return None

    return {"type": "FREE_GAP", "priority": 7, "params": {"gapMinutes": round(gap_minutes)}}


def _rule_last_transit(snap: dict) -> dict | None:
    """막차. 오늘 마지막 슬롯 → 숙소 막차 출발이 임박하면 개입한다.

    leave_by는 유저의 현재 위치가 아니라 '오늘 마지막 슬롯 → 숙소' 구간으로 계산되므로
    위치 추정 confidence와 무관하다 — 위치 가드를 두지 않는다(상위 계획서 정정 2).
    밤 시간대엔 confidence가 낮게 나오기 쉬운데, 가드를 두면 정확히 필요한 시간에
    규칙이 죽는다."""
    lt = snap.get("last_transit")
    if lt is None:
        return None
    minutes_left = (lt["leaveBy"] - snap["now"]).total_seconds() / 60
    if not (0 <= minutes_left <= _LAST_TRANSIT_WINDOW_MIN):
        return None
    return {
        "type": "LAST_TRANSIT",
        "priority": 1,
        "params": {
            "placeId": lt["placeId"],
            "placeName": lt["placeName"],
            "leaveByTime": lt["leaveBy"].isoformat(),
            "minutes": lt["minutes"],
            "fare": lt["fare"],
        },
    }


def _rule_closed_day(snap: dict) -> dict | None:
    """오늘 휴관 — 날짜 예외(place_closures)와 요일 규칙(closed_weekdays)을 OR로 판정한다.
    오늘 슬롯을 순회해 첫 번째로 걸리는 휴관 장소 하나에만 발동한다."""
    closures_today: set[str] = snap.get("closures_today") or set()
    today_day_number = snap["today_day_number"]
    weekday = snap["today_date"].isoweekday()

    for slot in snap["today_slots"]:
        place_id = str(slot["place_id"])
        if place_id in closures_today:  # 날짜 예외 — 확정 증거
            return {
                "type": "CLOSED_DAY",
                "priority": 1,
                "params": {"placeId": place_id, "placeName": slot["place_name"], "day": today_day_number},
            }
        if slot["closed_weekdays"] is None:  # 미조사 — 이 슬롯은 판단 불가, 다음 슬롯 계속
            continue
        if weekday in slot["closed_weekdays"]:
            return {
                "type": "CLOSED_DAY",
                "priority": 1,
                "params": {"placeId": place_id, "placeName": slot["place_name"], "day": today_day_number},
            }
    return None


def _rule_break_time(snap: dict) -> dict | None:
    """브레이크타임 — 다음 슬롯 도착 시각이 브레이크타임 구간에 걸리면 개입.
    도착 시각이 '다음 슬롯 도착 시각'이라 위치 추정에 의존한다 — 위치 가드가 본질적이다."""
    if snap["estimated"]["confidence"] != "high":
        return None
    nxt = snap.get("next_slot")
    if nxt is None or nxt["start_time"] is None:
        return None
    if nxt["break_time"] is None:  # 미조사
        return None

    arrival = _combine(snap["today_date"], nxt["start_time"])
    minutes_left = (arrival - snap["now"]).total_seconds() / 60
    if not (0 <= minutes_left <= _ARRIVAL_WARN_WINDOW_MIN):
        return None

    brk = _break_for(nxt["break_time"], arrival.isoweekday())
    if brk is None:  # 그 요일은 브레이크타임 없음
        return None
    start, end = brk

    # last_order_minutes는 컷오프 계산에만 쓴다 — 라스트오더가 있으면 실질 마감이 앞당겨진다.
    cutoff = start
    if nxt["last_order_minutes"] is not None:
        cutoff = (
            datetime.combine(arrival.date(), start) - timedelta(minutes=nxt["last_order_minutes"])
        ).time()
    if not (cutoff <= arrival.time() < end):
        return None

    return {
        "type": "BREAK_TIME",
        "priority": 2,
        "params": {
            "placeId": str(nxt["place_id"]),
            "placeName": nxt["place_name"],
            "breakStart": start.isoformat(),
            "breakEnd": end.isoformat(),
        },
    }


def _rule_reservation_wall(snap: dict) -> dict | None:
    """예약 필수 — 오늘 슬롯을 순회해 예약 필수인데 워크인이 안 되는 첫 번째 장소에 발동."""
    for slot in snap["today_slots"]:
        if slot["reservation_required"] is None:  # 미조사
            continue
        if not slot["reservation_required"]:  # 조사했는데 예약 필수 아님
            continue
        if slot["walk_in_allowed"] is True:  # 예약 필수여도 워크인이 되면 벽이 아니다
            continue
        return {
            "type": "RESERVATION_WALL",
            "priority": 2,
            "params": {
                "placeId": str(slot["place_id"]),
                "placeName": slot["place_name"],
                "reservationPlatform": slot["reservation_platform"],
            },
        }
    return None


def _rule_payment_wall(snap: dict) -> dict | None:
    """결제 수단 함정 — 현금전용 또는 해외카드 미대응인 첫 번째 장소에 발동.

    friendly_foreign_card는 0(조사했는데 없음)과 None(미조사)이 둘 다 falsy라
    가장 실수하기 쉬운 자리다. `== 0`으로 명시 비교해야 한다."""
    for slot in snap["today_slots"]:
        # 두 신호는 독립이다. cash_only가 미조사여도 friendly_foreign_card는 따로 본다 —
        # 앞 조건에 묶으면 "해외카드만 조사된 장소"가 통째로 침묵한다(CSV에서 흔한 입력 패턴).
        # 각 조건이 '양성 증거'일 때만 참이라 미조사(None)는 자연히 다음으로 넘어간다.
        if slot["cash_only"] is True:  # 조사했는데 현금전용
            kind = "cash_only"
        elif slot["friendly_foreign_card"] == 0:  # 조사했는데 해외카드 안 됨(None과 구분)
            kind = "no_foreign_card"
        else:
            kind = None

        if kind is None:
            continue
        return {
            "type": "PAYMENT_WALL",
            "priority": 2,
            "params": {"placeId": str(slot["place_id"]), "placeName": slot["place_name"], "kind": kind},
        }
    return None


def _rule_last_entry(snap: dict) -> dict | None:
    """마감 임박 입장 — 다음 슬롯 도착 시각이 라스트엔트리 이후면 개입.
    도착 시각에 의존하므로 위치 가드가 본질적이다."""
    if snap["estimated"]["confidence"] != "high":
        return None
    nxt = snap.get("next_slot")
    if nxt is None or nxt["start_time"] is None:
        return None
    if nxt["last_entry_minutes"] is None or nxt["business_hours"] is None:
        return None  # last_entry_minutes는 상대값이라 business_hours 없인 절대시각을 못 만든다

    arrival = _combine(snap["today_date"], nxt["start_time"])
    minutes_left = (arrival - snap["now"]).total_seconds() / 60
    if not (0 <= minutes_left <= _ARRIVAL_WARN_WINDOW_MIN):
        return None

    hours = _hours_for(nxt["business_hours"], arrival.isoweekday())
    if hours is None:
        return None
    _open, close = hours
    last_entry = (
        datetime.combine(arrival.date(), close) - timedelta(minutes=nxt["last_entry_minutes"])
    ).time()
    if arrival.time() < last_entry:  # 아직 여유 있음
        return None

    return {
        "type": "LAST_ENTRY",
        "priority": 3,
        "params": {
            "placeId": str(nxt["place_id"]),
            "placeName": nxt["place_name"],
            "lastEntryTime": last_entry.isoformat(),
            "closeTime": close.isoformat(),
        },
    }


# pre_trip에도 T1을 등록한다 — 새벽 항공편은 leave_by가 D-1로 넘어가버려 during 진입 전에
# 이미 발동 창이 열려 있을 수 있다(리뷰 9번 회귀 방지). T1과 P1(_rule_pre_trip_briefing)은
# 둘 다 priority=1로 동점인데, _select가 min()이라 동점이면 리스트에서 먼저 나온 쪽이 이긴다.
# 그래서 T1을 앞에 둔다 — "지금 나가야 해요"가 "짐 싸세요" 브리핑보다 급하다(FFE #5).
_RULES_PRE_TRIP = [_rule_flight_departure, _rule_pre_trip_briefing]
_RULES_DURING = [
    _rule_flight_departure,    # 1
    _rule_return_departure,    # 1
    _rule_last_transit,        # 1 — 신규. 복구 불가라 같은 1 중에서도 앞
    _rule_closed_day,          # 1 — 신규
    _rule_departure_soon,      # 2
    _rule_break_time,          # 2 — 신규
    _rule_reservation_wall,    # 2 — 신규
    _rule_payment_wall,        # 2 — 신규
    _rule_empty_day,           # 3
    _rule_last_entry,          # 3 — 신규
    _rule_weather_alert,       # 4
    _rule_budget_over,         # 5
    _rule_bookmark_nearby,     # 6
    _rule_free_gap,            # 7
]


def _select(candidates: list[dict]) -> dict | None:
    """후보 중 하나를 고른다.

    지금은 priority 최솟값. 데이터가 늘어 후보가 동시에 여러 개 뜨기 시작하면
    이 함수만 LLM 호출로 교체한다 — 규칙층·API·프론트는 그대로 둔다.
    """
    return min(candidates, key=lambda c: c["priority"]) if candidates else None


# ============================================================
# dismiss 필터링 — 기록은 Spring이 하고(ProactiveController), 여기서는 조회·판정만 한다.
# 반드시 _select 호출 "전"에 candidates에서 걸러야 한다 — _select는 min(priority)로
# 후보 1개만 반환하므로 뒤에서 거르면 그날 아무것도 안 뜨는 버그가 된다(FFE #4).
# ============================================================

async def _load_dismissed(redis, user_id: str, route_id: str, now: datetime) -> set[str]:
    """오늘 유저가 닫은 개입 목록. Redis 장애 시 빈 set — 개입을 막지 않는다(FFE #3)."""
    key = f"proactive:dismissed:{user_id}:{route_id}:{now.date().isoformat()}"
    try:
        return set(await redis.smembers(key))
    except Exception as e:
        logger.warning("[proactive] dismissed 조회 실패 — 빈 목록으로 진행: %s", e)
        return set()


def _dismiss_member(candidate: dict) -> str:
    """Spring이 기록하는 멤버 형식과 1:1로 맞춘다 — 장소 무관 규칙은 '-'."""
    place_id = candidate["params"].get("placeId")
    return f"{candidate['type']}:{place_id or '-'}"


# ============================================================
# 스냅샷 수집 — 규칙이 볼 재료를 단계적으로 모은다
# ============================================================

async def _load_slots(db: asyncpg.Pool, route_id: str) -> list[asyncpg.Record]:
    # start_time IS NOT NULL 필터를 넣지 말 것. 이 목록은 시각과 무관한 규칙도 함께 쓴다 —
    # _rule_empty_day의 슬롯 카운트, _rule_weather_alert의 실외 슬롯 카운트, P1의
    # packed_day/long_walk 진단. 필터를 넣으면 수동 작성 루트(전 슬롯 start_time NULL)에서
    # EMPTY_DAY가 오발동하고 outdoorCount가 0이 돼 T4가 통째로 스킵된다.
    # 시각이 필요한 T2·T7은 _current_and_next와 각 규칙의 FFE #8 가드가 알아서 거른다.
    return await db.fetch(
        "SELECT rs.day_number, rs.order_index, rs.start_time, rs.duration_minutes, "
        "rs.transport_to_next, rs.transport_minutes, p.id AS place_id, p.name AS place_name, "
        "p.category_tags, "
        "p.business_hours, p.break_time, p.last_order_minutes, p.last_entry_minutes, "
        "p.reservation_required, p.walk_in_allowed, p.reservation_platform, "
        "p.cash_only, p.friendly_foreign_card, p.closed_weekdays "
        "FROM route_slots rs JOIN places p ON p.id = rs.place_id "
        "WHERE rs.route_id = $1 ORDER BY rs.day_number, rs.order_index",
        route_id,
    )


async def _load_closures(db: asyncpg.Pool, route_id: str, today: date) -> set[str]:
    """오늘 휴관인 place_id 집합(str). closed_weekdays(요일 규칙)는 슬롯 행에 이미 실려
    오므로 여기선 날짜 예외(place_closures)만 본다 — 규칙에서 둘을 OR로 합친다."""
    rows = await db.fetch(
        "SELECT DISTINCT pc.place_id FROM place_closures pc "
        "JOIN route_slots rs ON rs.place_id = pc.place_id "
        "WHERE rs.route_id = $1 AND pc.closed_date = $2",
        route_id, today,
    )
    return {str(r["place_id"]) for r in rows}


async def _load_last_transit(
    db: asyncpg.Pool, redis, route: asyncpg.Record, today_slots: list[asyncpg.Record], now: datetime
) -> dict | None:
    """오늘 마지막 슬롯 → 그날 밤 숙소의 막차. 계산 안 할 조건이면 None.
    반환: {"placeId": str, "placeName": str, "leaveBy": datetime, "minutes": int,
           "fare": int | None}"""
    if now.hour < _LAST_TRANSIT_EVAL_FROM_HOUR:
        return None  # 비용 방어 — 이 시각 이전엔 계산 자체를 하지 않는다(FFE #7)
    if not today_slots:
        return None
    if not settings.tmap_api_key:
        return None

    last_slot = today_slots[-1]
    try:
        stay = await db.fetchrow(
            "SELECT ST_X(p.location::geometry) AS place_lng, ST_Y(p.location::geometry) AS place_lat, "
            "ST_X(a.location::geometry) AS stay_lng, ST_Y(a.location::geometry) AS stay_lat "
            "FROM places p, accommodations a "
            "WHERE p.id = $1 AND a.route_id = $2 "
            "AND a.check_in_date <= $3::date AND a.check_out_date > $3::date "
            "LIMIT 1",
            last_slot["place_id"], route["id"], now.date(),
        )
        if stay is None or stay["place_lat"] is None or stay["stay_lat"] is None:
            return None  # 좌표를 못 구하면 계산 불가 — 오늘 숙소 미입력 등(FFE #7)

        cache_key = (
            f"transit:last:{last_slot['place_id']}:{stay['stay_lat']},{stay['stay_lng']}:"
            f"{now.date().isoformat()}"
        )
        cached = await redis.get(cache_key)
        if cached:
            data = json.loads(cached)
            data["leaveBy"] = datetime.fromisoformat(data["leaveBy"])
            return data

        async with httpx.AsyncClient() as client:
            result = await find_last_departure(
                client, stay["place_lat"], stay["place_lng"], stay["stay_lat"], stay["stay_lng"],
                settings.tmap_api_key, now.date(),
            )
        if result is None:
            return None

        out = {
            "placeId": str(last_slot["place_id"]),
            "placeName": last_slot["place_name"],
            "leaveBy": result["leave_by"],
            "minutes": result["minutes"],
            "fare": result["fare"],
        }
        await redis.setex(
            cache_key, _LAST_TRANSIT_CACHE_TTL_S, json.dumps({**out, "leaveBy": out["leaveBy"].isoformat()})
        )
        return out
    except Exception as e:
        logger.warning("[proactive] 막차 조회 실패 — None으로 폴백: %s", e)
        return None


async def _load_stay_distances(db: asyncpg.Pool, route_id: str, start_date: date) -> dict[int, float]:
    """Day별 마지막 슬롯 → 그날 밤 묵는 숙소까지 직선거리(m). 전체 Day를 한 쿼리로 스캔한다
    (DISTINCT ON으로 Day별 order_index 최댓값 슬롯만 남김).
    이동시간이 저장돼 있지 않아(숙소까지는 외부 API 필요) PostGIS 직선거리로 근사한다 —
    경고가 목적이지 정확한 안내가 아니라 충분하다. 숙소 미입력인 Day는 결과에서 빠진다(FFE #7)."""
    rows = await db.fetch(
        "SELECT DISTINCT ON (rs.day_number) rs.day_number, "
        "ST_Distance(p.location, a.location) AS distance_m "
        "FROM route_slots rs "
        "JOIN places p ON p.id = rs.place_id "
        "JOIN accommodations a ON a.route_id = rs.route_id "
        "  AND a.check_in_date <= ($2::date + (rs.day_number - 1) * interval '1 day') "
        "  AND a.check_out_date > ($2::date + (rs.day_number - 1) * interval '1 day') "
        "WHERE rs.route_id = $1 "
        "ORDER BY rs.day_number, rs.order_index DESC",
        route_id, start_date,
    )
    return {r["day_number"]: float(r["distance_m"]) for r in rows if r["distance_m"] is not None}


async def _load_budget_today(db: asyncpg.Pool, route_id: str, today: date) -> tuple[dict | None, int]:
    row = await db.fetchrow(
        "SELECT bs.total_budget, "
        "COALESCE(SUM(e.actual_amount) FILTER ("
        "  WHERE (e.created_at AT TIME ZONE 'Asia/Seoul')::date = $2"
        "), 0) AS spent_today "
        "FROM budget_settings bs "
        "LEFT JOIN expenses e ON e.route_id = bs.route_id "
        "WHERE bs.route_id = $1 "
        "GROUP BY bs.total_budget",
        route_id, today,
    )
    if row is None:
        return None, 0  # FFE #6 — budget_settings 없음
    return {"total": row["total_budget"]}, row["spent_today"]


async def _load_nearby_bookmarks(
    db: asyncpg.Pool, user_id: str, route_id: str, coords: tuple[float, float], day_number: int
) -> list[dict]:
    """추정 슬롯 반경 _BOOKMARK_RADIUS_M 내 유저 북마크 중 오늘 루트에 없는 것, 거리순 1건.
    위치 확신이 높을 때만 호출한다 — 낮으면 T6를 스킵하므로 쿼리가 낭비다."""
    lng, lat = coords
    rows = await db.fetch(
        "SELECT p.name AS place_name, "
        "ST_Distance(p.location, ST_MakePoint($3, $4)::geography) AS distance_m "
        "FROM bookmarks b JOIN places p ON p.id = b.place_id "
        "WHERE b.user_id = $1 "
        "AND ST_DWithin(p.location, ST_MakePoint($3, $4)::geography, $5) "
        "AND p.id NOT IN (SELECT place_id FROM route_slots WHERE route_id = $2 AND day_number = $6) "
        "ORDER BY distance_m LIMIT 1",
        user_id, route_id, lng, lat, _BOOKMARK_RADIUS_M, day_number,
    )
    return [{"place_name": r["place_name"], "distance_m": float(r["distance_m"])} for r in rows]


async def _load_day_weather(
    redis, route: asyncpg.Record, phase: str, now: datetime
) -> tuple[dict[str, float], dict[str, float] | None]:
    """pre_trip이면 Day1(=start_date), during이면 오늘 날짜의 강수확률 블록·기온만 뽑아 반환한다.
    OpenWeatherMap 무료 티어 응답을 Redis 캐시로 경유(_fetch_forecast_raw) — 챗봇 도구와 캐시 공유."""
    coords = CITY_CENTERS.get(route["destination"])
    if coords is None or not settings.openweathermap_api_key:
        return {}, None
    lon, lat = coords

    items = await _fetch_forecast_raw(lat, lon, settings.openweathermap_api_key, redis)
    blocks = _aggregate_blocks(items)
    temps = _temps_by_date(items)

    target_date = (route["start_date"] if phase == "pre_trip" else now.date()).isoformat()
    return blocks.get(target_date, {}), temps.get(target_date)


def _current_and_next(today_slots: list[asyncpg.Record], estimated: dict) -> tuple[dict | None, dict | None]:
    """추정 현재 슬롯과 바로 다음 슬롯을 오늘 슬롯 목록에서 찾는다. T2·T7 전용 재료.
    순수 함수 — DB 접근 없이 이미 로드된 today_slots에서만 찾는다.

    next는 반드시 **바로 다음** 슬롯이다. start_time이 없어도 건너뛰지 않고 그대로 넘겨,
    T2·T7의 FFE #8 가드가 스킵하게 둔다. 건너뛰면 안 되는 이유는 transport_minutes가
    '그 슬롯에서 바로 다음 슬롯까지'의 이동시간이기 때문이다 — [A(→B 10분), B(시각없음),
    C(14:00)]에서 B를 건너뛰면 leave_by = 14:00 - 10분이 되는데 그 10분은 A→B 값이라
    B를 거쳐 가는 시간이 통째로 빠진다. 틀린 시각으로 알림을 띄우느니 안 띄우는 게 낫다.

    참고: _estimate_current_slot(chat_service)은 start_time IS NOT NULL인 슬롯만 보는데
    today_slots는 필터되지 않은 목록이라 두 쪽이 보는 범위가 다르다. current를 order_index
    '값'으로 매칭하므로(인덱스가 아니라) 이 비대칭이 current 선택은 깨뜨리지 않는다."""
    if estimated["confidence"] != "high":
        return None, None

    idx = next((i for i, s in enumerate(today_slots) if s["order_index"] == estimated["order_index"]), None)
    if idx is None:
        return None, None

    current = today_slots[idx]
    current_dict = {
        "start_time": current["start_time"],
        "duration_minutes": current["duration_minutes"],
        "transport_to_next": current["transport_to_next"],
        "transport_minutes": current["transport_minutes"],
    }
    if idx + 1 >= len(today_slots):
        return current_dict, None
    next_slot = today_slots[idx + 1]
    next_dict = {
        "place_id": next_slot["place_id"],
        "place_name": next_slot["place_name"],
        "start_time": next_slot["start_time"],
        "business_hours": next_slot["business_hours"],
        "break_time": next_slot["break_time"],
        "last_order_minutes": next_slot["last_order_minutes"],
        "last_entry_minutes": next_slot["last_entry_minutes"],
    }
    return current_dict, next_dict


async def _build_snapshot(
    db: asyncpg.Pool, redis, route: asyncpg.Record, phase: str, now: datetime, user_id: str
) -> dict:
    """규칙들이 볼 재료를 단계별로 모은다. phase에 따라 필요한 것만 조회한다."""
    snap: dict = {"route": route, "now": now}

    try:
        snap["day_forecast"], snap["day_temps"] = await _load_day_weather(redis, route, phase, now)
    except Exception as e:
        logger.warning("프로액티브 날씨 조회 실패 — 날씨 규칙 스킵: %s", e)
        snap["day_forecast"], snap["day_temps"] = {}, None

    if phase == "pre_trip":
        slots = await _load_slots(db, route["id"])
        snap["day1_slots"] = [s for s in slots if s["day_number"] == 1]
        days_slots: dict[int, list] = {}
        for s in slots:
            days_slots.setdefault(s["day_number"], []).append(s)
        snap["days_slots"] = days_slots
        snap["stay_distances"] = await _load_stay_distances(db, route["id"], route["start_date"])
        return snap

    # during
    today_day_number = (now.date() - route["start_date"]).days + 1
    slots = await _load_slots(db, route["id"])
    today_slots = [s for s in slots if s["day_number"] == today_day_number]
    snap["today_day_number"] = today_day_number
    snap["today_date"] = now.date()
    snap["today_slots"] = today_slots

    estimated = await _estimate_current_slot(db, route)
    snap["estimated"] = estimated
    snap["current_slot"], snap["next_slot"] = _current_and_next(today_slots, estimated)

    snap["closures_today"] = await _load_closures(db, route["id"], now.date())
    snap["last_transit"] = await _load_last_transit(db, redis, route, today_slots, now)

    snap["budget"], snap["spent_today"] = await _load_budget_today(db, route["id"], now.date())

    snap["nearby_bookmarks"] = (
        await _load_nearby_bookmarks(db, user_id, route["id"], estimated["coords"], today_day_number)
        if estimated["confidence"] == "high"
        else []
    )

    return snap


async def get_intervention(db: asyncpg.Pool, redis, user_id: str, route_id: str) -> dict | None:
    """진입점. route_id가 user_id 소유가 아니면 RouteNotFoundError를 던진다(chat_service와 동일)."""
    route = await _load_route(db, user_id, route_id)

    now = datetime.now(_KST)
    phase = _trip_phase(route, now)
    if phase == "out_of_range":
        return None  # FFE #1 — 쿼리 1개로 종료. 대부분의 호출이 여기서 끝난다

    snap = await _build_snapshot(db, redis, route, phase, now, user_id)
    rules = _RULES_PRE_TRIP if phase == "pre_trip" else _RULES_DURING
    candidates = [c for c in (rule(snap) for rule in rules) if c is not None]
    dismissed = await _load_dismissed(redis, user_id, route_id, now)
    candidates = [c for c in candidates if _dismiss_member(c) not in dismissed]  # ← _select 앞!
    return _select(candidates)
