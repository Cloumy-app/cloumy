import { View, Text, TouchableOpacity } from 'react-native';
import { Heart, Gem } from 'lucide-react-native';
import type { PlaceBrowseItem } from '@/types';

interface PlaceBrowseCardProps {
  place: PlaceBrowseItem;
  onPress: () => void;
  onToggleBookmark: () => void;
}

export function PlaceBrowseCard({ place, onPress, onToggleBookmark }: PlaceBrowseCardProps) {
  return (
    <TouchableOpacity
      onPress={onPress}
      activeOpacity={0.8}
      className="bg-white rounded-2xl border border-slate-100 p-4 mb-3"
    >
      <View className="flex-row items-start justify-between">
        <View className="flex-1 mr-3">
          <View className="flex-row items-center gap-1.5 mb-1">
            <Text className="font-bold text-base text-slate-800">{place.name}</Text>
            {place.isHiddenGem && <Gem size={14} color="#a855f7" />}
          </View>
          {place.address && (
            <Text className="text-xs text-slate-400 mb-2" numberOfLines={1}>{place.address}</Text>
          )}
          <View className="flex-row flex-wrap gap-1.5">
            {place.categoryTags.map((tag) => (
              <View key={tag} className="bg-slate-50 rounded-lg px-2 py-1">
                <Text className="text-[10px] font-semibold text-slate-500">{tag}</Text>
              </View>
            ))}
          </View>
        </View>
        <TouchableOpacity onPress={onToggleBookmark} hitSlop={8}>
          <Heart
            size={20}
            color={place.isBookmarked ? '#f43f5e' : '#cbd5e1'}
            fill={place.isBookmarked ? '#f43f5e' : 'none'}
          />
        </TouchableOpacity>
      </View>
    </TouchableOpacity>
  );
}
