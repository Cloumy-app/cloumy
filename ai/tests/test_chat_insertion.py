from datetime import date

import asyncpg
import pytest
from unittest.mock import AsyncMock, MagicMock

from app.services.chat_service import _resolve_insertion

# 챗봇 추천 장소 카드 → 일정 삽입 자리 결정(_resolve_insertion)을 고정한다.
# "estimated_slot이 high가 아니면(주로 밤 시간대) 삽입 자리가 아예 없어 카드가
# 통째로 죽는다"는 문제를, ①대화 힌트 → ②위치 추정(기존 동작) → ③오늘 Day 맨 뒤
# 3단 우선순위로 해결한 판단 함수다. 이 파일이 지키는 것:
#   1) ①대화 힌트가 "~ 가기 전에/다음에/N일차에"를 슬롯으로 정확히 해석한다
#      (첫 슬롯 앞이면 after_slot_id=None까지)
#   2) 힌트가 환각(FFE #1)·모호(FFE #2)·범위 밖(FFE #3)이어도 예외 없이 ②→③으로
#      결정적으로 폴백한다
#   3) ②(위치 추정 high)가 기존 estimated_slot 동작과 정확히 같다 — 낮의 원탭 경험이
#      회귀하지 않는다
#   4) 루트에 슬롯이 하나도 없어도(FFE #4) 무조건 값을 준다(day=1, after_slot_id=None)
#
# route의 start_date/end_date는 항상 실행일 기준 "여행 범위 밖"이 되도록 아주 과거로
# 고정한다 — today_day_number가 매번 크게 벌어져 있어야 ③ 기본값 분기와 "오늘 이후
# 첫 번째" 동점 처리가 테스트 실행일과 무관하게 항상 같은 결과를 낸다(이 프로젝트에서
# 실행 시각 의존 테스트로 값을 단정하지 못한 전례가 있다).
_ROUTE = {
    "id": "route-1",
    "start_date": date(2020, 1, 1),
    "end_date": date(2020, 1, 3),
    "nights": 2,  # 1~3일차만 유효 범위
}

_LOW = {"confidence": "low"}


def _db_mock(slots_rows: list[dict]) -> MagicMock:
    db = MagicMock(spec=asyncpg.Pool)
    db.fetch = AsyncMock(return_value=slots_rows)
    return db


def _slot(slot_id: str, day: int, order_index: int, place_name: str) -> dict:
    return {"slot_id": slot_id, "day_number": day, "order_index": order_index, "place_name": place_name}


@pytest.mark.asyncio
async def test_insertion_from_before_place():
    slots = [
        _slot("s1", 1, 1, "카페"),
        _slot("s2", 1, 2, "경복궁"),
        _slot("s3", 1, 3, "인사동"),
    ]
    db = _db_mock(slots)
    result = await _resolve_insertion(db, _ROUTE, _LOW, {"insert_before_place": "경복궁"})
    assert result == {"day": 1, "after_slot_id": "s1", "source": "conversation"}


@pytest.mark.asyncio
async def test_insertion_before_first_slot_gives_null_anchor():
    slots = [
        _slot("s1", 1, 1, "경복궁"),
        _slot("s2", 1, 2, "인사동"),
    ]
    db = _db_mock(slots)
    result = await _resolve_insertion(db, _ROUTE, _LOW, {"insert_before_place": "경복궁"})
    assert result == {"day": 1, "after_slot_id": None, "source": "conversation"}


@pytest.mark.asyncio
async def test_insertion_from_after_place():
    slots = [
        _slot("s1", 1, 1, "카페"),
        _slot("s2", 1, 2, "경복궁"),
        _slot("s3", 1, 3, "인사동"),
    ]
    db = _db_mock(slots)
    result = await _resolve_insertion(db, _ROUTE, _LOW, {"insert_after_place": "경복궁"})
    assert result == {"day": 1, "after_slot_id": "s2", "source": "conversation"}


@pytest.mark.asyncio
async def test_insertion_unknown_place_falls_back():
    # 일정에 없는 "에버랜드"를 힌트로 줌(환각, FFE #1) — 무시하고 ②(위치 추정 high)로
    # 폴백해야 한다. 예외가 나지 않는다는 것도 이 테스트가 고정한다.
    slots = [_slot("s1", 1, 1, "경복궁")]
    db = _db_mock(slots)
    estimated_high = {"confidence": "high", "day": 1, "slot_id": "sE", "order_index": 2}
    result = await _resolve_insertion(db, _ROUTE, estimated_high, {"insert_before_place": "에버랜드"})
    assert result == {"day": 1, "after_slot_id": "sE", "source": "estimated"}


