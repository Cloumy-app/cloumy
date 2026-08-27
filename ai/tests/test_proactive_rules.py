from datetime import date, datetime, time, timedelta

from app.services.chat_service import _KST
from app.services.proactive_service import (
    _RULES_PRE_TRIP,
    _break_for,
    _current_and_next,
    _dismiss_member,
    _hours_for,
    _rule_bookmark_nearby,
    _rule_break_time,
    _rule_budget_over,
    _rule_closed_day,
    _rule_departure_soon,
    _rule_empty_day,
    _rule_flight_departure,
    _rule_free_gap,
    _rule_last_entry,
    _rule_last_transit,
    _rule_payment_wall,
    _rule_pre_trip_briefing,
    _rule_reservation_wall,
    _rule_return_departure,
    _rule_weather_alert,
    _select,
    _trip_phase,
)

# ============================================================
# _trip_phase — 조기 종료(FFE #1)의 근거
# ============================================================

def test_trip_phase_pre_trip_is_day_before_start():
    route = {"start_date": date(2026, 7, 28), "end_date": date(2026, 7, 30)}
    now = datetime(2026, 7, 27, 10, 0, tzinfo=_KST)
    assert _trip_phase(route, now) == "pre_trip"


def test_trip_phase_during_is_within_range():
    route = {"start_date": date(2026, 7, 28), "end_date": date(2026, 7, 30)}
    now = datetime(2026, 7, 29, 10, 0, tzinfo=_KST)
    assert _trip_phase(route, now) == "during"


def test_trip_phase_out_of_range_before_and_after():
    route = {"start_date": date(2026, 7, 28), "end_date": date(2026, 7, 30)}
    assert _trip_phase(route, datetime(2026, 7, 20, 10, 0, tzinfo=_KST)) == "out_of_range"
    assert _trip_phase(route, datetime(2026, 8, 5, 10, 0, tzinfo=_KST)) == "out_of_range"


# ============================================================
# _select — 지금은 priority 최솟값 (나중에 LLM 교체 지점)
# ============================================================

def test_select_picks_min_priority():
    candidates = [{"type": "A", "priority": 5}, {"type": "B", "priority": 2}]
    assert _select(candidates)["type"] == "B"


def test_select_empty_returns_none():
    assert _select([]) is None


# ============================================================
# P1. PRE_TRIP_BRIEFING
# ============================================================

def _base_pre_trip_snap(departure_at=None, return_at=None, **overrides) -> dict:
    snap = {
        "route": {"nights": 2, "destination": "서울", "departure_at": departure_at, "return_at": return_at},
        "day1_slots": [],
        "day_forecast": {},
        "day_temps": None,
        "days_slots": {},
        "stay_distances": {},
    }
    snap.update(overrides)
    return snap


def test_pre_trip_briefing_fires_with_rain_flag():
    snap = _base_pre_trip_snap(day_forecast={"오후": 0.8})
    result = _rule_pre_trip_briefing(snap)
    assert result is not None
    assert result["type"] == "PRE_TRIP_BRIEFING"
    kinds = [f["kind"] for f in result["params"]["flags"]]
    assert "rain" in kinds


def test_pre_trip_briefing_no_diagnostics_returns_none():
    snap = _base_pre_trip_snap()
    assert _rule_pre_trip_briefing(snap) is None


def test_pre_trip_briefing_aggregates_multiple_flags():
    # 5슬롯 이상 + 총 이동시간 180분 이상 → packed_day, 도보 40분 → long_walk,
    # 첫 슬롯 → first_slot 이 한 번에 flags에 담겨야 한다 (전부 Day1에서 발생)
    slots = [
        {"transport_minutes": 40, "transport_to_next": "walk", "start_time": time(9, 0), "place_name": "경복궁"},
        {"transport_minutes": 40, "transport_to_next": "transit", "start_time": time(11, 0), "place_name": "인사동"},
        {"transport_minutes": 40, "transport_to_next": "transit", "start_time": time(13, 0), "place_name": "북촌"},
        {"transport_minutes": 40, "transport_to_next": "transit", "start_time": time(15, 0), "place_name": "광장시장"},
        {"transport_minutes": 40, "transport_to_next": "transit", "start_time": time(18, 0), "place_name": "청계천"},
    ]
    snap = _base_pre_trip_snap(day1_slots=slots, days_slots={1: slots})
    result = _rule_pre_trip_briefing(snap)
    flags = result["params"]["flags"]
    kinds = {f["kind"] for f in flags}
    assert {"packed_day", "long_walk", "first_slot"} <= kinds
    packed_flag = next(f for f in flags if f["kind"] == "packed_day")
    assert packed_flag["day"] == 1
    long_walk_flag = next(f for f in flags if f["kind"] == "long_walk")
    assert long_walk_flag["day"] == 1


# ============================================================
# P1 보정 — packed_day/far_from_stay/long_walk은 전체 Day를 스캔한다(D-1이 고칠 마지막 기회).
# rain/heat/cold/first_slot은 여전히 Day1만(짐 싸기·첫 일정 안내가 목적).
# ============================================================

