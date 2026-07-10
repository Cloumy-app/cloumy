import { View, Text } from 'react-native';
import Animated, { useSharedValue, useAnimatedStyle, withTiming, runOnJS } from 'react-native-reanimated';
import { Gesture, GestureDetector } from 'react-native-gesture-handler';
import { useTranslation } from 'react-i18next';

const SWIPE_THRESHOLD = 120;

interface PersonaSwipeCardProps {
  titleKey: string;
  Icon: React.ComponentType<{ size: number; color: string }>;
  accentColor: string;
  onSwipe: (direction: 'like' | 'pass') => void;
}

// DraggableSlotRow(components/route/SlotCard.tsx)의 Gesture.Pan + reanimated 패턴을
// 세로(translateY) 대신 가로(translateX) 스와이프로 재사용.
export function PersonaSwipeCard({ titleKey, Icon, accentColor, onSwipe }: PersonaSwipeCardProps) {
  const { t } = useTranslation();
  const translateX = useSharedValue(0);

  const panGesture = Gesture.Pan()
    .onUpdate((e) => {
      translateX.value = e.translationX;
    })
    .onEnd(() => {
      if (translateX.value > SWIPE_THRESHOLD) {
        translateX.value = withTiming(500, { duration: 200 });
        runOnJS(onSwipe)('like');
      } else if (translateX.value < -SWIPE_THRESHOLD) {
        translateX.value = withTiming(-500, { duration: 200 });
        runOnJS(onSwipe)('pass');
      } else {
        translateX.value = withTiming(0, { duration: 150 });
      }
    });

  const cardStyle = useAnimatedStyle(() => ({
    transform: [
      { translateX: translateX.value },
      { rotate: `${translateX.value / 20}deg` },
    ],
  }));

  const likeStyle = useAnimatedStyle(() => ({
    opacity: Math.min(Math.max(translateX.value / SWIPE_THRESHOLD, 0), 1),
  }));

  const passStyle = useAnimatedStyle(() => ({
    opacity: Math.min(Math.max(-translateX.value / SWIPE_THRESHOLD, 0), 1),
  }));

  return (
    <GestureDetector gesture={panGesture}>
      <Animated.View
        style={cardStyle}
        className="w-full aspect-[3/4] rounded-3xl items-center justify-center shadow-sm"
      >
        <View
          className="w-full h-full rounded-3xl items-center justify-center"
          style={{ backgroundColor: accentColor }}
        >
          <Icon size={64} color="#ffffff" />
          <Text className="text-white font-bold text-xl mt-4 px-6 text-center">
            {t(`onboarding.cards.${titleKey}`)}
          </Text>
        </View>

        <Animated.View style={likeStyle} className="absolute top-8 left-8 border-4 border-emerald-400 rounded-xl px-3 py-1">
          <Text className="text-emerald-400 font-black text-lg">{t('onboarding.likeLabel')}</Text>
        </Animated.View>
        <Animated.View style={passStyle} className="absolute top-8 right-8 border-4 border-slate-400 rounded-xl px-3 py-1">
          <Text className="text-slate-400 font-black text-lg">{t('onboarding.passLabel')}</Text>
        </Animated.View>
      </Animated.View>
    </GestureDetector>
  );
}