@pytest.mark.asyncio
async def test_insertion_unknown_place_still_honors_day():
    """장소 매칭에 실패해도 insert_day가 유효하면 그 Day 맨 뒤로 물러난다.

    "2일차에 에버랜드 가기 전에"처럼 날짜와 장소를 같이 말했는데 장소만 못 찾은 경우,
    사용자가 명시한 '2일차'까지 버리고 ②→③으로 내려가면 엉뚱하게 '오늘 Day'를
    제안하게 된다 — 날짜가 틀리는 쪽이 자리가 덜 정확한 쪽보다 훨씬 눈에 띈다."""
    slots = [_slot("s1", 2, 1, "경복궁"), _slot("s2", 2, 2, "인사동")]
    db = _db_mock(slots)
    estimated_high = {"confidence": "high", "day": 1, "slot_id": "sE", "order_index": 2}

    result = await _resolve_insertion(
        db, _ROUTE, estimated_high, {"insert_day": 2, "insert_before_place": "에버랜드"},
    )

    # ②(estimated, day 1)로 내려가지 않고 2일차 마지막 슬롯 뒤에 붙어야 한다.
    # source는 "conversation"이 아니라 "conversation_day" — 2일차 '맨 뒤'는 사용자가 말한
    # 자리가 아니라 서버가 고른 자리라, 앱이 확인 없이 바로 삽입하면 안 되는 경우다.
    assert result == {"day": 2, "after_slot_id": "s2", "source": "conversation_day"}


@pytest.mark.asyncio
async def test_insertion_day_only_marks_source_as_conversation_day():
    """"2일차에 카페 추천해줘"처럼 Day만 말한 경우 — 자리는 그 Day 맨 뒤인데 사용자가
    "맨 뒤"를 말한 건 아니다. 앱이 확인 시트를 생략해도 되는 신호와 구분돼야 한다."""
    slots = [_slot("s1", 2, 1, "경복궁"), _slot("s2", 2, 2, "인사동")]
    db = _db_mock(slots)

    result = await _resolve_insertion(db, _ROUTE, _LOW, {"insert_day": 2})

    assert result == {"day": 2, "after_slot_id": "s2", "source": "conversation_day"}


@pytest.mark.asyncio
async def test_insertion_matches_place_name_ignoring_whitespace():
    """실측 결함 — "초안산 캠핑장 가기 전에"라고 하면 모델도 띄어쓴 그대로 넘기는데 DB
    표기는 "초안산캠핑장"(붙임)이라 매칭이 통째로 실패했다. 공백 하나 때문에 검색
    기준점과 삽입 자리가 동시에 엉뚱한 곳으로 갔다(그 Day 맨 뒤)."""
    slots = [_slot("s1", 3, 1, "경춘선숲길"), _slot("s2", 3, 2, "초안산캠핑장"), _slot("s3", 3, 3, "남산공원")]
    db = _db_mock(slots)

    result = await _resolve_insertion(
        db, _ROUTE, _LOW, {"insert_day": 3, "insert_before_place": "초안산 캠핑장"},
    )

    # 초안산캠핑장 바로 앞 = 경춘선숲길 뒤. day 맨 뒤(conversation_day)로 떨어지면 안 된다.
    assert result == {"day": 3, "after_slot_id": "s1", "source": "conversation"}


@pytest.mark.asyncio
async def test_insertion_matches_place_name_ignoring_case():
    # 영문이 섞인 이름은 모델이 대소문자를 바꿔 보내기도 한다.
    slots = [_slot("s1", 1, 1, "경복궁"), _slot("s2", 1, 2, "ETF베이커리 성수")]
    db = _db_mock(slots)

    result = await _resolve_insertion(db, _ROUTE, _LOW, {"insert_after_place": "etf베이커리성수"})

    assert result == {"day": 1, "after_slot_id": "s2", "source": "conversation"}


