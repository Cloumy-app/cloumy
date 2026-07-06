import { Text, TouchableOpacity, View } from 'react-native';
import { router } from 'expo-router';
import { Wallet } from 'lucide-react-native';
import type { BudgetSummary } from '@/types';

export function BudgetBanner({ routeId, summary }: { routeId: string; summary: BudgetSummary }) {
  if (summary.totalBudget === null) {
    return (
      <TouchableOpacity
        onPress={() => router.push({ pathname: '/route/[routeId]/budget', params: { routeId } })}
        className="flex-row items-center justify-center gap-2 bg-sky-50 border-2 border-dashed border-sky-200 rounded-2xl py-4 mb-4"
        activeOpacity={0.8}
      >
        <Wallet size={16} color="#0ea5e9" />
        <Text className="text-sky-600 font-semibold text-sm">예산 설정하기</Text>
      </TouchableOpacity>
    );
  }

  const spent = summary.plannedTotal + summary.unplannedTotal;
  const remaining = summary.remaining ?? 0;
  const isOver = remaining < 0;
  const ratio = summary.totalBudget > 0 ? Math.min(1, spent / summary.totalBudget) : 0;

  return (
    <TouchableOpacity
      onPress={() => router.push({ pathname: '/route/[routeId]/budget', params: { routeId } })}
      className="bg-white border border-slate-100 rounded-2xl p-4 mb-4"
      activeOpacity={0.8}
    >
      <View className="flex-row justify-between items-center mb-2">
        <Text className="text-xs font-bold text-slate-500">현지 활동/식사 예산</Text>
        <Text className={`text-sm font-bold ${isOver ? 'text-rose-500' : 'text-sky-600'}`}>
          잔여 {remaining.toLocaleString()}원
        </Text>
      </View>
      <View className="w-full bg-slate-100 rounded-full h-2">
        <View
          className={`h-2 rounded-full ${isOver ? 'bg-rose-500' : 'bg-sky-500'}`}
          style={{ width: `${Math.round(ratio * 100)}%` }}
        />
      </View>
    </TouchableOpacity>
  );
}
