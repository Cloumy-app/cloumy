import { apiFetch } from './client';
import type { ExternalPlaceRequest, ExternalPlaceResponse } from '@/types';

export async function resolveExternalPlace(req: ExternalPlaceRequest): Promise<ExternalPlaceResponse> {
  const res = await apiFetch('/v1/places/external', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(req),
  });
  if (!res.ok) throw new Error(`${res.status}`);
  const body: { data: ExternalPlaceResponse } = await res.json();
  return body.data;
}
