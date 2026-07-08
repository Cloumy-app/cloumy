from fastapi import APIRouter
from pydantic import BaseModel, Field

from app.config.settings import settings
from app.services.transport_service import enrich_transport

router = APIRouter(prefix="/ai", tags=["slot-transport"])


class TransportSlotIn(BaseModel):
    place_id: str
    lat: float
    lng: float


class SlotTransportRequest(BaseModel):
    slots: list[TransportSlotIn] = Field(default_factory=list)


class TransportSlotOut(BaseModel):
    place_id: str
    transport_to_next: str | None = None
    transport_minutes: int | None = None
    transit_summary: str | None = None
    transit_detail: list[dict] | None = None


@router.post("/routes/slots/transport", response_model=list[TransportSlotOut])
async def get_slot_transport(req: SlotTransportRequest) -> list[TransportSlotOut]:
    """슬롯 교체 후 이웃 구간 이동정보만 재계산. 새 계산 로직 없이 enrich_transport를 그대로 재사용한다."""
    coord_lookup = {s.place_id: (s.lat, s.lng) for s in req.slots}
    ordered = [{"place_id": s.place_id} for s in req.slots]
    enriched = await enrich_transport(ordered, coord_lookup, settings.tmap_api_key)
    return [TransportSlotOut(**e) for e in enriched]
