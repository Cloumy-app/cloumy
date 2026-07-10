import { useState } from 'react';
import { View, Text, TouchableOpacity } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { router } from 'expo-router';
import { useTranslation } from 'react-i18next';
import { Music, Clapperboard, UtensilsCrossed, Sparkles, Landmark, Mountain, ShoppingBag, Moon } from 'lucide-react-native';
import { PersonaSwipeCard } from '@/components/onboarding/PersonaSwipeCard';
import { completeOnboarding } from '@/lib/api/users';
import { useAuthStore } from '@/stores/useAuthStore';
import type { PersonaTag } from '@/lib/constants/personaTags';

// 실제 카드 이미지·문구는 컨텐츠 확정 후 교체 예정 — 지금은 아이콘 플레이스홀더
// (설계: docs/superpowers/specs/2026-07-10-persona-tag-system-design.md)
const CARDS: { titleKey: string; Icon: typeof Music; accentColor: string; personas: PersonaTag[] }[] = [
  { titleKey: 'kpopConcert', Icon: Music, accentColor: '#0ea5e9', personas: ['K_POP_PILGRIM'] },
  { titleKey: 'dramaFilmingSite', Icon: Clapperboard, accentColor: '#8b5cf6', personas: ['K_DRAMA_FAN'] },
  { titleKey: 'streetFood', Icon: UtensilsCrossed, accentColor: '#f97316', personas: ['K_FOOD_LOVER'] },
  { titleKey: 'beautyStreet', Icon: Sparkles, accentColor: '#ec4899', personas: ['K_BEAUTY_ADDICT'] },
  { titleKey: 'palaceHanbok', Icon: Landmark, accentColor: '#b45309', personas: ['CULTURE_EXPLORER'] },
  { titleKey: 'natureTrail', Icon: Mountain, accentColor: '#16a34a', personas: ['NATURE_SEEKER'] },
  { titleKey: 'shoppingDistrict', Icon: ShoppingBag, accentColor: '#dc2626', personas: ['SHOPPING_MAVEN', 'CONTENT_CREATOR'] },
  { titleKey: 'nightCafeView', Icon: Moon, accentColor: '#1e293b', personas: ['NIGHT_OWL', 'CAFE_HOPPER'] },
];

const MAX_PERSONA_TAGS = 3;

export default function OnboardingScreen() {
  const { t } = useTranslation();
  const setUser = useAuthStore((s) => s.setUser);
  const user = useAuthStore((s) => s.user);
  const [index, setIndex] = useState(0);
  const [liked, setLiked] = useState<PersonaTag[]>([]);
  const [submitting, setSubmitting] = useState(false);

  const finish = async (tags: PersonaTag[]) => {
    setSubmitting(true);
    try {
      const updated = await completeOnboarding(tags);
      setUser(updated);
      router.replace('/(tabs)');
    } catch {
      // 실패해도 앱 진입은 막지 않음 — 다음 로그인 때 온보딩 재노출(정상)
      router.replace('/(tabs)');
    } finally {
      setSubmitting(false);
    }
  };

  const handleSwipe = (direction: 'like' | 'pass') => {
    const nextLiked = direction === 'like' ? [...liked, ...CARDS[index].personas] : liked;
    setLiked(nextLiked);

    if (index + 1 >= CARDS.length) {
      const uniqueTags = Array.from(new Set(nextLiked)).slice(0, MAX_PERSONA_TAGS);
      finish(uniqueTags);
      return;
    }
    setIndex(index + 1);
  };

  // 스킵도 반드시 API를 호출해야 함(빈 배열) — 그래야 onboarding_completed_at이 세팅돼
  // 다음 로그인 때 온보딩이 또 뜨지 않음
  const handleSkip = () => finish([]);

  if (!user) {
    return null;
  }

  const currentCard = CARDS[index];

  return (
    <SafeAreaView className="flex-1 bg-white">
      <View className="flex-row justify-between items-center px-6 py-4">
        <Text className="text-sm font-bold text-slate-400">
          {t('onboarding.progress', { current: index + 1, total: CARDS.length })}
        </Text>
        <TouchableOpacity onPress={handleSkip} disabled={submitting}>
          <Text className="text-sm font-semibold text-slate-400">{t('onboarding.skipButton')}</Text>
        </TouchableOpacity>
      </View>

      <View className="flex-1 items-center justify-center px-8">
        <Text className="text-xl font-bold text-slate-800 mb-6 text-center">
          {t('onboarding.headerTitle')}
        </Text>
        <PersonaSwipeCard
          key={currentCard.titleKey}
          titleKey={currentCard.titleKey}
          Icon={currentCard.Icon}
          accentColor={currentCard.accentColor}
          onSwipe={handleSwipe}
        />
        <Text className="text-xs text-slate-400 mt-6">{t('onboarding.swipeHint')}</Text>
      </View>
    </SafeAreaView>
  );
}
