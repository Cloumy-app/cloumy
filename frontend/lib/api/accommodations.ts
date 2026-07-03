import { apiFetch } from './client';

export interface KakaoPlaceResult {
  name: string;
  address: string | null;
  lat: number;
  lng: number;
}

export async function searchAccommodations(keyword: string): Promise<KakaoPlaceResult[]> {
  const res = await apiFetch(`/v1/accommodations/search?keyword=${encodeURIComponent(keyword)}`);
  if (!res.ok) return []; // 검색 실패는 빈 배열로 폴백 — 화면에서 "지도에서 직접 선택" 안내
  const body: { data: KakaoPlaceResult[] } = await res.json();
  return body.data;
}

export async function reverseGeocode(lat: number, lng: number): Promise<string | null> {
  const res = await apiFetch(`/v1/accommodations/reverse-geocode?lat=${lat}&lng=${lng}`);
  if (!res.ok) return null;
  const body: { data: { address: string | null } } = await res.json();
  return body.data.address;
}
