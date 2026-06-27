import json
import logging
from typing import Optional

from fastapi import APIRouter
from pydantic import BaseModel

from app.config.settings import settings
from app.services.route_service import _anthropic

logger = logging.getLogger(__name__)
router = APIRouter(prefix="/ai", tags=["slot-alternatives"])

HAIKU_MODEL = "claude-haiku-4-5-20251001"


class NearbySlot(BaseModel):
    name: str
    lat: float
    lng: float


class SlotAlternativesRequest(BaseModel):
    slot_id: str
    place_name: str
    destination: str
    tags: list[str] = []
    budget_level: str = "mid"
    nearby_slots: list[NearbySlot] = []


class AlternativePlace(BaseModel):
    place_name: str
    reason: str
    estimated_cost: int
    lat: float
    lng: float


BUDGET_GUIDE = {
    "budget": "1만원 이하",
    "mid": "2~4만원",
    "premium": "5만원 이상",
}

SYSTEM_PROMPT = """\
당신은 한국 여행 전문가입니다. 여행자의 현재 슬롯 장소를 대체할 수 있는 장소 3개를 추천합니다.

출력 형식: JSON 배열 하나만 출력합니다. 다른 텍스트 없음.
[
  {"place_name": "장소명", "reason": "추천 이유 1문장", "estimated_cost": 15000, "lat": 35.17, "lng": 129.07},
  ...
]

규칙:
- 대상 목적지와 인접 슬롯 좌표를 고려해 이동 동선이 효율적인 장소 추천
- 예산 수준에 맞는 장소 선택
- estimated_cost는 정수(원 단위)
- lat/lng는 실제 해당 장소의 WGS84 좌표 (소수점 4자리)
- JSON 외 텍스트 절대 금지\
"""


@router.post("/routes/slots/alternatives", response_model=list[AlternativePlace])
async def get_slot_alternatives(req: SlotAlternativesRequest):
    budget_str = BUDGET_GUIDE.get(req.budget_level, "2~4만원")
    nearby_desc = (
        ", ".join(f"{s.name}({s.lat:.4f},{s.lng:.4f})" for s in req.nearby_slots)
        if req.nearby_slots
        else "없음"
    )
    tag_str = ", ".join(req.tags) if req.tags else "없음"

    user_message = (
        f"목적지: {req.destination}\n"
        f"현재 장소: {req.place_name}\n"
        f"선호 태그: {tag_str}\n"
        f"예산 수준: {budget_str}\n"
        f"인접 슬롯(동선 참고): {nearby_desc}\n\n"
        f"위 조건에 맞는 대체 장소 3개를 JSON 배열로 추천해주세요."
    )

    response = await _anthropic.messages.create(
        model=HAIKU_MODEL,
        max_tokens=512,
        system=SYSTEM_PROMPT,
        messages=[{"role": "user", "content": user_message}],
    )

    raw = response.content[0].text.strip()
    # 마크다운 코드블록 제거
    if raw.startswith("```"):
        raw = raw.split("```")[1]
        if raw.startswith("json"):
            raw = raw[4:]
    raw = raw.strip()

    try:
        data: list[dict] = json.loads(raw)
        return [AlternativePlace(**item) for item in data[:3]]
    except Exception as e:
        logger.error("슬롯 대안 파싱 실패: %s | raw=%s", e, raw[:200])
        return []
