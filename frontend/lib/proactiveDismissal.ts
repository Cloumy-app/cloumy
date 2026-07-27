import { createMMKV } from 'react-native-mmkv';

// 프로액티브 배너 중복 노출 방지 — 서버에 기록할 만한 가치가 아직 없어 로컬(MMKV)로만 둔다.
// 키: proactive:{routeId}:{type}:{YYYY-MM-DD}
const storage = createMMKV({ id: 'proactive' });

function toLocalDateString(date: Date): string {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, '0');
  const d = String(date.getDate()).padStart(2, '0');
  return `${y}-${m}-${d}`;
}

function dismissalKey(routeId: string, type: string): string {
  return `proactive:${routeId}:${type}:${toLocalDateString(new Date())}`;
}

export function isDismissedToday(routeId: string, type: string): boolean {
  return storage.getBoolean(dismissalKey(routeId, type)) === true;
}

export function dismissToday(routeId: string, type: string): void {
  storage.set(dismissalKey(routeId, type), true);
}
