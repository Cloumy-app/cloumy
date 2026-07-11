import { Text, TouchableOpacity, View } from 'react-native';
import { router } from 'expo-router';
import { useTranslation } from 'react-i18next';
import { Wallet } from 'lucide-react-native';
import type { BudgetSummary } from '@/types';
import { BUDGET_COLORS, TABULAR_NUMS } from '@/lib/constants/budgetTheme';
import { ReceiptEdge } from '@/components/route/ReceiptEdge';

// 루트 상세 화면은 앱 전역 sky 브랜딩을 유지하는 컨텍스트라 배너 전체를 예산 팔레트로
// 뒤집지 않는다 — 대신 톱니 엣지 + tabular-num + Ledger Green 포인트만 살짝 얹어
// "탭하면 다른 색의 세계로 들어간다"는 전환 신호로만 쓴다(설계 의도).
export function BudgetBanner({ routeId, summary }: { routeId: string; summary: BudgetSummary }) {
  const { t } = useTranslation();
  if (summary.totalBudget == null) {
    return (
      <TouchableOpacity
        onPress={() => router.push({ pathname: '/route/[routeId]/budget', params: { routeId } })}
        className="flex-row items-center justify-center gap-2 bg-sky-50 border-2 border-dashed border-sky-200 rounded-2xl py-4 mb-4"
        activeOpacity={0.8}
      >
        <Wallet size={16} color="#0ea5e9" />
        <Text className="text-sky-600 font-semibold text-sm">{t('budgetBanner.setBudget')}</Text>
      </TouchableOpacity>
    );
  }

  const spent = summary.plannedTotal + summary.unplannedTotal;
  const remaining = summary.remaining ?? 0;
  const isOver = remaining < 0;
  const ratio = summary.totalBudget > 0 ? Math.min(1, spent / summary.totalBudget) : 0;
  const accent = isOver ? BUDGET_COLORS.rust : BUDGET_COLORS.ledgerGreen;

  return (
    <View className="mb-4">
      <TouchableOpacity
        onPress={() => router.push({ pathname: '/route/[routeId]/budget', params: { routeId } })}
        className="border border-slate-100 rounded-t-2xl p-4"
        style={{ backgroundColor: BUDGET_COLORS.paper }}
        activeOpacity={0.8}
      >
        <View className="flex-row justify-between items-center mb-2">
          <Text className="text-xs font-bold text-slate-500">{t('budgetBanner.localBudgetLabel')}</Text>
          <Text className="text-sm font-bold" style={{ color: accent, ...TABULAR_NUMS }}>
            {t('budgetBanner.remaining', { amount: remaining.toLocaleString() })}
          </Text>
        </View>
        <View className="w-full bg-slate-100 rounded-full h-2">
          <View
            className="h-2 rounded-full"
            style={{ width: `${Math.round(ratio * 100)}%`, backgroundColor: accent }}
          />
        </View>
      </TouchableOpacity>
      <ReceiptEdge notchColor="#ffffff" notchCount={10} />
    </View>
  );
}
