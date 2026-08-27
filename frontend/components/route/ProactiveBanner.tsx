import { Text, TouchableOpacity, View } from 'react-native';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useRouter } from 'expo-router';
import { useTranslation } from 'react-i18next';
import { Sparkles, X } from 'lucide-react-native';
import { getProactive, sendProactiveFeedback } from '@/lib/api/proactive';
import { useChatStore } from '@/stores/useChatStore';
import { isDismissedToday, dismissToday, interventionPlaceId } from '@/lib/proactiveDismissal';
import { buildProactiveText, asI18nParams } from '@/lib/proactiveText';

export function ProactiveBanner({ routeId }: { routeId: string }) {
  const { t, i18n } = useTranslation();
  const router = useRouter();
  const queryClient = useQueryClient();
  const seedFromProactive = useChatStore((s) => s.seedFromProactive);

  // 배너는 실패해도 없는 채로 넘어가면 그만이다(FFE #11) — retry: false, 에러 시 무렌더
  const { data, isError } = useQuery({
    queryKey: ['proactive', routeId],
    queryFn: () => getProactive(routeId),
    staleTime: 1000 * 60 * 5,
    retry: false,
  });

  const intervention = data ?? null;
  const placeId = intervention ? interventionPlaceId(intervention) : undefined;
  if (isError || !intervention || isDismissedToday(routeId, intervention.type, placeId)) {
    return null;
  }

  const text = buildProactiveText(t, i18n.language, intervention);

  const handleTap = () => {
    dismissToday(routeId, intervention.type, placeId);
    sendProactiveFeedback(routeId, intervention.type, 'tapped', placeId);
    seedFromProactive(routeId, intervention.type, asI18nParams(intervention.params), text);
    router.push('/chat' as never);
  };

  const handleDismiss = () => {
    dismissToday(routeId, intervention.type, placeId);
    sendProactiveFeedback(routeId, intervention.type, 'dismissed', placeId);
    // MMKV 쓰기만으론 리렌더가 안 나 배너가 화면에 남는다. 배너와 챗봇이 같은 쿼리 키를
    // 공유하므로 캐시를 비우면 양쪽이 함께 정리되고, 이 컴포넌트도 즉시 null을 렌더한다.
    queryClient.setQueryData(['proactive', routeId], null);
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
        // 홈 최상단(헤더 위)에 놓이므로 좌우 여백을 부모에 기대지 않고 자체적으로 갖는다.
        // 개입이 없으면 이 컴포넌트가 통째로 null이라 빈 여백도 남지 않는다.
        marginHorizontal: 24,
        marginTop: 12,
        marginBottom: 4,
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
