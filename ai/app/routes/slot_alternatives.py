import json
import logging

from fastapi import APIRouter, Request
from pydantic import BaseModel, Field

from app.config.city_centers import CITY_CENTERS
from app.services.retrievers import PostgisTagRetriever
from app.services.route_service import _anthropic

logger = logging.getLogger(__name__)
router = APIRouter(prefix="/ai", tags=["slot-alternatives"])

HAIKU_MODEL = "claude-haiku-4-5-20251001"
ALTERNATIVES_RADIUS_M = 5000


class NearbySlot(BaseModel):
    name: str
    lat: float
    lng: float


class SlotAlternativesRequest(BaseModel):
    slot_id: str
    place_name: str
    destination: str
    tags: list[str] = Field(default_factory=list)
    budget_level: str = "mid"
    nearby_slots: list[NearbySlot] = Field(default_factory=list)


class AlternativePlace(BaseModel):
    place_id: str
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
당신은 한국 여행 전문가입니다. 여행자의 현재 슬롯 장소를 대체할 수 있는 장소를 후보 목록에서 최대 3개 선택합니다.

출력 형식: JSON 배열 하나만 출력합니다. 다른 텍스트 없음.
[
  {"place_id": "후보 목록의 실제 id", "reason": "추천 이유 1문장", "estimated_cost": 15000},
  ...
]

규칙:
- place_id는 반드시 후보 목록의 실제 id 값만 사용 (임의 생성 금지)
- 대상 목적지와 인접 슬롯 좌표를 고려해 이동 동선이 효율적인 장소 선택
- 예산 수준에 맞는 장소 선택
- estimated_cost는 정수(원 단위)
- JSON 외 텍스트 절대 금지\
"""


@router.post("/routes/slots/alternatives", response_model=list[AlternativePlace])
async def get_slot_alternatives(req: SlotAlternativesRequest, request: Request):
    db = request.app.state.db

    # 1. 인접 슬롯 좌표 주변(없으면 도시 중심) 실제 후보 조회 — LLM이 좌표를 지어내지 못하게
    #    반드시 DB에 존재하는 장소만 후보로 준다.
    center = (
        (req.nearby_slots[0].lng, req.nearby_slots[0].lat)
        if req.nearby_slots
        else CITY_CENTERS.get(req.destination)
    )
    if center is None:
        logger.warning("슬롯 대안 — 알 수 없는 목적지: %s", req.destination)
        return []

    candidates = await PostgisTagRetriever(
        db=db,
        city_coords=center,
        tags=req.tags,
        radius_m=ALTERNATIVES_RADIUS_M,
    ).ainvoke("")

    if not candidates:
        logger.info("슬롯 대안 — 후보 0건, LLM 호출 생략: %s", req.destination)
        return []

    candidate_lookup = {doc.metadata["id"]: doc for doc in candidates}
    candidates_text = "\n".join(
        f"[{i + 1}] id={doc.metadata['id']} | {doc.page_content}"
        for i, doc in enumerate(candidates)
    )

    # 2. 프롬프트 구성
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
        f"후보 장소 ({len(candidates)}곳):\n{candidates_text}\n\n"
        f"위 후보 중 대체 장소 최대 3개를 JSON 배열로 추천해주세요."
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
    except Exception as e:
        logger.error("슬롯 대안 파싱 실패: %s | raw=%s", e, raw[:200])
        return []

    # 3. place_id를 실제 후보 DB 값으로 하이드레이션 — 후보에 없는 id(환각)는 스킵
    result: list[AlternativePlace] = []
    for item in data:
        doc = candidate_lookup.get(item.get("place_id"))
        if doc is None:
            logger.warning("슬롯 대안 환각 감지 — 후보에 없는 place_id: %s", item.get("place_id"))
            continue
        result.append(
            AlternativePlace(
                place_id=doc.metadata["id"],
                place_name=doc.metadata["name"],
                reason=item.get("reason", ""),
                estimated_cost=item.get("estimated_cost", 0),
                lat=doc.metadata["lat"],
                lng=doc.metadata["lng"],
            )
        )
        if len(result) == 3:
            break

    return result
