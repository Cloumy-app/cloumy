import { useState } from 'react';
import { ActivityIndicator, Alert, FlatList, Text, TextInput, TouchableOpacity, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useTranslation } from 'react-i18next';
import { router, useLocalSearchParams } from 'expo-router';
import { ChevronLeft, Plus, Trash2 } from 'lucide-react-native';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { createBudget, deleteExpense, getBudgetSummary, getExpenses, updateBudgetRatios } from '@/lib/api/budget';
import { getRoute } from '@/lib/api/routes';
import { CategoryRatioSliders } from '@/components/route/CategoryRatioSliders';
import { ReceiptEdge } from '@/components/route/ReceiptEdge';
import { BUDGET_COLORS, EXPENSE_CATEGORY_COLORS, RECEIPT_LABEL, TABULAR_NUMS } from '@/lib/constants/budgetTheme';

export default function BudgetScreen() {
  const { t } = useTranslation();
  const { routeId } = useLocalSearchParams<{ routeId: string }>();
  const queryClient = useQueryClient();
  const [deletingId, setDeletingId] = useState<string | null>(null);
  const [totalBudgetInput, setTotalBudgetInput] = useState('');
  const [creatingBudget, setCreatingBudget] = useState(false);

  const { data: summary, isLoading: loadingSummary } = useQuery({
    queryKey: ['budget', routeId],
    queryFn: () => getBudgetSummary(routeId),
  });
  const { data: expenses } = useQuery({
    queryKey: ['expenses', routeId],
    queryFn: () => getExpenses(routeId),
  });
  const { data: route } = useQuery({
    queryKey: ['route', routeId],
    queryFn: () => getRoute(routeId),
  });

  const isTripOver = route ? new Date(route.endDate) < new Date() : false;

  const handleSaveRatios = async (ratios: {
    food: number; transport: number; activity: number; etc: number;
  }) => {
    try {
      await updateBudgetRatios(routeId, {
        foodRatio: ratios.food,
        transportRatio: ratios.transport,
        activityRatio: ratios.activity,
        etcRatio: ratios.etc,
      });
      queryClient.invalidateQueries({ queryKey: ['budget', routeId] });
    } catch (e) {
      console.error('[budget] updateBudgetRatios 실패:', e);
      Alert.alert(t('budget.saveFailedTitle'), t('budget.saveFailedBody'));
    }
  };

  const handleCreateBudget = async () => {
    const totalBudget = Number(totalBudgetInput);
    if (!totalBudgetInput || Number.isNaN(totalBudget) || totalBudget <= 0) {
      Alert.alert(t('budget.amountRequiredTitle'), t('budget.amountRequiredBody'));
      return;
    }

    setCreatingBudget(true);
    try {
      await createBudget(routeId, totalBudget);
      setTotalBudgetInput('');
      queryClient.invalidateQueries({ queryKey: ['budget', routeId] });
    } catch (e) {
      if (e instanceof Error && e.message === '409') {
        queryClient.invalidateQueries({ queryKey: ['budget', routeId] });
      } else {
        console.error('[budget] createBudget 실패:', e);
        Alert.alert(t('budget.createFailedTitle'), t('budget.createFailedBody'));
      }
    } finally {
      setCreatingBudget(false);
    }
  };

  const handleDelete = async (expenseId: string) => {
    setDeletingId(expenseId);
    try {
      await deleteExpense(routeId, expenseId);
      queryClient.invalidateQueries({ queryKey: ['expenses', routeId] });
      queryClient.invalidateQueries({ queryKey: ['budget', routeId] });
    } catch (e) {
      console.error('[budget] deleteExpense 실패:', e);
      Alert.alert(t('budget.deleteFailedTitle'), t('budget.deleteFailedBody'));
    } finally {
      setDeletingId(null);
    }
  };

  if (loadingSummary) {
    return (
      <SafeAreaView
        className="flex-1 items-center justify-center"
        style={{ backgroundColor: BUDGET_COLORS.screenBg }}
      >
        <ActivityIndicator color={BUDGET_COLORS.ledgerGreen} />
      </SafeAreaView>
    );
  }

  return (
    <SafeAreaView className="flex-1" edges={['top']} style={{ backgroundColor: BUDGET_COLORS.screenBg }}>
      <View
        className="flex-row items-center px-5 py-3 border-b"
        style={{ backgroundColor: BUDGET_COLORS.paper, borderColor: BUDGET_COLORS.perforation }}
      >
        <TouchableOpacity onPress={() => router.back()} className="mr-3">
          <ChevronLeft size={24} color={BUDGET_COLORS.ink} />
        </TouchableOpacity>
        <Text className="text-lg font-bold" style={{ color: BUDGET_COLORS.ink }}>{t('budget.headerTitle')}</Text>
      </View>

      <FlatList
        data={expenses ?? []}
        keyExtractor={(item) => item.id}
        keyboardShouldPersistTaps="handled"
        contentContainerStyle={{ padding: 20, paddingBottom: 100 }}
        ListHeaderComponent={
          <View className="mb-5">
            {!summary || summary.totalBudget == null ? (
              <View>
                <View
                  className="rounded-t-2xl p-4"
                  style={{ backgroundColor: BUDGET_COLORS.paper }}
                >
                  <Text className="text-xs mb-3" style={{ color: BUDGET_COLORS.ink }}>
                    {t('budget.noBudgetSet')}
                  </Text>
                  <View
                    className="flex-row items-center rounded-2xl px-4 mb-3 border"
                    style={{ borderColor: BUDGET_COLORS.perforation, backgroundColor: '#fff' }}
                  >
                    <Text className="text-base font-bold mr-1" style={{ color: BUDGET_COLORS.ledgerGreen }}>₩</Text>
                    <TextInput
                      value={totalBudgetInput}
                      onChangeText={(text) => setTotalBudgetInput(text.replace(/[^0-9]/g, ''))}
                      placeholder={t('budget.setBudgetPlaceholder')}
                      keyboardType="number-pad"
                      className="flex-1 py-3 px-2 text-base font-bold"
                      style={{ color: BUDGET_COLORS.ink, ...TABULAR_NUMS }}
                      placeholderTextColor="#B5AA92"
                    />
                    <Text className="text-sm" style={{ color: BUDGET_COLORS.ink }}>{t('routeCreateStep3.currencyWon')}</Text>
                  </View>
                  <TouchableOpacity
                    onPress={handleCreateBudget}
                    disabled={creatingBudget}
                    className="py-3 rounded-2xl items-center"
                    style={{ backgroundColor: BUDGET_COLORS.ledgerGreen }}
                    activeOpacity={0.9}
                  >
                    {creatingBudget ? (
                      <ActivityIndicator color="#fff" />
                    ) : (
                      <Text className="text-white font-bold text-sm">{t('budget.setBudgetButton')}</Text>
                    )}
                  </TouchableOpacity>
                </View>
                <ReceiptEdge notchColor={BUDGET_COLORS.screenBg} />
              </View>
            ) : (
              <>
                <View>
                  <View className="rounded-t-2xl p-5" style={{ backgroundColor: BUDGET_COLORS.paper }}>
                    <Text className="text-[11px] font-bold mb-1" style={{ color: BUDGET_COLORS.ink, ...RECEIPT_LABEL }}>
                      {t('budget.totalBudget')}
                    </Text>
                    <Text
                      className="text-3xl font-black mb-4"
                      style={{ color: BUDGET_COLORS.ink, ...TABULAR_NUMS }}
                    >
                      {t('routeResult.budgetExact', { amount: summary.totalBudget.toLocaleString() })}
                    </Text>

                    <View
                      className="border-t border-dashed mb-4"
                      style={{ borderColor: BUDGET_COLORS.perforation }}
                    />

                    <View className="flex-row justify-between mb-4">
                      <View>
                        <Text className="text-[10px] font-bold mb-1" style={{ color: '#9C8F73', ...RECEIPT_LABEL }}>
                          {t('budget.plannedExpense')}
                        </Text>
                        <Text className="text-sm font-bold" style={{ color: BUDGET_COLORS.ink, ...TABULAR_NUMS }}>
                          {t('routeResult.budgetExact', { amount: summary.plannedTotal.toLocaleString() })}
                        </Text>
                      </View>
                      <View>
                        <Text className="text-[10px] font-bold mb-1" style={{ color: '#9C8F73', ...RECEIPT_LABEL }}>
                          {t('budget.unplannedExpense')}
                        </Text>
                        <Text className="text-sm font-bold" style={{ color: BUDGET_COLORS.ink, ...TABULAR_NUMS }}>
                          {t('routeResult.budgetExact', { amount: summary.unplannedTotal.toLocaleString() })}
                        </Text>
                      </View>
                      <View>
                        <Text className="text-[10px] font-bold mb-1" style={{ color: '#9C8F73', ...RECEIPT_LABEL }}>
                          {t('budget.remaining')}
                        </Text>
                        <Text
                          className="text-sm font-bold"
                          style={{
                            color: (summary.remaining ?? 0) < 0 ? BUDGET_COLORS.rust : BUDGET_COLORS.ledgerGreen,
                            ...TABULAR_NUMS,
                          }}
                        >
                          {t('routeResult.budgetExact', { amount: (summary.remaining ?? 0).toLocaleString() })}
                        </Text>
                      </View>
                    </View>

                    <View
                      className="border-t border-dashed mb-3"
                      style={{ borderColor: BUDGET_COLORS.perforation }}
                    />

                    {/* 잔여 예산 게이지 — 초록에서 러스트로, 소진될수록 경고색에 가까워짐 */}
                    <View className="h-2.5 rounded-full overflow-hidden" style={{ backgroundColor: BUDGET_COLORS.perforation }}>
                      <View
                        className="h-full rounded-full"
                        style={{
                          width: `${Math.min(100, Math.round(((summary.plannedTotal + summary.unplannedTotal) / Math.max(summary.totalBudget, 1)) * 100))}%`,
                          backgroundColor: (summary.remaining ?? 0) < 0 ? BUDGET_COLORS.rust : BUDGET_COLORS.ledgerGreen,
                        }}
                      />
                    </View>
                  </View>
                  <ReceiptEdge notchColor={BUDGET_COLORS.screenBg} />
                </View>

                {isTripOver && (
                  <TouchableOpacity
                    onPress={() => router.push({ pathname: '/route/[routeId]/budget/report', params: { routeId } })}
                    className="rounded-2xl p-4 mt-4 mb-4 items-center border"
                    style={{ backgroundColor: BUDGET_COLORS.paper, borderColor: BUDGET_COLORS.perforation }}
                    activeOpacity={0.8}
                  >
                    <Text className="font-bold text-sm" style={{ color: BUDGET_COLORS.ledgerGreen }}>{t('budget.viewReport')}</Text>
                  </TouchableOpacity>
                )}

                <Text
                  className="text-xs font-bold mb-3 mt-6"
                  style={{ color: BUDGET_COLORS.ink, ...RECEIPT_LABEL }}
                >
                  {t('budget.categoryRatio')}
                </Text>
                <CategoryRatioSliders
                  initial={{
                    food: summary.foodRatio ?? 0,
                    transport: summary.transportRatio ?? 0,
                    activity: summary.activityRatio ?? 0,
                    etc: summary.etcRatio ?? 0,
                  }}
                  onSave={handleSaveRatios}
                />
              </>
            )}

            <View className="flex-row justify-between items-center mt-6 mb-2">
              <Text className="text-xs font-bold" style={{ color: BUDGET_COLORS.ink, ...RECEIPT_LABEL }}>
                {t('budget.unplannedExpense')}
              </Text>
              <TouchableOpacity
                onPress={() => router.push({ pathname: '/route/[routeId]/budget/add-expense', params: { routeId } })}
                className="flex-row items-center gap-1 px-3 py-1.5 rounded-full"
                style={{ backgroundColor: BUDGET_COLORS.ledgerGreen }}
                activeOpacity={0.85}
              >
                <Plus size={14} color="#fff" />
                <Text className="text-white text-xs font-bold">{t('budget.addButton')}</Text>
              </TouchableOpacity>
            </View>
          </View>
        }
        ListEmptyComponent={
          <Text className="text-sm text-center mt-4" style={{ color: '#B5AA92' }}>{t('budget.noExpensesYet')}</Text>
        }
        renderItem={({ item }) => (
          <View
            className="flex-row items-center justify-between px-4 py-3 mb-0 border-b border-dashed"
            style={{ backgroundColor: BUDGET_COLORS.paper, borderColor: BUDGET_COLORS.perforation }}
          >
            <View className="flex-1">
              <Text
                className="text-[10px] font-bold mb-1"
                style={{ color: EXPENSE_CATEGORY_COLORS[item.category], ...RECEIPT_LABEL }}
              >
                {t(`budgetAddExpense.categories.${item.category.toLowerCase()}`)}
              </Text>
              <Text className="text-sm font-bold" style={{ color: BUDGET_COLORS.ink, ...TABULAR_NUMS }}>
                {t('routeResult.budgetExact', { amount: item.actualAmount.toLocaleString() })}
              </Text>
              {item.memo && <Text className="text-xs mt-0.5" style={{ color: '#9C8F73' }}>{item.memo}</Text>}
            </View>
            <TouchableOpacity onPress={() => handleDelete(item.id)} disabled={deletingId === item.id} hitSlop={8}>
              {deletingId === item.id ? (
                <ActivityIndicator size="small" color={BUDGET_COLORS.rust} />
              ) : (
                <Trash2 size={16} color={BUDGET_COLORS.rust} />
              )}
            </TouchableOpacity>
          </View>
        )}
      />
    </SafeAreaView>
  );
}
