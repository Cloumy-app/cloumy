import EventSource from 'react-native-sse';
import { API_BASE, getAuthHeaders } from './client';
import type { RouteGenRequest, RouteSlot } from '@/types';

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

  es.addEventListener('route_id', (e) => {
    if (e.data) onRouteId(e.data);
  });

  es.addEventListener('message', (e) => {
    if (!e.data) return;
    try {
      const slot = JSON.parse(e.data) as RouteSlot;
      if (!('error' in slot)) onSlot(slot);
    } catch {
      // ndjson 파싱 실패 시 무시
    }
  });

  es.addEventListener('error', (e) => {
    onError(e as Event);
    es.close();
  });

  es.addEventListener('close', () => {
    onDone();
    es.close();
  });

  return () => es.close();
}
