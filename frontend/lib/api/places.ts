import { apiFetch } from './client';
import type { KakaoPlaceResult } from './accommodations';
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

// "직접 장소 추가" — 카테고리 필터 없는 일반 카카오 검색(숙소 검색과 동일 결과 모양 재사용)
export async function searchPlaces(keyword: string): Promise<KakaoPlaceResult[]> {
  const res = await apiFetch(`/v1/places/search?keyword=${encodeURIComponent(keyword)}`);
  if (!res.ok) return [];
  const body: { data: KakaoPlaceResult[] } = await res.json();
  return body.data;
}
