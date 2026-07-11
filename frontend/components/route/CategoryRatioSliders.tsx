import { useState } from 'react';
import { ActivityIndicator, Text, TouchableOpacity, View } from 'react-native';
import { useTranslation } from 'react-i18next';
import Slider from '@react-native-community/slider';
import { BUDGET_COLORS, RATIO_CATEGORY_COLORS, RECEIPT_LABEL } from '@/lib/constants/budgetTheme';

type Ratios = { food: number; transport: number; activity: number; etc: number };

const CATEGORY_KEYS: { key: keyof Ratios; color: string }[] = [
  { key: 'food', color: RATIO_CATEGORY_COLORS.food },
  { key: 'transport', color: RATIO_CATEGORY_COLORS.transport },
  { key: 'activity', color: RATIO_CATEGORY_COLORS.activity },
  { key: 'etc', color: RATIO_CATEGORY_COLORS.etc },
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
  const { t } = useTranslation();
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
    <View
      className="rounded-2xl p-4 border"
      style={{ backgroundColor: BUDGET_COLORS.paper, borderColor: BUDGET_COLORS.perforation }}
    >
      {/* 현재 비율을 한눈에 보여주는 세그먼트 바 — 슬라이더를 옮기는 즉시 실시간 반영 */}
      <View className="flex-row h-2.5 rounded-full overflow-hidden mb-5" style={{ backgroundColor: BUDGET_COLORS.perforation }}>
        {CATEGORY_KEYS.map(({ key, color }) => (
          <View key={key} style={{ width: `${ratios[key]}%`, backgroundColor: color }} />
        ))}
      </View>

      {CATEGORY_KEYS.map(({ key, color }) => (
        <View key={key} className="mb-4 last:mb-0">
          <View className="flex-row justify-between mb-1">
            <Text
              className="text-xs font-bold"
              style={{ color: BUDGET_COLORS.ink, ...RECEIPT_LABEL }}
            >
              {t(`budget.categoryLabels.${key}`)}
            </Text>
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
            maximumTrackTintColor={BUDGET_COLORS.perforation}
            thumbTintColor={color}
            onValueChange={(v) => setRatios((prev) => rebalance(prev, key, v))}
          />
        </View>
      ))}

      <TouchableOpacity
        onPress={handleSave}
        disabled={saving}
        className="py-3 rounded-2xl items-center mt-2"
        style={{ backgroundColor: BUDGET_COLORS.ledgerGreen }}
        activeOpacity={0.9}
      >
        {saving ? <ActivityIndicator color="#fff" /> : <Text className="text-white font-bold text-sm">{t('budget.saveButton')}</Text>}
      </TouchableOpacity>
    </View>
  );
}
