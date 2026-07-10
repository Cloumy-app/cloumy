import EventSource from 'react-native-sse';
import { API_BASE, getAuthHeaders, apiFetch } from './client';
import type { PlaceDetail, PublicRouteListItem, RouteDaySummary, RouteGenRequest, RouteListItem, RouteSlot, SlotAlternative, SlotWithCoords } from '@/types';

interface SpringPage<T> {
  content: T[];
  totalElements: number;
  totalPages: number;
  last: boolean;
}

export async function getMyRoutes(page = 0, size = 10): Promise<SpringPage<RouteListItem>> {
  const res = await apiFetch(`/v1/routes?page=${page}&size=${size}`);
  if (!res.ok) throw new Error(`${res.status}`);
  const body: { data: SpringPage<RouteListItem> } = await res.json();
  return body.data;
}

export async function getRoute(routeId: string): Promise<RouteListItem> {
  const res = await apiFetch(`/v1/routes/${routeId}`);
  if (!res.ok) throw new Error(`${res.status}`);
  const body: { data: RouteListItem } = await res.json();
  return body.data;
}

export async function getRouteSlots(routeId: string): Promise<SlotWithCoords[]> {
  const res = await apiFetch(`/v1/routes/${routeId}/slots`);
  if (!res.ok) throw new Error(`${res.status}`);
  const body: { data: SlotWithCoords[] } = await res.json();
  return body.data;
}

export async function getRouteDaySummaries(routeId: string): Promise<RouteDaySummary[]> {
  const res = await apiFetch(`/v1/routes/${routeId}/day-summaries`);
  if (!res.ok) throw new Error(`${res.status}`);
  const body: { data: RouteDaySummary[] } = await res.json();
  return body.data;
}

export async function toggleSlotPin(routeId: string, slotId: string): Promise<SlotWithCoords> {
  const res = await apiFetch(`/v1/routes/${routeId}/slots/${slotId}/pin`, { method: 'PATCH' });
  if (!res.ok) throw new Error(`${res.status}`);
  const body: { data: SlotWithCoords } = await res.json();
  return body.data;
}

export async function deleteRouteSlot(routeId: string, slotId: string): Promise<void> {
  const res = await apiFetch(`/v1/routes/${routeId}/slots/${slotId}`, { method: 'DELETE' });
  if (!res.ok) throw new Error(`${res.status}`);
}

export async function replaceRouteSlot(
  routeId: string,
  slotId: string,
  body: { placeId: string; estimatedCost: number; reason: string },
): Promise<SlotWithCoords[]> {
  const res = await apiFetch(`/v1/routes/${routeId}/slots/${slotId}`, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  if (!res.ok) throw new Error(`${res.status}`);
  const resBody: { data: SlotWithCoords[] } = await res.json();
  return resBody.data;
}

export async function insertRouteSlot(
  routeId: string,
  afterSlotId: string,
  placeId: string,
  reason?: string,
): Promise<SlotWithCoords[]> {
  const res = await apiFetch(`/v1/routes/${routeId}/slots`, {
    method: 'POST',
    body: JSON.stringify({ afterSlotId, placeId, reason }),
  });
  if (!res.ok) throw new Error(`${res.status}`);
  const resBody: { data: SlotWithCoords[] } = await res.json();
  return resBody.data;
}

export async function getPlaceDetail(placeId: string): Promise<PlaceDetail> {
  const res = await apiFetch(`/v1/places/${placeId}`);
  if (!res.ok) throw new Error(`${res.status}`);
  const body: { data: PlaceDetail } = await res.json();
  return body.data;
}

export async function deleteRoute(routeId: string): Promise<void> {
  const res = await apiFetch(`/v1/routes/${routeId}`, { method: 'DELETE' });
  if (!res.ok) throw new Error(`${res.status}`);
}

export async function updateRouteVisibility(routeId: string, isPublic: boolean): Promise<void> {
  const res = await apiFetch(`/v1/routes/${routeId}/visibility`, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ isPublic }),
  });
  if (!res.ok) throw new Error(`${res.status}`);
}