def test_pre_trip_briefing_packed_day_scans_all_days_not_just_day1():
    # Day1은 한산, Day3이 빡빡 — Day1만 보면 놓치는 케이스라 Day3에서 잡혀야 한다
    day1 = [{"transport_minutes": 10, "transport_to_next": "walk", "start_time": time(9, 0), "place_name": "A"}]
    day3 = [
        {"transport_minutes": 40, "transport_to_next": "transit", "start_time": None, "place_name": f"P{i}"}
        for i in range(5)
    ]
    snap = _base_pre_trip_snap(day1_slots=day1, days_slots={1: day1, 3: day3})
    result = _rule_pre_trip_briefing(snap)
    assert result is not None
    packed_flag = next(f for f in result["params"]["flags"] if f["kind"] == "packed_day")
    assert packed_flag["day"] == 3


def test_pre_trip_briefing_packed_day_picks_worst_day_when_multiple():
    day2 = [
        {"transport_minutes": 40, "transport_to_next": "transit", "start_time": None, "place_name": f"D2-{i}"}
        for i in range(5)
    ]  # 총 이동시간 200분
    day3 = [
        {"transport_minutes": 60, "transport_to_next": "transit", "start_time": None, "place_name": f"D3-{i}"}
        for i in range(5)
    ]  # 총 이동시간 300분 — 더 심함
    snap = _base_pre_trip_snap(days_slots={2: day2, 3: day3})
    result = _rule_pre_trip_briefing(snap)
    packed_flag = next(f for f in result["params"]["flags"] if f["kind"] == "packed_day")
    assert packed_flag["day"] == 3


def test_pre_trip_briefing_far_from_stay_scans_all_days():
    snap = _base_pre_trip_snap(stay_distances={2: 9000.0})
    result = _rule_pre_trip_briefing(snap)
    assert result is not None
    flag = next(f for f in result["params"]["flags"] if f["kind"] == "far_from_stay")
    assert flag["day"] == 2
    assert flag["distanceM"] == 9000


def test_pre_trip_briefing_far_from_stay_picks_farthest_day_when_multiple():
    snap = _base_pre_trip_snap(stay_distances={1: 8500.0, 2: 12000.0})
    result = _rule_pre_trip_briefing(snap)
    flag = next(f for f in result["params"]["flags"] if f["kind"] == "far_from_stay")
    assert flag["day"] == 2


def test_pre_trip_briefing_long_walk_scans_all_days_picks_longest():
    days_slots = {
        1: [{"transport_minutes": 45, "transport_to_next": "walk", "start_time": None, "place_name": "A"}],
        2: [{"transport_minutes": 55, "transport_to_next": "walk", "start_time": None, "place_name": "B"}],
    }
    snap = _base_pre_trip_snap(days_slots=days_slots)
    result = _rule_pre_trip_briefing(snap)
    flag = next(f for f in result["params"]["flags"] if f["kind"] == "long_walk")
    assert flag["day"] == 2
    assert flag["minutes"] == 55


def test_pre_trip_briefing_rain_heat_cold_ignore_other_days():
    # day_forecast/day_temps는 항상 Day1(start_date) 기준으로만 로드되므로,
    # Day3에 빡빡한 일정이 있어도 rain/heat/cold 판정에는 영향을 주지 않는다
    day3 = [
        {"transport_minutes": 40, "transport_to_next": "transit", "start_time": None, "place_name": f"P{i}"}
        for i in range(5)
    ]
    snap = _base_pre_trip_snap(day_forecast={"오후": 0.9}, days_slots={3: day3})
    result = _rule_pre_trip_briefing(snap)
    kinds = {f["kind"] for f in result["params"]["flags"]}
    assert "rain" in kinds
    assert "packed_day" in kinds  # Day3도 여전히 스캔됨 — rain과 무관하게 독립적으로 평가


# ============================================================
# T1. FLIGHT_DEPARTURE
# ============================================================

def test_flight_departure_fires_within_window():
    now = datetime(2026, 7, 29, 10, 0, tzinfo=_KST)
    # 서울 공항이동 90분 + 체크인버퍼 120분 = 210분. 30분 여유를 두고 departure_at 설정
    departure_at = now + timedelta(minutes=210 + 30)
    snap = {"route": {"departure_at": departure_at, "destination": "서울"}, "now": now}
    result = _rule_flight_departure(snap)
    assert result is not None
    assert result["type"] == "FLIGHT_DEPARTURE"
    assert result["params"]["departureAt"] == departure_at.isoformat()


def test_flight_departure_none_when_departure_at_missing():
    now = datetime(2026, 7, 29, 10, 0, tzinfo=_KST)
    snap = {"route": {"departure_at": None, "destination": "서울"}, "now": now}
    assert _rule_flight_departure(snap) is None  # FFE #5 — 선택 입력 미입력


def test_flight_departure_none_when_too_early():
    now = datetime(2026, 7, 29, 10, 0, tzinfo=_KST)
    departure_at = now + timedelta(minutes=210 + 400)  # 아직 한참 남음
    snap = {"route": {"departure_at": departure_at, "destination": "서울"}, "now": now}
    assert _rule_flight_departure(snap) is None


# ============================================================
# T1 pre_trip 등록 — 새벽 항공편이 D-1에도 잡혀야 한다 (리뷰 9번 회귀 방지)
# ============================================================

