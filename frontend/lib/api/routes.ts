import EventSource from 'react-native-sse';
import { API_BASE, getAuthHeaders } from './client';
import type { PlaceDetail, RouteGenRequest, RouteListItem, RouteSlot, SlotAlternative, SlotWithCoords } from '@/types';

interface SpringPage<T> {
  content: T[];
  totalElements: number;
  totalPages: number;
}

export async function getMyRoutes(page = 0, size = 10): Promise<SpringPage<RouteListItem>> {
  const res = await fetch(`${API_BASE}/v1/routes?page=${page}&size=${size}`, {
    headers: getAuthHeaders(),
  });
  if (!res.ok) throw new Error(`${res.status}`);
  const body: { data: SpringPage<RouteListItem> } = await res.json();
  return body.data;
}

export async function getRouteSlots(routeId: string): Promise<SlotWithCoords[]> {
  const res = await fetch(`${API_BASE}/v1/routes/${routeId}/slots`, {
    headers: getAuthHeaders(),
  });
  if (!res.ok) throw new Error(`${res.status}`);
  const body: { data: SlotWithCoords[] } = await res.json();
  return body.data;
}

export async function toggleSlotPin(routeId: string, slotId: string): Promise<SlotWithCoords> {
  const res = await fetch(`${API_BASE}/v1/routes/${routeId}/slots/${slotId}/pin`, {
    method: 'PATCH',
    headers: getAuthHeaders(),
  });
  if (!res.ok) throw new Error(`${res.status}`);
  const body: { data: SlotWithCoords } = await res.json();
  return body.data;
}

export async function deleteRouteSlot(routeId: string, slotId: string): Promise<void> {
  const res = await fetch(`${API_BASE}/v1/routes/${routeId}/slots/${slotId}`, {
    method: 'DELETE',
    headers: getAuthHeaders(),
  });
  if (!res.ok) throw new Error(`${res.status}`);
}

export async function getPlaceDetail(placeId: string): Promise<PlaceDetail> {
  const res = await fetch(`${API_BASE}/v1/places/${placeId}`, {
    headers: getAuthHeaders(),
  });
  if (!res.ok) throw new Error(`${res.status}`);
  const body: { data: PlaceDetail } = await res.json();
  return body.data;
}

export async function getSlotAlternatives(
  routeId: string,
  slotId: string,
): Promise<SlotAlternative[]> {
  const res = await fetch(`${API_BASE}/v1/routes/${routeId}/slots/${slotId}/alternatives`, {
    method: 'POST',
    headers: getAuthHeaders(),
  });
  if (!res.ok) return [];
  const body: { data: SlotAlternative[] } = await res.json();
  return body.data ?? [];
}

export function streamRoute(
  req: RouteGenRequest,
  onSlot: (slot: RouteSlot) => void,
  onRouteId: (id: string) => void,
  onDone: () => void,
  onError: (err: Event) => void,
): () => void {
  const headers = getAuthHeaders();

  const es = new EventSource(`${API_BASE}/v1/routes/generate`, {
    method: 'POST',
    headers,
    body: JSON.stringify(req),
  });

  let settled = false;
  const settle = (fn: () => void) => {
    if (settled) return;
    settled = true;
    es.close();
    fn();
  };

  es.addEventListener('route_id', (e) => {
    if (e.data) onRouteId(e.data);
  });

  es.addEventListener('message', (e) => {
    if (!e.data) return;
    try {
      const parsed = JSON.parse(e.data) as RouteSlot & { done?: boolean };
      if (parsed.done) {
        // 서버가 보내는 스트림 종료 센티널
        settle(onDone);
        return;
      }
      if (!('error' in parsed)) onSlot(parsed);
    } catch {
      // ndjson 파싱 실패 시 무시
    }
  });

  // named done 이벤트도 처리 (보험용)
  es.addEventListener('done', () => settle(onDone));

  es.addEventListener('error', (e) => settle(() => onError(e as Event)));

  // done 이벤트 없이 연결이 닫힌 경우 — 완료로 처리
  es.addEventListener('close', () => settle(onDone));

  return () => settle(() => {});
}
