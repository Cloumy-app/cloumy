import { useState } from 'react';
import { ActivityIndicator, Text, TouchableOpacity, View } from 'react-native';
import Slider from '@react-native-community/slider';

type Ratios = { food: number; transport: number; activity: number; etc: number };

const CATEGORY_LABELS: { key: keyof Ratios; label: string; color: string }[] = [
  { key: 'food', label: '식음료', color: '#0ea5e9' },
  { key: 'transport', label: '교통', color: '#22c55e' },
  { key: 'activity', label: '입장료', color: '#f59e0b' },
  { key: 'etc', label: '기타', color: '#a855f7' },
];

// 슬라이더 하나를 옮기면 나머지 3개를 기존 비중대로 비례 재분배해 합이 항상 100 유지
function rebalance(current: Ratios, changedKey: keyof Ratios, newValue: number): Ratios {
  const remaining = 100 - newValue;
  const othersSum = (Object.keys(current) as (keyof Ratios)[])
    .filter((k) => k !== changedKey)
    .reduce((sum, k) => sum + current[k], 0);

  const result = { ...current, [changedKey]: newValue };
  (Object.keys(current) as (keyof Ratios)[])
    .filter((k) => k !== changedKey)
    .forEach((k) => {
      result[k] = othersSum === 0 ? remaining / 3 : (current[k] / othersSum) * remaining;
    });
  return result;
}

export function CategoryRatioSliders({
  initial,
  onSave,
}: {
  initial: Ratios; // 0~1 비율
  onSave: (ratios: Ratios) => Promise<void>;
}) {
  const [ratios, setRatios] = useState<Ratios>({
    food: initial.food * 100,
    transport: initial.transport * 100,
    activity: initial.activity * 100,
    etc: initial.etc * 100,
  });
  const [saving, setSaving] = useState(false);

  const handleSave = async () => {
    setSaving(true);
    try {
      await onSave({
        food: ratios.food / 100,
        transport: ratios.transport / 100,
        activity: ratios.activity / 100,
        etc: ratios.etc / 100,
      });
    } finally {
      setSaving(false);
    }
  };

  return (
    <View className="bg-white border border-slate-100 rounded-2xl p-4">
      {CATEGORY_LABELS.map(({ key, label, color }) => (
        <View key={key} className="mb-4 last:mb-0">
          <View className="flex-row justify-between mb-1">
            <Text className="text-sm font-bold text-slate-700">{label}</Text>
            <Text className="text-sm font-bold" style={{ color }}>
              {Math.round(ratios[key])}%
            </Text>
          </View>
          <Slider
            value={ratios[key]}
            minimumValue={0}
            maximumValue={100}
            step={1}
            minimumTrackTintColor={color}
            maximumTrackTintColor="#e2e8f0"
            onValueChange={(v) => setRatios((prev) => rebalance(prev, key, v))}
          />
        </View>
      ))}

      <TouchableOpacity
        onPress={handleSave}
        disabled={saving}
        className="bg-sky-500 py-3 rounded-2xl items-center mt-2"
        activeOpacity={0.9}
      >
        {saving ? <ActivityIndicator color="#fff" /> : <Text className="text-white font-bold text-sm">저장</Text>}
      </TouchableOpacity>
    </View>
  );
}
