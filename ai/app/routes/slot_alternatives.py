import json
import logging

from fastapi import APIRouter, Request
from pydantic import BaseModel, Field

from app.config.city_centers import CITY_CENTERS
from app.services.retrievers import PostgisTagRetriever, describe_candidate
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
당신은 한국 여행 전문가입니다. 여행자의 현재 슬롯 장소를 대체할 수 있는 장소를 후보 목록에서 정확히 3개 선택합니다 (후보가 3개 미만이면 있는 만큼 전부 선택).

출력 형식: JSON 배열 하나만 출력합니다. 다른 텍스트 없음.
[
  {"index": 3, "reason": "추천 이유 1문장", "estimated_cost": 15000},
  ...
]

규칙:
- index는 반드시 후보 목록 각 줄 맨 앞 대괄호 번호([N]) 중 하나의 정수만 사용 (id 문자열은 절대 직접 옮겨 쓰지 말 것 — index만 적으면 됨)
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
        # 대안은 인접 슬롯 주변에서 골라야 동선이 안 깨진다 — 반경 안 무작위면 5km 끝과
        # 100m 옆이 같은 확률로 올라온다.
        sort="distance",
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
        f"위 후보 중 대체 장소 정확히 3개를 index로 JSON 배열에 추천해주세요 (후보가 3개 미만이면 있는 만큼 전부)."
    )

    response = await _anthropic.messages.create(
        model=HAIKU_MODEL,
        max_tokens=512,
        system=SYSTEM_PROMPT,
        messages=[{"role": "user", "content": user_message}],
    )

    logger.info(
        "슬롯 대안 Claude 캐시 사용량: cache_creation=%d cache_read=%d input=%d",
        response.usage.cache_creation_input_tokens or 0,
        response.usage.cache_read_input_tokens or 0,
        response.usage.input_tokens,
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

    # 3. index를 실제 후보로 해석 — 범위를 벗어나거나 정수가 아니면(환각) 스킵.
    #    place_id 문자열을 직접 베끼게 하지 않고 목록에 이미 나열된 번호만 쓰게 해 환각을 줄인다.
    result: list[AlternativePlace] = []
    used_ids: set[str] = set()
    for item in data:
        idx = item.get("index")
        if not isinstance(idx, int) or not (1 <= idx <= len(candidates)):
            logger.warning("슬롯 대안 환각 감지 — 잘못된 index: %s", idx)
            continue
        doc = candidates[idx - 1]
        if doc.metadata["id"] in used_ids:
            continue
        used_ids.add(doc.metadata["id"])
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

    # 4. LLM 응답이 3개 미만이면(드문 경우) 남은 후보로 채워 3개를 맞춘다.
    #    페이지 텍스트에 담긴 실제 태그/주소를 그대로 보여줘 밋밋한 문구가 되지 않게 한다.
    if len(result) < 3:
        for doc in candidates:
            if len(result) == 3:
                break
            if doc.metadata["id"] in used_ids:
                continue
            used_ids.add(doc.metadata["id"])
            result.append(
                AlternativePlace(
                    place_id=doc.metadata["id"],
                    place_name=doc.metadata["name"],
                    reason=describe_candidate(doc),
                    estimated_cost=0,
                    lat=doc.metadata["lat"],
                    lng=doc.metadata["lng"],
                )
            )

    return result