def test_flight_departure_fires_in_pre_trip_phase():
    # 익일 새벽 출발 항공편 — D-1 밤 시각에 leave_by 창(0~60분)에 들어와야 한다
    now = datetime(2026, 7, 29, 23, 50, tzinfo=_KST)
    departure_at = now + timedelta(minutes=210 + 30)
    snap = _base_pre_trip_snap(departure_at=departure_at, now=now)
    candidates = [c for c in (rule(snap) for rule in _RULES_PRE_TRIP) if c is not None]
    result = _select(candidates)
    assert result is not None
    assert result["type"] == "FLIGHT_DEPARTURE"


def test_pre_trip_briefing_loses_to_flight_departure():
    # PRE_TRIP_BRIEFING(비 예보)도 동시에 발동 조건을 만족시킨다 — 둘 다 priority=1 동점.
    # _select는 min()이라 동점이면 리스트 등록 순서가 이긴다. T1이 먼저 등록돼야 한다(FFE #5).
    now = datetime(2026, 7, 29, 23, 50, tzinfo=_KST)
    departure_at = now + timedelta(minutes=210 + 30)
    snap = _base_pre_trip_snap(departure_at=departure_at, now=now, day_forecast={"오후": 0.8})
    candidates = [c for c in (rule(snap) for rule in _RULES_PRE_TRIP) if c is not None]
    assert {c["type"] for c in candidates} == {"FLIGHT_DEPARTURE", "PRE_TRIP_BRIEFING"}
    result = _select(candidates)
    assert result["type"] == "FLIGHT_DEPARTURE"


# ============================================================
# RETURN. RETURN_DEPARTURE — T1과 대칭인 오는 편 규칙
# ============================================================

def test_return_departure_fires_within_window():
    now = datetime(2026, 7, 29, 10, 0, tzinfo=_KST)
    # 서울 공항이동 90분 + 체크인버퍼 120분 = 210분. 30분 여유를 두고 return_at 설정
    return_at = now + timedelta(minutes=210 + 30)
    snap = {"route": {"return_at": return_at, "destination": "서울"}, "now": now}
    result = _rule_return_departure(snap)
    assert result is not None
    assert result["type"] == "RETURN_DEPARTURE"
    assert result["params"]["returnAt"] == return_at.isoformat()


def test_return_departure_none_when_not_set():
    now = datetime(2026, 7, 29, 10, 0, tzinfo=_KST)
    snap = {"route": {"return_at": None, "destination": "서울"}, "now": now}
    assert _rule_return_departure(snap) is None  # FFE #4 — 오는 편 미입력이면 이 규칙만 스킵


def test_return_departure_none_when_window_passed():
    now = datetime(2026, 7, 29, 10, 0, tzinfo=_KST)
    return_at = now + timedelta(minutes=200)  # leave_by = return_at - 210 = now - 10분(이미 지남)
    snap = {"route": {"return_at": return_at, "destination": "서울"}, "now": now}
    assert _rule_return_departure(snap) is None


# ============================================================
# T2. DEPARTURE_SOON
# ============================================================

def test_departure_soon_fires_within_window():
    today = date(2026, 7, 29)
    now = datetime(2026, 7, 29, 13, 40, tzinfo=_KST)
    snap = {
        "estimated": {"confidence": "high"},
        "current_slot": {"transport_minutes": 10},
        "next_slot": {"start_time": time(14, 0), "place_name": "경복궁"},
        "today_date": today,
        "now": now,
    }
    result = _rule_departure_soon(snap)
    assert result is not None
    assert result["params"]["nextPlaceName"] == "경복궁"
    assert result["params"]["transportMinutes"] == 10


def test_departure_soon_none_when_confidence_low():
    today = date(2026, 7, 29)
    now = datetime(2026, 7, 29, 13, 40, tzinfo=_KST)
    snap = {
        "estimated": {"confidence": "low"},
        "current_slot": {"transport_minutes": 10},
        "next_slot": {"start_time": time(14, 0), "place_name": "경복궁"},
        "today_date": today,
        "now": now,
    }
    assert _rule_departure_soon(snap) is None  # FFE #9 — 확신 낮으면 위치 의존 규칙 스킵


# ============================================================
# T3. EMPTY_DAY
# ============================================================

def test_empty_day_fires_in_morning_with_no_slots():
    now = datetime(2026, 7, 29, 9, 0, tzinfo=_KST)
    snap = {"now": now, "today_slots": [], "today_day_number": 2}
    result = _rule_empty_day(snap)
    assert result is not None
    assert result["params"] == {"day": 2, "slotCount": 0}


def test_empty_day_none_in_afternoon():
    now = datetime(2026, 7, 29, 15, 0, tzinfo=_KST)
    snap = {"now": now, "today_slots": [], "today_day_number": 2}
    assert _rule_empty_day(snap) is None  # 저녁엔 이미 늦은 진단


# ============================================================
# T4. WEATHER_ALERT
# ============================================================

def test_weather_alert_fires_when_rain_and_outdoor_slot_exists():
    snap = {
        "day_forecast": {"오후": 0.8},
        "day_temps": None,
        "today_slots": [{"category_tags": ["#관광"]}],
        "today_day_number": 1,
    }
    result = _rule_weather_alert(snap)
    assert result is not None
    assert result["params"]["kind"] == "rain"
    assert result["params"]["outdoorCount"] == 1