// 루트/커뮤니티 탭 신설 — destination 생략 시 목적지 무관 전체 공개 루트 피드(커뮤니티 탭용).
// 공유 루트 가져오기 화면 북마크 개편 — bookmarkedOnly로 "북마크한 루트만" 토글.
export async function getPublicRoutes(
  destination?: string,
  bookmarkedOnly = false,
  page = 0,
  size = 10,
): Promise<SpringPage<PublicRouteListItem>> {
  const params = new URLSearchParams({ page: String(page), size: String(size), bookmarkedOnly: String(bookmarkedOnly) });
  if (destination) params.set('destination', destination);
  const res = await apiFetch(`/v1/routes/public?${params}`);
  if (!res.ok) throw new Error(`${res.status}`);
  const body: { data: SpringPage<PublicRouteListItem> } = await res.json();
  return body.data;
}

export async function cloneRoute(routeId: string, startDate: string): Promise<RouteListItem> {
  const res = await apiFetch(`/v1/routes/${routeId}/clone`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ startDate }),
  });
  if (!res.ok) throw new Error(`${res.status}`);
  const body: { data: RouteListItem } = await res.json();
  return body.data;
}

export async function createManualRoute(payload: {
  title: string;
  destination: string;
  startDate: string;
  endDate: string;
  slots: { placeId: string; dayNumber: number }[];
}): Promise<RouteListItem> {
  const res = await apiFetch('/v1/routes/manual', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  });
  if (!res.ok) throw new Error(`${res.status}`);
  const body: { data: RouteListItem } = await res.json();
  return body.data;
}

export async function addRouteBookmark(routeId: string): Promise<void> {
  const res = await apiFetch(`/v1/routes/${routeId}/bookmark`, { method: 'POST' });
  if (!res.ok) throw new Error(`${res.status}`);
}

export async function removeRouteBookmark(routeId: string): Promise<void> {
  const res = await apiFetch(`/v1/routes/${routeId}/bookmark`, { method: 'DELETE' });
  if (!res.ok) throw new Error(`${res.status}`);
}

export async function getPublicRouteSlots(routeId: string): Promise<SlotWithCoords[]> {
  const res = await apiFetch(`/v1/routes/${routeId}/public-slots`);
  if (!res.ok) throw new Error(`${res.status}`);
  const body: { data: SlotWithCoords[] } = await res.json();
  return body.data;
}

export async function reorderRoutes(routeIds: string[]): Promise<RouteListItem[]> {
  const res = await apiFetch('/v1/routes/reorder', {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ routeIds }),
  });
  if (!res.ok) throw new Error(`${res.status}`);
  const body: { data: RouteListItem[] } = await res.json();
  return body.data;
}

export async function reorderRouteSlots(
  routeId: string,
  dayNumber: number,
  slotIds: string[],
): Promise<SlotWithCoords[]> {
  const res = await apiFetch(`/v1/routes/${routeId}/slots/reorder`, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ dayNumber, slotIds }),
  });
  if (!res.ok) throw new Error(`${res.status}`);
  const body: { data: SlotWithCoords[] } = await res.json();
  return body.data;
}

export async function getSlotAlternatives(
  routeId: string,
  slotId: string,
): Promise<SlotAlternative[]> {
  const res = await apiFetch(`/v1/routes/${routeId}/slots/${slotId}/alternatives`, { method: 'POST' });
  if (!res.ok) return [];
  const body: { data: SlotAlternative[] } = await res.json();
  return body.data ?? [];
}

export function streamRoute(
  req: RouteGenRequest,
  onSlot: (slot: RouteSlot) => void,
  onDaySummary: (day: number, summary: string) => void,
  onRouteId: (id: string) => void,
  onDone: () => void,
  onError: (err: Event) => void,
): () => void {
  const headers = getAuthHeaders();

  const es = new EventSource<'route_id' | 'done'>(`${API_BASE}/v1/routes/generate`, {
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
      const parsed = JSON.parse(e.data) as RouteSlot & {
        done?: boolean;
        type?: string;
        day?: number;
        summary?: string;
      };
      if (parsed.done) {
        // 서버가 보내는 스트림 종료 센티널
        settle(onDone);
        return;
      }
      if (parsed.type === 'day_summary') {
        if (parsed.day != null && parsed.summary) onDaySummary(parsed.day, parsed.summary);
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
