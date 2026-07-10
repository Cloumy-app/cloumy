import { useState } from 'react';
import { View, Text, TouchableOpacity } from 'react-native';
import { useTranslation } from 'react-i18next';
import { Heart, Gem, ChevronDown, ChevronUp, Navigation } from 'lucide-react-native';
import { openWalkNavigation } from '@/lib/navigation';
import type { PlaceBrowseItem } from '@/types';

interface PlaceBrowseCardProps {
  place: PlaceBrowseItem;
  onToggleBookmark: () => void;
  isFocused?: boolean;
  onFocusMap?: () => void;
}

export function PlaceBrowseCard({ place, onToggleBookmark, isFocused = false, onFocusMap }: PlaceBrowseCardProps) {
  const { t } = useTranslation();
  const [expanded, setExpanded] = useState(false);

  const handlePress = () => {
    setExpanded((v) => !v);
    onFocusMap?.();
  };

  return (
    <TouchableOpacity
      onPress={handlePress}
      activeOpacity={0.8}
      className="bg-white rounded-2xl p-4 mb-3"
      style={{ borderWidth: isFocused ? 2 : 1, borderColor: isFocused ? '#0ea5e9' : '#f1f5f9' }}
    >
      <View className="flex-row items-start justify-between">
        <View className="flex-1 mr-3">
          <View className="flex-row items-center gap-1.5 mb-1">
            <Text className="font-bold text-base text-slate-800">{place.name}</Text>
            {place.isHiddenGem && <Gem size={14} color="#a855f7" />}
          </View>
          {place.address && (
            <Text className="text-xs text-slate-400 mb-2" numberOfLines={expanded ? undefined : 1}>
              {place.address}
            </Text>
          )}
          <View className="flex-row flex-wrap gap-1.5">
            {place.categoryTags.map((tag) => (
              <View key={tag} className="bg-slate-50 rounded-lg px-2 py-1">
                <Text className="text-[10px] font-semibold text-slate-500">{tag}</Text>
              </View>
            ))}
          </View>

          {expanded && (
            <TouchableOpacity
              onPress={() => openWalkNavigation(place.lat, place.lng)}
              activeOpacity={0.85}
              className="flex-row items-center justify-center gap-2 bg-blue-500 rounded-2xl py-3 mt-3"
            >
              <Navigation size={16} color="#ffffff" />
              <Text className="font-bold text-white text-sm">{t('placeDetail.openInGoogleMaps')}</Text>
            </TouchableOpacity>
          )}
        </View>

        <View className="items-center gap-3">
          <TouchableOpacity onPress={onToggleBookmark} hitSlop={8}>
            <Heart
              size={20}
              color={place.isBookmarked ? '#f43f5e' : '#cbd5e1'}
              fill={place.isBookmarked ? '#f43f5e' : 'none'}
            />
          </TouchableOpacity>
          {expanded ? <ChevronUp size={16} color="#94a3b8" /> : <ChevronDown size={16} color="#94a3b8" />}
        </View>
      </View>
    </TouchableOpacity>
  );
}