def test_weather_alert_none_when_all_slots_indoor():
    snap = {
        "day_forecast": {"오후": 0.8},
        "day_temps": None,
        "today_slots": [{"category_tags": ["#실내"]}],
        "today_day_number": 1,
    }
    assert _rule_weather_alert(snap) is None  # 실외 슬롯 0개면 경고 의미 없음


def test_weather_alert_none_when_no_weather_condition():
    snap = {
        "day_forecast": {},
        "day_temps": None,
        "today_slots": [{"category_tags": ["#관광"]}],
        "today_day_number": 1,
    }
    assert _rule_weather_alert(snap) is None


# ============================================================
# T5. BUDGET_OVER
# ============================================================

def test_budget_over_fires_when_spent_exceeds_ratio():
    snap = {"budget": {"total": 300000}, "route": {"nights": 2}, "spent_today": 130000}
    result = _rule_budget_over(snap)
    assert result is not None
    assert result["params"]["dailyBudget"] == 100000
    assert result["params"]["spentToday"] == 130000


def test_budget_over_none_when_budget_missing():
    snap = {"budget": None, "route": {"nights": 2}, "spent_today": 999999}
    assert _rule_budget_over(snap) is None  # FFE #6


# ============================================================
# T6. BOOKMARK_NEARBY
# ============================================================

def test_bookmark_nearby_fires_with_nearest_bookmark():
    snap = {
        "estimated": {"confidence": "high"},
        "nearby_bookmarks": [{"place_name": "덕수궁", "distance_m": 120.4}],
    }
    result = _rule_bookmark_nearby(snap)
    assert result is not None
    assert result["params"] == {"placeName": "덕수궁", "distanceM": 120}


def test_bookmark_nearby_none_when_confidence_low():
    snap = {
        "estimated": {"confidence": "low"},
        "nearby_bookmarks": [{"place_name": "덕수궁", "distance_m": 120.4}],
    }
    assert _rule_bookmark_nearby(snap) is None  # FFE #9


# ============================================================
# T7. FREE_GAP
# ============================================================

def _free_gap_snap(now_hm: tuple[int, int], next_hm: tuple[int, int] = (13, 0)) -> dict:
    """T7 스냅샷 — current는 10:00 시작 60분(이동 10분)으로 고정, now와 next만 바꾼다.
    current_end=11:00, threshold=10+60=70분이 기준선이다."""
    today = date(2026, 7, 29)
    return {
        "estimated": {"confidence": "high"},
        "current_slot": {"start_time": time(10, 0), "duration_minutes": 60, "transport_minutes": 10},
        "next_slot": {"start_time": time(*next_hm)},
        "today_date": today,
        "now": datetime(2026, 7, 29, *now_hm, tzinfo=_KST),
    }


def test_free_gap_fires_when_gap_exceeds_threshold():
    # 공백(11:00~13:00) 시작 시점에 열면 남은 여유 120분 ≥ threshold 70분
    result = _rule_free_gap(_free_gap_snap((11, 0)))
    assert result is not None
    assert result["params"]["gapMinutes"] == 120


def test_free_gap_none_when_gap_within_threshold():
    # current_end=11:00, next_start=11:30 → 남은 여유 30분 < threshold 70분
    assert _rule_free_gap(_free_gap_snap((11, 0), next_hm=(11, 30))) is None


def test_free_gap_none_when_now_before_gap():
    """첫 일정 시작 전에는 발동하면 안 된다.

    _estimate_current_slot이 첫 일정 전에도 slots[0]을 high로 잡아주기 때문에
    now를 안 보면 아침에 열어도 발동한다. 그러면 그날 dismiss를 소모해
    정작 실제 공백(11:00~13:00)에는 배너가 안 뜬다."""
    assert _rule_free_gap(_free_gap_snap((8, 0))) is None


def test_free_gap_none_when_now_after_gap():
    # 다음 일정이 이미 시작됐으면 여유가 아니다
    assert _rule_free_gap(_free_gap_snap((13, 30))) is None


def test_free_gap_reports_remaining_not_planned_gap():
    """공백 한가운데서는 계획상 공백(120분)이 아니라 남은 여유를 안내해야 한다.

    문구가 "다음 일정까지 {{gapMinutes}}분 여유가 있어요"이므로 이미 지나간
    시간까지 세면 과대 안내가 된다."""
    result = _rule_free_gap(_free_gap_snap((11, 30)))
    assert result is not None
    assert result["params"]["gapMinutes"] == 90


# ============================================================
# _current_and_next — T2·T7의 재료를 고르는 함수
#
# 이 함수의 동작을 여기 못박아 두는 이유가 있다. proactive의 _load_slots는
# start_time 필터 없이 전 슬롯을 가져오는데 chat_service의 _estimate_current_slot은
# start_time IS NOT NULL만 본다. 이 비대칭을 보고 "시간 미입력 슬롯을 건너뛰고
# 그 다음을 next로 잡아야 한다"고 판단하기 쉽다(2026-07-29 코드 리뷰가 실제로
# 그렇게 지적했다). 그건 오답이다 — 아래 테스트가 그 이유를 담고 있다.
# ============================================================

