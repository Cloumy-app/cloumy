import { createMMKV } from 'react-native-mmkv';
import type { ProactiveIntervention } from '@/types';

// 프로액티브 배너 중복 노출 방지. 서버(Redis)가 진실이고 이 MMKV는 즉시 UX 레이어다 —
// refetch를 기다리지 않고 바로 숨기기 위한 것.
// 키: proactive:{routeId}:{type}:{placeId ?? '-'}:{YYYY-MM-DD}
const storage = createMMKV({ id: 'proactive' });

// 서버(Spring LocalDate.now(KST), FastAPI datetime.now(_KST))와 같은 날짜를 써야 한다.
// Intl의 timeZone 지원이 Hermes 플랫폼마다 달라 UTC+9 산술로 계산한다(KST는 DST 없음).
function toKstDateString(date: Date = new Date()): string {
  return new Date(date.getTime() + 9 * 60 * 60 * 1000).toISOString().slice(0, 10);
}

function dismissalKey(routeId: string, type: string, placeId?: string): string {
  return `proactive:${routeId}:${type}:${placeId ?? '-'}:${toKstDateString()}`;
}

export function isDismissedToday(routeId: string, type: string, placeId?: string): boolean {
  return storage.getBoolean(dismissalKey(routeId, type, placeId)) === true;
}

export function dismissToday(routeId: string, type: string, placeId?: string): void {
  storage.set(dismissalKey(routeId, type, placeId), true);
}

// Phase C의 신규 6종만 params.placeId를 갖는다. 기존 9종은 undefined —
// 'in' 좁히기라 Phase C에서 필드를 추가해도 그대로 동작한다.
export function interventionPlaceId(i: ProactiveIntervention): string | undefined {
  return 'placeId' in i.params ? (i.params.placeId as string | undefined) : undefined;
}
