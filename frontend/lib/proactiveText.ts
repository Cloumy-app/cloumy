import type { TFunction } from 'i18next';
import type { ProactiveIntervention } from '@/types';

// 서버(FastAPI)는 type + params만 반환한다(판단은 규칙이, 표현은 앱이) — 문구는 여기서 조립한다.
// 홈 배너(ProactiveBanner)와 챗봇 자동 개입(chat.tsx)이 같은 문구를 써야 해서 공용 모듈로 뒀다.
// 한쪽에만 로직이 있으면 같은 개입인데 화면마다 다른 말이 나온다.

function formatClockTime(isoDateTime: string, locale: string): string {
  return new Date(isoDateTime).toLocaleTimeString(locale, { hour: '2-digit', minute: '2-digit' });
}

// i18next의 t() 두 번째 인자는 인덱스 시그니처가 있는 타입을 요구한다 — 서버 params 타입은
// 규칙별로 필드가 고정돼 있어(any 금지) 여기서만 보간용으로 넓혀서 넘긴다.
export function asI18nParams(params: object): Record<string, unknown> {
  return params as Record<string, unknown>;
}

export function buildProactiveText(
  t: TFunction,
  locale: string,
  intervention: ProactiveIntervention,
): string {
  if (intervention.type === 'PRE_TRIP_BRIEFING') {
    const { destination, nights, flags } = intervention.params;
    const intro = t('proactive.PRE_TRIP_BRIEFING', {
      destination: t(`routeCreateStep1.cities.${destination}`, destination),
      nights,
    });
    const flagTexts = flags.map((flag) => {
      if (flag.kind === 'first_slot') {
        return t('proactive.flags.first_slot', asI18nParams({ ...flag, time: flag.time.slice(0, 5) }));
      }
      return t(`proactive.flags.${flag.kind}`, asI18nParams(flag));
    });
    return [intro, ...flagTexts].join(' ');
  }

  if (intervention.type === 'WEATHER_ALERT') {
    return t(`proactive.WEATHER_ALERT.${intervention.params.kind}`, asI18nParams(intervention.params));
  }

  if (intervention.type === 'FLIGHT_DEPARTURE') {
    return t('proactive.FLIGHT_DEPARTURE', asI18nParams({
      ...intervention.params,
      leaveByTime: formatClockTime(intervention.params.leaveByTime, locale),
    }));
  }

  if (intervention.type === 'RETURN_DEPARTURE') {
    // T1(FLIGHT_DEPARTURE)과 동일한 처리 — leaveByTime을 시각 포맷으로 변환한다.
    return t('proactive.RETURN_DEPARTURE', asI18nParams({
      ...intervention.params,
      leaveByTime: formatClockTime(intervention.params.leaveByTime, locale),
    }));
  }

  if (intervention.type === 'LAST_TRANSIT') {
    // FLIGHT_DEPARTURE·RETURN_DEPARTURE와 동일 처리 — leaveByTime이 자정을 넘길 수 있는
    // ISO datetime이라 formatClockTime으로 시각만 뽑는다.
    return t('proactive.LAST_TRANSIT', asI18nParams({
      ...intervention.params,
      leaveByTime: formatClockTime(intervention.params.leaveByTime, locale),
    }));
  }

  if (intervention.type === 'BREAK_TIME') {
    // PRE_TRIP_BRIEFING.flags.first_slot과 동일 처리 — 벽시계 "HH:MM:SS"에서 "HH:MM"만 쓴다.
    return t('proactive.BREAK_TIME', asI18nParams({
      ...intervention.params,
      breakStart: intervention.params.breakStart.slice(0, 5),
      breakEnd: intervention.params.breakEnd.slice(0, 5),
    }));
  }

  if (intervention.type === 'LAST_ENTRY') {
    return t('proactive.LAST_ENTRY', asI18nParams({
      ...intervention.params,
      lastEntryTime: intervention.params.lastEntryTime.slice(0, 5),
      closeTime: intervention.params.closeTime.slice(0, 5),
    }));
  }

  if (intervention.type === 'PAYMENT_WALL') {
    // WEATHER_ALERT와 동일 형태 — kind 서브키로 갈라진다.
    return t(`proactive.PAYMENT_WALL.${intervention.params.kind}`, asI18nParams(intervention.params));
  }

  return t(`proactive.${intervention.type}`, asI18nParams(intervention.params));
}