def _slot(order_index: int, start_time: time | None, place_name: str = "장소") -> dict:
    """_current_and_next는 키 서브스크립트만 쓰므로 asyncpg.Record 대신 dict로 충분하다."""
    return {
        "order_index": order_index,
        "place_id": f"place-{order_index}",
        "start_time": start_time,
        "place_name": place_name,
        "duration_minutes": 60,
        "transport_to_next": "transit",
        "transport_minutes": 10,
        "business_hours": None,
        "break_time": None,
        "last_order_minutes": None,
        "last_entry_minutes": None,
    }


def test_current_and_next_does_not_skip_untimed_slot():
    """시간 미입력 슬롯을 건너뛰고 그 다음을 next로 잡으면 안 된다.

    transport_minutes는 '그 슬롯에서 바로 다음 슬롯까지'의 이동시간이다.
    [10:00 A(→B 10분), (미입력) B, 14:00 C]에서 B를 건너뛰고 C를 next로 잡으면
    _rule_departure_soon이 leave_by = 14:00 - 10분 = 13:50을 만드는데, 그 10분은
    A→B 이동시간이라 실제로는 B를 거쳐 가야 하는 시간이 통째로 빠진다.
    틀린 시각으로 알림을 띄우느니 안 띄우는 게 낫다 — 그래서 next를 그대로 넘기고
    T2·T7의 FFE #8 가드가 스킵하게 둔다."""
    today_slots = [_slot(0, time(10, 0), "A"), _slot(1, None, "B"), _slot(2, time(14, 0), "C")]
    current, next_slot = _current_and_next(today_slots, {"confidence": "high", "order_index": 0})

    assert current["start_time"] == time(10, 0)
    assert next_slot["place_name"] == "B"      # C로 건너뛰면 안 된다
    assert next_slot["start_time"] is None     # 시각을 모른 채로 넘어간다


def test_current_and_next_none_when_confidence_low():
    """위치 추정이 불확실하면 T2·T7의 재료를 아예 만들지 않는다."""
    today_slots = [_slot(0, time(10, 0)), _slot(1, time(14, 0))]
    assert _current_and_next(today_slots, {"confidence": "low"}) == (None, None)


def test_current_and_next_none_for_last_slot():
    """그날 마지막 슬롯이면 next가 없다."""
    today_slots = [_slot(0, time(10, 0)), _slot(1, time(14, 0))]
    current, next_slot = _current_and_next(today_slots, {"confidence": "high", "order_index": 1})

    assert current["start_time"] == time(14, 0)
    assert next_slot is None


# ============================================================
# _dismiss_member — Spring ProactiveController가 Redis에 기록하는 멤버 형식과
# 1:1로 맞춰야 한다. 문자열 "None"/"null"이 새어들어가면 필터링이 깨진다(고정 계약 위반).
# ============================================================

def test_dismiss_member_with_place_id():
    candidate = {"type": "CLOSED_DAY", "params": {"placeId": "11111111-1111-1111-1111-111111111111"}}
    assert _dismiss_member(candidate) == "CLOSED_DAY:11111111-1111-1111-1111-111111111111"


def test_dismiss_member_without_place_id_key():
    # params에 placeId 키 자체가 없는 경우 — 장소 무관 규칙(기존 9종)
    candidate = {"type": "WEATHER_ALERT", "params": {"day": 1, "kind": "rain"}}
    assert _dismiss_member(candidate) == "WEATHER_ALERT:-"


def test_dismiss_member_with_place_id_none():
    # params에 placeId: None이 명시돼도 문자열 "None"이 아니라 "-"여야 한다
    candidate = {"type": "PAYMENT_WALL", "params": {"placeId": None}}
    assert _dismiss_member(candidate) == "PAYMENT_WALL:-"


# ============================================================
# _hours_for / _break_for — 영업시간·브레이크타임 파서(순수 함수, 단독 테스트)
# ============================================================

def test_hours_for_returns_open_close_for_weekday():
    business_hours = {"open": "10:00", "close": "22:00"}
    assert _hours_for(business_hours, 3) == (time(10, 0), time(22, 0))


def test_hours_for_applies_weekday_override():
    business_hours = {
        "open": "10:00", "close": "22:00",
        "weekday_overrides": {"7": {"open": "11:00", "close": "18:00"}},
    }
    assert _hours_for(business_hours, 7) == (time(11, 0), time(18, 0))


def test_hours_for_none_when_not_investigated():
    assert _hours_for(None, 3) is None  # 미조사


def test_hours_for_none_when_malformed():
    # 수기 CSV라 깨진 값이 들어올 수 있다(FFE #4) — 예외를 삼키고 None
    assert _hours_for({"open": "not-a-time", "close": "22:00"}, 3) is None


def test_break_for_returns_start_end():
    break_time = {"start": "15:00", "end": "17:00"}
    assert _break_for(break_time, 3) == (time(15, 0), time(17, 0))


def test_break_for_none_on_except_weekday():
    break_time = {"start": "15:00", "end": "17:00", "except_weekdays": [6, 7]}
    assert _break_for(break_time, 7) is None  # 그 요일은 브레이크타임 없음


def test_break_for_none_when_not_investigated():
    assert _break_for(None, 3) is None


def test_break_for_none_when_malformed():
    assert _break_for({"start": "oops", "end": "17:00"}, 3) is None


