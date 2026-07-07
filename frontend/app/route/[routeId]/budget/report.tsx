import { ActivityIndicator, ScrollView, Text, TouchableOpacity, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useTranslation } from 'react-i18next';
import { router, useLocalSearchParams } from 'expo-router';
import { ChevronLeft } from 'lucide-react-native';
import { useQuery } from '@tanstack/react-query';
import { Pie, PolarChart } from 'victory-native';
import { getBudgetReport } from '@/lib/api/budget';

const CATEGORY_COLORS: Record<string, string> = {
  식음료: '#0ea5e9',
  교통: '#22c55e',
  입장료: '#f59e0b',
  기념품: '#ec4899',
  기타: '#a855f7',
};

export default function BudgetReportScreen() {
  const { t } = useTranslation();
  const { routeId } = useLocalSearchParams<{ routeId: string }>();

  const { data: report, isLoading } = useQuery({
    queryKey: ['budget-report', routeId],
    queryFn: () => getBudgetReport(routeId),
  });

  const chartData = (report?.unplannedByCategory ?? []).map((c) => ({
    label: c.category,
    value: c.total,
    color: CATEGORY_COLORS[c.category] ?? '#94a3b8',
  }));
  const hasUnplanned = chartData.length > 0;

  return (
    <SafeAreaView className="flex-1 bg-white" edges={['top']}>
      <View className="flex-row items-center px-5 py-3 border-b border-slate-100">
        <TouchableOpacity onPress={() => router.back()} className="mr-3">
          <ChevronLeft size={24} color="#475569" />
        </TouchableOpacity>
        <Text className="text-lg font-bold text-slate-800">{t('budgetReport.headerTitle')}</Text>
      </View>

      {isLoading ? (
        <View className="flex-1 items-center justify-center">
          <ActivityIndicator color="#0ea5e9" />
        </View>
      ) : (
        <ScrollView className="flex-1 px-6 pt-6">
          <View className="bg-white border border-slate-100 rounded-2xl p-4 mb-6">
            <Text className="text-xs font-bold text-slate-500 mb-1">{t('budgetReport.localActivityCost')}</Text>
            <Text className="text-2xl font-black text-slate-800">
              {t('routeResult.budgetExact', { amount: (report?.plannedTotal ?? 0).toLocaleString() })}
            </Text>
            <Text className="text-xs text-slate-400 mt-1">{t('budgetReport.localActivitySubtitle')}</Text>
          </View>

          <Text className="font-bold text-slate-700 mb-3">{t('budget.unplannedExpense')}</Text>
          {hasUnplanned ? (
            <>
              <View style={{ height: 220 }} className="mb-4">
                <PolarChart data={chartData} labelKey="label" valueKey="value" colorKey="color">
                  <Pie.Chart />
                </PolarChart>
              </View>
              {chartData.map((c) => (
                <View key={c.label} className="flex-row items-center justify-between py-2 border-b border-slate-50">
                  <View className="flex-row items-center gap-2">
                    <View style={{ width: 10, height: 10, borderRadius: 5, backgroundColor: c.color }} />
                    <Text className="text-sm font-semibold text-slate-700">{c.label}</Text>
                  </View>
                  <Text className="text-sm font-bold text-slate-800">
                    {t('routeResult.budgetExact', { amount: c.value.toLocaleString() })}
                  </Text>
                </View>
              ))}
            </>
          ) : (
            <Text className="text-slate-300 text-sm text-center mt-8">{t('budget.noExpensesYet')}</Text>
          )}

          <View className="h-10" />
        </ScrollView>
      )}
    </SafeAreaView>
  );
}
