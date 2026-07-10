import { View, Text, TouchableOpacity, ActivityIndicator } from 'react-native';
import { useTranslation } from 'react-i18next';
import { X } from 'lucide-react-native';

interface DayPickerConfirmProps {
  name: string;
  address: string | null;
  dayCount: number;
  loading?: boolean;
  onConfirmDay: (day: number) => void;
  onCancel: () => void;
}

// "며칠차에 넣을까요?" 확인 UI — SearchPlaceTab(직접 검색)과 북마크한 장소 탭이 공용으로 쓴다.
export function DayPickerConfirm({ name, address, dayCount, loading = false, onConfirmDay, onCancel }: DayPickerConfirmProps) {
  const { t } = useTranslation();

  return (
    <View className="flex-1 px-6">
      <View className="border-2 border-sky-500 bg-sky-50 rounded-2xl px-4 py-4 mb-4">
        <View className="flex-row items-start justify-between mb-3">
          <View className="flex-1 mr-2">
            <Text className="font-bold text-sky-700 text-sm mb-1">{name}</Text>
            {address && (
              <Text className="text-xs text-sky-500" numberOfLines={2}>{address}</Text>
            )}
          </View>
          <TouchableOpacity onPress={onCancel} disabled={loading}>
            <X size={18} color="#0284c7" />
          </TouchableOpacity>
        </View>
        <Text className="text-xs text-slate-500 mb-2">{t('routeCreateImport.pickDayLabel')}</Text>
        <View className="flex-row flex-wrap gap-1.5">
          {Array.from({ length: dayCount }, (_, i) => i + 1).map((d) => (
            <TouchableOpacity
              key={d}
              onPress={() => onConfirmDay(d)}
              disabled={loading}
              className="px-2.5 py-1 rounded-full border border-sky-300 bg-white"
            >
              <Text className="text-[11px] font-bold text-sky-600">
                {t('routeCreateImport.dayChip', { day: d })}
              </Text>
            </TouchableOpacity>
          ))}
        </View>
        {loading && <ActivityIndicator className="mt-3" />}
      </View>
    </View>
  );
}