# ============================================================
# LAST_TRANSIT — 오늘 마지막 슬롯 → 숙소 막차. 위치 가드 없음(상위 계획서 정정 2).
# leave_by가 '유저 현재 위치'가 아니라 '마지막 슬롯 → 숙소' 구간으로 계산되기 때문이다.
# ============================================================

def test_last_transit_fires_within_window():
    now = datetime(2026, 7, 29, 22, 30, tzinfo=_KST)
    leave_by = now + timedelta(minutes=30)
    snap = {
        "now": now,
        "last_transit": {
            "placeId": "11111111-1111-1111-1111-111111111111",
            "placeName": "숙소행 정류장",
            "leaveBy": leave_by,
            "minutes": 25,
            "fare": 1500,
        },
    }
    result = _rule_last_transit(snap)
    assert result is not None
    assert result["type"] == "LAST_TRANSIT"
    assert result["params"]["leaveByTime"] == leave_by.isoformat()
    assert result["params"]["fare"] == 1500


def test_last_transit_none_when_not_calculated():
    # 비용 방어(18시 이전)·숙소 미입력·Tmap 실패 등으로 loader가 이미 None을 준 경우
    snap = {"now": datetime(2026, 7, 29, 22, 30, tzinfo=_KST), "last_transit": None}
    assert _rule_last_transit(snap) is None


def test_last_transit_none_when_window_not_yet_open():
    now = datetime(2026, 7, 29, 20, 0, tzinfo=_KST)
    snap = {
        "now": now,
        "last_transit": {
            "placeId": "p", "placeName": "정류장",
            "leaveBy": now + timedelta(minutes=90),  # 아직 window(60분) 밖
            "minutes": 20, "fare": None,
        },
    }
    assert _rule_last_transit(snap) is None


def test_last_transit_none_when_already_passed():
    now = datetime(2026, 7, 29, 23, 0, tzinfo=_KST)
    snap = {
        "now": now,
        "last_transit": {
            "placeId": "p", "placeName": "정류장",
            "leaveBy": now - timedelta(minutes=5),  # 이미 지남
            "minutes": 20, "fare": None,
        },
    }
    assert _rule_last_transit(snap) is None


def test_last_transit_fires_even_when_confidence_low():
    # 상위 계획서 정정 2 — LAST_TRANSIT엔 위치 가드가 없다. 밤 시간대엔 confidence가
    # 낮게 나오기 쉬운데, 가드를 붙이면 정확히 필요한 시간에 규칙이 죽어버린다.
    now = datetime(2026, 7, 29, 23, 0, tzinfo=_KST)
    snap = {
        "now": now,
        "estimated": {"confidence": "low"},
        "last_transit": {
            "placeId": "p", "placeName": "정류장",
            "leaveBy": now + timedelta(minutes=10),
            "minutes": 15, "fare": None,
        },
    }
    assert _rule_last_transit(snap) is not None


# ============================================================
# CLOSED_DAY — 날짜 예외(place_closures)와 요일 규칙(closed_weekdays)을 OR로 판정.
# 위치 가드 없음.
# ============================================================

def _closed_day_slot(place_id: str, place_name: str, closed_weekdays: list[int] | None) -> dict:
    return {"place_id": place_id, "place_name": place_name, "closed_weekdays": closed_weekdays}


def test_closed_day_fires_on_date_exception():
    snap = {
        "closures_today": {"11111111-1111-1111-1111-111111111111"},
        "today_day_number": 2,
        "today_date": date(2026, 7, 29),
        "today_slots": [_closed_day_slot("11111111-1111-1111-1111-111111111111", "국립중앙박물관", None)],
    }
    result = _rule_closed_day(snap)
    assert result is not None
    assert result["params"] == {
        "placeId": "11111111-1111-1111-1111-111111111111", "placeName": "국립중앙박물관", "day": 2,
    }


def test_closed_day_fires_on_weekday_rule():
    today = date(2026, 8, 3)
    snap = {
        "closures_today": set(),
        "today_day_number": 1,
        "today_date": today,
        "today_slots": [_closed_day_slot("p1", "경복궁", [today.isoweekday()])],
    }
    result = _rule_closed_day(snap)
    assert result is not None
    assert result["params"]["placeId"] == "p1"


def test_closed_day_none_when_not_investigated():
    # closed_weekdays가 NULL(미조사)이고 날짜 예외도 없으면 판단 불가 — 스킵(FFE #1)
    snap = {
        "closures_today": set(),
        "today_day_number": 1,
        "today_date": date(2026, 7, 29),
        "today_slots": [_closed_day_slot("p1", "장소", None)],
    }
    assert _rule_closed_day(snap) is None


def test_closed_day_none_when_investigated_and_open():
    today = date(2026, 7, 28)
    other_weekday = (today.isoweekday() % 7) + 1  # 오늘과 다른 요일
    snap = {
        "closures_today": set(),
        "today_day_number": 1,
        "today_date": today,
        "today_slots": [_closed_day_slot("p1", "장소", [other_weekday])],
    }
    assert _rule_closed_day(snap) is None


# ============================================================
# BREAK_TIME — 다음 슬롯 도착 시각이 브레이크타임 구간에 걸리면 개입. 위치 가드 있음.
# ============================================================