@pytest.mark.asyncio
async def test_insertion_day_only_on_empty_day_still_conversation_day():
    # 슬롯이 없는 Day를 지목한 경우도 마찬가지다 — after_slot_id=None(맨 앞)이지만
    # 그 역시 사용자가 지정한 자리가 아니다.
    slots = [_slot("s1", 1, 1, "경복궁")]
    db = _db_mock(slots)

    result = await _resolve_insertion(db, _ROUTE, _LOW, {"insert_day": 3})

    assert result == {"day": 3, "after_slot_id": None, "source": "conversation_day"}


@pytest.mark.asyncio
async def test_insertion_matched_place_keeps_source_conversation():
    # 장소를 찾은 경우는 기존 값을 유지해야 한다 — 이게 앱이 바로 삽입하는 유일한 신호다.
    slots = [_slot("s1", 1, 1, "광화문"), _slot("s2", 1, 2, "경복궁")]
    db = _db_mock(slots)

    result = await _resolve_insertion(db, _ROUTE, _LOW, {"insert_before_place": "경복궁"})

    assert result == {"day": 1, "after_slot_id": "s1", "source": "conversation"}


@pytest.mark.asyncio
async def test_insertion_ambiguous_place_picks_deterministically():
    # "경복궁"이 1일차·3일차에 둘 다 있고 insert_day도 없음(FFE #2) — route가 항상
    # 과거로 고정돼 today_day_number가 두 후보보다 훨씬 크므로 "오늘 이후" 후보가 없어
    # candidates_sorted[0](Day 번호가 가장 작은 쪽)로 결정적으로 떨어진다.
    slots = [
        _slot("s1", 1, 1, "경복궁"),
        _slot("s2", 1, 2, "카페"),
        _slot("s3", 3, 1, "경복궁"),
        _slot("s4", 3, 2, "인사동"),
    ]
    db = _db_mock(slots)
    result = await _resolve_insertion(db, _ROUTE, _LOW, {"insert_after_place": "경복궁"})
    assert result == {"day": 1, "after_slot_id": "s1", "source": "conversation"}


@pytest.mark.asyncio
async def test_insertion_out_of_range_day_ignored():
    # insert_day=99는 1~3(nights+1) 범위 밖(FFE #3) — 모델 출력을 신뢰하지 않고
    # 무시한 뒤 ③으로 떨어져야 한다(99가 day로 그대로 쓰이면 안 된다).
    slots = [_slot("s1", 1, 1, "경복궁")]
    db = _db_mock(slots)
    result = await _resolve_insertion(db, _ROUTE, _LOW, {"insert_day": 99})
    assert result == {"day": 1, "after_slot_id": "s1", "source": "default"}


@pytest.mark.asyncio
async def test_insertion_uses_estimated_slot_when_no_hint():
    # 힌트가 전혀 없을 때 ②(기존 estimated_slot high)가 그대로 쓰여야 한다 —
    # 낮 시간대 원탭 경험이 이번 변경으로 회귀하지 않는다는 걸 고정하는 테스트.
    db = _db_mock([])
    estimated_high = {"confidence": "high", "day": 2, "slot_id": "sE", "order_index": 5}
    result = await _resolve_insertion(db, _ROUTE, estimated_high, {})
    assert result == {"day": 2, "after_slot_id": "sE", "source": "estimated"}


@pytest.mark.asyncio
async def test_insertion_default_when_nothing():
    # 힌트도 없고 위치 추정도 실패(밤 시간대의 전형) — ③ 오늘 Day(범위 밖이라 1일차)
    # 맨 뒤로 떨어지고, 그 Day에 슬롯이 있으면 마지막 슬롯이 앵커가 된다.
    slots = [
        _slot("s1", 1, 1, "카페"),
        _slot("s2", 1, 2, "경복궁"),
    ]
    db = _db_mock(slots)
    result = await _resolve_insertion(db, _ROUTE, _LOW, {})
    assert result == {"day": 1, "after_slot_id": "s2", "source": "default"}


@pytest.mark.asyncio
async def test_insertion_empty_route_gives_null_anchor():
    # 루트에 슬롯이 하나도 없어도(FFE #4) 반드시 값을 준다 — day=1, after_slot_id=None.
    db = _db_mock([])
    result = await _resolve_insertion(db, _ROUTE, _LOW, {})
    assert result == {"day": 1, "after_slot_id": None, "source": "default"}
