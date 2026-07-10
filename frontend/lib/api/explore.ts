import { apiFetch } from './client';
import type { PlaceBrowseItem } from '@/types';

interface SpringPage<T> {
  content: T[];
  totalElements: number;
  totalPages: number;
}

export async function browsePlaces(city: string, tags: string[], page = 0): Promise<SpringPage<PlaceBrowseItem>> {
  const params = new URLSearchParams({ city, page: String(page) });
  tags.forEach((tag) => params.append('tags', tag));
  const res = await apiFetch(`/v1/places/browse?${params.toString()}`);
  if (!res.ok) throw new Error(`${res.status}`);
  const body: { data: SpringPage<PlaceBrowseItem> } = await res.json();
  return body.data;
}

export async function getMyBookmarks(page = 0): Promise<SpringPage<PlaceBrowseItem>> {
  const res = await apiFetch(`/v1/bookmarks?page=${page}`);
  if (!res.ok) throw new Error(`${res.status}`);
  const body: { data: SpringPage<PlaceBrowseItem> } = await res.json();
  return body.data;
}

export async function addBookmark(placeId: string): Promise<void> {
  const res = await apiFetch(`/v1/places/${placeId}/bookmark`, { method: 'POST' });
  if (!res.ok) throw new Error(`${res.status}`);
}

export async function removeBookmark(placeId: string): Promise<void> {
  const res = await apiFetch(`/v1/places/${placeId}/bookmark`, { method: 'DELETE' });
  if (!res.ok) throw new Error(`${res.status}`);
}