def _next_slot_for_hours(
    place_id: str = "p1", place_name: str = "장소", start_time: time = time(15, 30),
    business_hours: dict | None = None, break_time: dict | None = None,
    last_order_minutes: int | None = None, last_entry_minutes: int | None = None,
) -> dict:
    return {
        "place_id": place_id, "place_name": place_name, "start_time": start_time,
        "business_hours": business_hours, "break_time": break_time,
        "last_order_minutes": last_order_minutes, "last_entry_minutes": last_entry_minutes,
    }


def test_break_time_fires_when_arrival_within_break():
    today = date(2026, 7, 29)
    now = datetime(2026, 7, 29, 15, 0, tzinfo=_KST)
    nxt = _next_slot_for_hours(start_time=time(15, 30), break_time={"start": "15:00", "end": "17:00"})
    snap = {"estimated": {"confidence": "high"}, "today_date": today, "now": now, "next_slot": nxt}
    result = _rule_break_time(snap)
    assert result is not None
    assert result["params"] == {
        "placeId": "p1", "placeName": "장소", "breakStart": "15:00:00", "breakEnd": "17:00:00",
    }


def test_break_time_none_when_not_investigated():
    today = date(2026, 7, 29)
    now = datetime(2026, 7, 29, 15, 0, tzinfo=_KST)
    nxt = _next_slot_for_hours(start_time=time(15, 30), break_time=None)
    snap = {"estimated": {"confidence": "high"}, "today_date": today, "now": now, "next_slot": nxt}
    assert _rule_break_time(snap) is None  # FFE #1 — 미조사


def test_break_time_none_when_arrival_outside_break():
    today = date(2026, 7, 29)
    now = datetime(2026, 7, 29, 12, 0, tzinfo=_KST)
    nxt = _next_slot_for_hours(start_time=time(12, 30), break_time={"start": "15:00", "end": "17:00"})
    snap = {"estimated": {"confidence": "high"}, "today_date": today, "now": now, "next_slot": nxt}
    assert _rule_break_time(snap) is None


def test_break_time_none_when_confidence_low():
    today = date(2026, 7, 29)
    now = datetime(2026, 7, 29, 15, 0, tzinfo=_KST)
    nxt = _next_slot_for_hours(start_time=time(15, 30), break_time={"start": "15:00", "end": "17:00"})
    snap = {"estimated": {"confidence": "low"}, "today_date": today, "now": now, "next_slot": nxt}
    assert _rule_break_time(snap) is None


def test_break_time_last_order_moves_cutoff_earlier():
    # 브레이크 시작 16:00, 라스트오더 10분 전(15:50)이면 15:55 도착도 컷오프 이후라 발동해야 한다
    today = date(2026, 7, 29)
    now = datetime(2026, 7, 29, 15, 55, tzinfo=_KST)
    nxt = _next_slot_for_hours(
        start_time=time(15, 55),
        break_time={"start": "16:00", "end": "17:00"},
        last_order_minutes=10,
    )
    snap = {"estimated": {"confidence": "high"}, "today_date": today, "now": now, "next_slot": nxt}
    assert _rule_break_time(snap) is not None


# ============================================================
# RESERVATION_WALL — 예약 필수인데 워크인이 안 되는 장소. 위치 가드 없음.
# ============================================================

def _reservation_slot(
    place_id: str = "p1", place_name: str = "파인다이닝",
    reservation_required: bool | None = None, walk_in_allowed: bool | None = None,
    reservation_platform: str | None = None,
) -> dict:
    return {
        "place_id": place_id, "place_name": place_name,
        "reservation_required": reservation_required, "walk_in_allowed": walk_in_allowed,
        "reservation_platform": reservation_platform,
    }


def test_reservation_wall_fires_when_required_and_no_walk_in():
    snap = {"today_slots": [_reservation_slot(
        reservation_required=True, walk_in_allowed=False, reservation_platform="catchtable",
    )]}
    result = _rule_reservation_wall(snap)
    assert result is not None
    assert result["params"] == {"placeId": "p1", "placeName": "파인다이닝", "reservationPlatform": "catchtable"}


def test_reservation_wall_platform_is_nullable():
    # 예약 필수인 건 알지만 어느 플랫폼인지 미조사일 수 있다
    snap = {"today_slots": [_reservation_slot(reservation_required=True, walk_in_allowed=False)]}
    result = _rule_reservation_wall(snap)
    assert result is not None
    assert result["params"]["reservationPlatform"] is None


def test_reservation_wall_none_when_not_investigated():
    snap = {"today_slots": [_reservation_slot(reservation_required=None)]}
    assert _rule_reservation_wall(snap) is None  # FFE #1 — 미조사


def test_reservation_wall_none_when_not_required():
    snap = {"today_slots": [_reservation_slot(reservation_required=False)]}
    assert _rule_reservation_wall(snap) is None


def test_reservation_wall_none_when_walk_in_allowed():
    snap = {"today_slots": [_reservation_slot(reservation_required=True, walk_in_allowed=True)]}
    assert _rule_reservation_wall(snap) is None


# ============================================================
# PAYMENT_WALL — 현금전용 또는 해외카드 미대응. 위치 가드 없음.
# friendly_foreign_card의 0(조사했는데 없음)과 None(미조사)이 둘 다 falsy라 가장
# 실수하기 쉬운 자리다 — 반드시 다르게 동작해야 한다.
# ============================================================

