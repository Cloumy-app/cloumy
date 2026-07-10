import json
import logging

from fastapi import APIRouter
from pydantic import BaseModel

from app.services.route_service import _anthropic

logger = logging.getLogger(__name__)
router = APIRouter(prefix="/ai", tags=["place-translate"])

HAIKU_MODEL = "claude-haiku-4-5-20251001"


class TranslateRequest(BaseModel):
    name: str
    address: str | None = None


class TranslateResponse(BaseModel):
    name_en: str | None = None
    name_ja: str | None = None
    name_zh_hans: str | None = None
    name_zh_hant: str | None = None
    address_en: str | None = None
    address_ja: str | None = None
    address_zh_hans: str | None = None
    address_zh_hant: str | None = None


SYSTEM_PROMPT = """당신은 한국 지명·주소 번역 전문가입니다. 주어진 장소명과 주소를 영어, 일본어, \
중국어간체, 중국어번체로 번역합니다.

출력 형식: JSON 객체 하나만 출력합니다. 다른 텍스트 없음.
{"name_en": "...", "name_ja": "...", "name_zh_hans": "...", "name_zh_hant": "...", \
"address_en": "...", "address_ja": "...", "address_zh_hans": "...", "address_zh_hant": "..."}

규칙:
- 고유명사(장소명)는 표준 로마자 표기/가나 음역/병음 음역을 우선하되, 널리 알려진 의역이 있으면 그것을 사용
- 일반명사(역/시장/공원/거리 등)는 의미를 살려 번역
- 주소가 비어 있으면 address_en/address_ja/address_zh_hans/address_zh_hant는 전부 null
- JSON 외 텍스트 절대 금지"""


@router.post("/places/translate", response_model=TranslateResponse)
async def translate_place(req: TranslateRequest) -> TranslateResponse:
    """단건 실시간 번역 — 신규(카카오 검색 추가) 장소를 첫 조회 시 번역하는 용도.
    실패해도 예외를 던지지 않고 빈 응답을 반환한다 — 백엔드가 fire-and-forget으로 호출하므로
    예외를 전파해도 처리할 곳이 없다."""
    user_message = f"장소명: {req.name}\n주소: {req.address or '(없음)'}"

    try:
        response = await _anthropic.messages.create(
            model=HAIKU_MODEL,
            max_tokens=512,
            system=SYSTEM_PROMPT,
            messages=[{"role": "user", "content": user_message}],
        )
        raw = response.content[0].text.strip()
        if raw.startswith("```"):
            raw = raw.split("```")[1].removeprefix("json").strip()
        data = json.loads(raw)
        return TranslateResponse(**{k: v for k, v in data.items() if k in TranslateResponse.model_fields})
    except Exception as e:
        logger.warning("장소 번역 실패 name=%s: %s", req.name, e)
        return TranslateResponse()
