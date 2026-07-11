import { ActivityIndicator, ScrollView, Text, TouchableOpacity, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useTranslation } from 'react-i18next';
import { router, useLocalSearchParams } from 'expo-router';
import { ChevronLeft } from 'lucide-react-native';
import { useQuery } from '@tanstack/react-query';
import { Pie, PolarChart } from 'victory-native';
import { getBudgetReport } from '@/lib/api/budget';
import type { ExpenseCategory } from '@/types';
import { BUDGET_COLORS, EXPENSE_CATEGORY_COLORS, RECEIPT_LABEL, TABULAR_NUMS } from '@/lib/constants/budgetTheme';
import { ReceiptEdge } from '@/components/route/ReceiptEdge';

export default function BudgetReportScreen() {
  const { t } = useTranslation();
  const { routeId } = useLocalSearchParams<{ routeId: string }>();

  const { data: report, isLoading } = useQuery({
    queryKey: ['budget-report', routeId],
    queryFn: () => getBudgetReport(routeId),
  });

  const chartData = (report?.unplannedByCategory ?? []).map((c) => ({
    label: t(`budgetAddExpense.categories.${c.category.toLowerCase()}`),
    value: c.total,
    color: EXPENSE_CATEGORY_COLORS[c.category as ExpenseCategory] ?? BUDGET_COLORS.ink,
  }));
  const hasUnplanned = chartData.length > 0;

  return (
    <SafeAreaView className="flex-1" edges={['top']} style={{ backgroundColor: BUDGET_COLORS.screenBg }}>
      <View
        className="flex-row items-center px-5 py-3 border-b"
        style={{ backgroundColor: BUDGET_COLORS.paper, borderColor: BUDGET_COLORS.perforation }}
      >
        <TouchableOpacity onPress={() => router.back()} className="mr-3">
          <ChevronLeft size={24} color={BUDGET_COLORS.ink} />
        </TouchableOpacity>
        <Text className="text-lg font-bold" style={{ color: BUDGET_COLORS.ink }}>{t('budgetReport.headerTitle')}</Text>
      </View>

      {isLoading ? (
        <View className="flex-1 items-center justify-center">
          <ActivityIndicator color={BUDGET_COLORS.ledgerGreen} />
        </View>
      ) : (
        <ScrollView className="flex-1 px-6 pt-6">
          <View>
            <View className="rounded-t-2xl p-4" style={{ backgroundColor: BUDGET_COLORS.paper }}>
              <Text className="text-[11px] font-bold mb-1" style={{ color: BUDGET_COLORS.ink, ...RECEIPT_LABEL }}>
                {t('budgetReport.localActivityCost')}
              </Text>
              <Text className="text-2xl font-black" style={{ color: BUDGET_COLORS.ink, ...TABULAR_NUMS }}>
                {t('routeResult.budgetExact', { amount: (report?.plannedTotal ?? 0).toLocaleString() })}
              </Text>
              <Text className="text-xs mt-1" style={{ color: '#9C8F73' }}>{t('budgetReport.localActivitySubtitle')}</Text>
            </View>
            <ReceiptEdge notchColor={BUDGET_COLORS.screenBg} />
          </View>

          <Text className="text-xs font-bold mb-3 mt-6" style={{ color: BUDGET_COLORS.ink, ...RECEIPT_LABEL }}>
            {t('budget.unplannedExpense')}
          </Text>
          {hasUnplanned ? (
            <>
              <View style={{ height: 220 }} className="mb-4">
                <PolarChart data={chartData} labelKey="label" valueKey="value" colorKey="color">
                  <Pie.Chart />
                </PolarChart>
              </View>
              {chartData.map((c) => (
                <View
                  key={c.label}
                  className="flex-row items-center justify-between py-2 border-b border-dashed"
                  style={{ borderColor: BUDGET_COLORS.perforation }}
                >
                  <View className="flex-row items-center gap-2">
                    <View style={{ width: 10, height: 10, borderRadius: 5, backgroundColor: c.color }} />
                    <Text className="text-sm font-semibold" style={{ color: BUDGET_COLORS.ink }}>{c.label}</Text>
                  </View>
                  <Text className="text-sm font-bold" style={{ color: BUDGET_COLORS.ink, ...TABULAR_NUMS }}>
                    {t('routeResult.budgetExact', { amount: c.value.toLocaleString() })}
                  </Text>
                </View>
              ))}
            </>
          ) : (
            <Text className="text-sm text-center mt-8" style={{ color: '#B5AA92' }}>{t('budget.noExpensesYet')}</Text>
          )}

          <View className="h-10" />
        </ScrollView>
      )}
    </SafeAreaView>
  );
}