def _payment_slot(
    place_id: str = "p1", place_name: str = "노포",
    cash_only: bool | None = None, friendly_foreign_card: int | None = None,
) -> dict:
    return {
        "place_id": place_id, "place_name": place_name,
        "cash_only": cash_only, "friendly_foreign_card": friendly_foreign_card,
    }


def test_payment_wall_fires_cash_only():
    snap = {"today_slots": [_payment_slot(cash_only=True)]}
    result = _rule_payment_wall(snap)
    assert result is not None
    assert result["params"]["kind"] == "cash_only"


def test_payment_wall_fires_no_foreign_card_when_zero():
    snap = {"today_slots": [_payment_slot(cash_only=False, friendly_foreign_card=0)]}
    result = _rule_payment_wall(snap)
    assert result is not None
    assert result["params"]["kind"] == "no_foreign_card"


def test_payment_wall_none_when_not_investigated():
    snap = {"today_slots": [_payment_slot(cash_only=None, friendly_foreign_card=None)]}
    assert _rule_payment_wall(snap) is None  # FFE #1


def test_payment_wall_none_when_investigated_and_fine():
    snap = {"today_slots": [_payment_slot(cash_only=False, friendly_foreign_card=2)]}
    assert _rule_payment_wall(snap) is None


def test_payment_wall_foreign_card_zero_vs_none_behave_differently():
    """가장 실수하기 쉬운 자리 — 0(조사했는데 없음)이면 발동해야 하고 None(미조사)이면
    발동하면 안 된다. `is None`과 falsy를 분리하지 않으면 이 테스트가 깨진다."""
    zero_snap = {"today_slots": [_payment_slot(cash_only=False, friendly_foreign_card=0)]}
    none_snap = {"today_slots": [_payment_slot(cash_only=False, friendly_foreign_card=None)]}
    assert _rule_payment_wall(zero_snap) is not None
    assert _rule_payment_wall(none_snap) is None


def test_payment_wall_foreign_card_checked_even_when_cash_only_unknown():
    """두 신호는 독립이다. cash_only가 미조사(None)여도 friendly_foreign_card가 0이면
    발동해야 한다 — 앞 조건에 묶으면 '해외카드만 조사된 장소'가 통째로 침묵한다.
    CSV에서 현금전용 정책은 못 알아내고 해외카드만 확인되는 경우가 흔하다."""
    snap = {"today_slots": [_payment_slot(cash_only=None, friendly_foreign_card=0)]}
    result = _rule_payment_wall(snap)
    assert result is not None
    assert result["params"]["kind"] == "no_foreign_card"


def test_payment_wall_none_when_both_unknown():
    """둘 다 미조사면 아무 결론도 내지 않는다(FFE #1)."""
    snap = {"today_slots": [_payment_slot(cash_only=None, friendly_foreign_card=None)]}
    assert _rule_payment_wall(snap) is None


# ============================================================
# LAST_ENTRY — 다음 슬롯 도착 시각이 라스트엔트리 이후. 위치 가드 있음.
# ============================================================

def test_last_entry_fires_when_past_cutoff():
    today = date(2026, 7, 29)
    now = datetime(2026, 7, 29, 17, 40, tzinfo=_KST)
    nxt = _next_slot_for_hours(
        start_time=time(17, 40),
        business_hours={"open": "09:00", "close": "18:00"},
        last_entry_minutes=30,  # last_entry = 17:30
    )
    snap = {"estimated": {"confidence": "high"}, "today_date": today, "now": now, "next_slot": nxt}
    result = _rule_last_entry(snap)
    assert result is not None
    assert result["params"] == {
        "placeId": "p1", "placeName": "장소", "lastEntryTime": "17:30:00", "closeTime": "18:00:00",
    }


def test_last_entry_none_when_not_investigated():
    today = date(2026, 7, 29)
    now = datetime(2026, 7, 29, 17, 40, tzinfo=_KST)
    nxt = _next_slot_for_hours(start_time=time(17, 40), business_hours=None, last_entry_minutes=None)
    snap = {"estimated": {"confidence": "high"}, "today_date": today, "now": now, "next_slot": nxt}
    assert _rule_last_entry(snap) is None  # FFE #1


def test_last_entry_none_when_still_time():
    today = date(2026, 7, 29)
    now = datetime(2026, 7, 29, 16, 0, tzinfo=_KST)
    nxt = _next_slot_for_hours(
        start_time=time(16, 0),
        business_hours={"open": "09:00", "close": "18:00"},
        last_entry_minutes=30,  # last_entry = 17:30, 16:00 도착은 아직 여유
    )
    snap = {"estimated": {"confidence": "high"}, "today_date": today, "now": now, "next_slot": nxt}
    assert _rule_last_entry(snap) is None


def test_last_entry_none_when_confidence_low():
    today = date(2026, 7, 29)
    now = datetime(2026, 7, 29, 17, 40, tzinfo=_KST)
    nxt = _next_slot_for_hours(
        start_time=time(17, 40),
        business_hours={"open": "09:00", "close": "18:00"},
        last_entry_minutes=30,
    )
    snap = {"estimated": {"confidence": "low"}, "today_date": today, "now": now, "next_slot": nxt}
    assert _rule_last_entry(snap) is None
