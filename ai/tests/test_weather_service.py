from app.services.weather_service import _hour_to_block, _label_for_day


def test_hour_to_block_boundaries():
    assert _hour_to_block(6) == "오전"
    assert _hour_to_block(11) == "오전"
    assert _hour_to_block(12) == "오후"
    assert _hour_to_block(3) is None  # 새벽 — 여행 활동 시간대 아님


def test_label_for_day_clear():
    assert _label_for_day({"오전": 0.1, "오후": 0.2}) == "맑음"


def test_label_for_day_single_block():
    assert _label_for_day({"오후": 0.8}) == "오후 한때 비"


def test_label_for_day_two_blocks():
    assert _label_for_day({"오후": 0.7, "저녁": 0.9}) == "오후·저녁 비"


def test_label_for_day_all_day():
    assert _label_for_day({"오전": 0.6, "오후": 0.9, "저녁": 0.7}) == "종일 비"


def test_label_for_day_empty():
    assert _label_for_day({}) == "맑음"  # 예보 데이터 없는 날 (5일 밖)
