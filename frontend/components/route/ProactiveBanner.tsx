import { Text, TouchableOpacity, View } from 'react-native';
import { useQuery } from '@tanstack/react-query';
import { useRouter } from 'expo-router';
import { useTranslation } from 'react-i18next';
import type { TFunction } from 'i18next';
import { Sparkles, X } from 'lucide-react-native';
import { getProactive, sendProactiveFeedback } from '@/lib/api/proactive';
import { useChatStore } from '@/stores/useChatStore';
import { isDismissedToday, dismissToday } from '@/lib/proactiveDismissal';
import type { ProactiveIntervention } from '@/types';

// 서버(FastAPI)는 type + params만 반환한다(판단은 규칙이, 표현은 앱이) — 여기서 문구를 조립한다.
function formatClockTime(isoDateTime: string, locale: string): string {
  return new Date(isoDateTime).toLocaleTimeString(locale, { hour: '2-digit', minute: '2-digit' });
}

// i18next의 t() 두 번째 인자는 인덱스 시그니처가 있는 타입을 요구한다 — 서버 params 타입은
// 규칙별로 필드가 고정돼 있어(any 금지) 여기서만 보간용으로 넓혀서 넘긴다.
function asI18nParams(params: object): Record<string, unknown> {
  return params as Record<string, unknown>;
}

function buildProactiveText(t: TFunction, locale: string, intervention: ProactiveIntervention): string {
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

  return t(`proactive.${intervention.type}`, asI18nParams(intervention.params));
}

export function ProactiveBanner({ routeId }: { routeId: string }) {
  const { t, i18n } = useTranslation();
  const router = useRouter();
  const seedFromProactive = useChatStore((s) => s.seedFromProactive);

  // 배너는 실패해도 없는 채로 넘어가면 그만이다(FFE #11) — retry: false, 에러 시 무렌더
  const { data, isError } = useQuery({
    queryKey: ['proactive', routeId],
    queryFn: () => getProactive(routeId),
    staleTime: 1000 * 60 * 5,
    retry: false,
  });

  const intervention = data ?? null;
  if (isError || !intervention || isDismissedToday(routeId, intervention.type)) {
    return null;
  }

  const text = buildProactiveText(t, i18n.language, intervention);

  const handleTap = () => {
    dismissToday(routeId, intervention.type);
    sendProactiveFeedback(routeId, intervention.type, 'tapped');
    seedFromProactive(intervention.type, asI18nParams(intervention.params), text);
    router.push('/chat' as never);
  };

  const handleDismiss = () => {
    dismissToday(routeId, intervention.type);
    sendProactiveFeedback(routeId, intervention.type, 'dismissed');
  };

  return (
    <TouchableOpacity
      onPress={handleTap}
      activeOpacity={0.85}
      style={{
        flexDirection: 'row',
        alignItems: 'center',
        gap: 10,
        backgroundColor: '#f0f9ff',
        borderWidth: 1,
        borderColor: '#bae6fd',
        borderRadius: 20,
        paddingVertical: 12,
        paddingHorizontal: 16,
        marginBottom: 16,
      }}
    >
      <View
        style={{
          width: 32,
          height: 32,
          borderRadius: 16,
          backgroundColor: '#0ea5e9',
          alignItems: 'center',
          justifyContent: 'center',
        }}
      >
        <Sparkles size={16} color="#ffffff" />
      </View>
      <Text style={{ flex: 1, color: '#0c4a6e', fontSize: 13, fontWeight: '600' }} numberOfLines={3}>
        {text}
      </Text>
      <TouchableOpacity onPress={handleDismiss} hitSlop={10} style={{ padding: 4 }}>
        <X size={16} color="#0284c7" />
      </TouchableOpacity>
    </TouchableOpacity>
  );
}
