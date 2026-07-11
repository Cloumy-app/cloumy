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
      <SafeAreaView className="flex-1 bg-white items-center justify-center">
        <ActivityIndicator color="#0ea5e9" />
      </SafeAreaView>
    );
  }

  return (
    <SafeAreaView className="flex-1 bg-white" edges={['top']}>
      <View className="flex-row items-center px-5 py-3 border-b border-slate-100">
        <TouchableOpacity onPress={() => router.back()} className="mr-3">
          <ChevronLeft size={24} color="#475569" />
        </TouchableOpacity>
        <Text className="text-lg font-bold text-slate-800">{t('budget.headerTitle')}</Text>
      </View>

      <FlatList
        data={expenses ?? []}
        keyExtractor={(item) => item.id}
        keyboardShouldPersistTaps="handled"
        contentContainerStyle={{ padding: 20, paddingBottom: 100 }}
        ListHeaderComponent={
          <View className="mb-5">
            {!summary || summary.totalBudget == null ? (
              <View className="bg-slate-50 rounded-2xl p-4 mb-5">
                <Text className="text-sm text-slate-500 mb-3">
                  {t('budget.noBudgetSet')}
                </Text>
                <View className="flex-row items-center bg-white border-2 border-slate-200 rounded-2xl px-4 mb-3">
                  <TextInput
                    value={totalBudgetInput}
                    onChangeText={(text) => setTotalBudgetInput(text.replace(/[^0-9]/g, ''))}
                    placeholder={t('budget.setBudgetPlaceholder')}
                    keyboardType="number-pad"
                    className="flex-1 py-3 px-2 text-sm text-slate-700"
                  />
                  <Text className="text-slate-400 text-sm">{t('routeCreateStep3.currencyWon')}</Text>
                </View>
                <TouchableOpacity
                  onPress={handleCreateBudget}
                  disabled={creatingBudget}
                  className="bg-sky-500 py-3 rounded-2xl items-center"
                  activeOpacity={0.9}
                >
                  {creatingBudget ? (
                    <ActivityIndicator color="#fff" />
                  ) : (
                    <Text className="text-white font-bold text-sm">{t('budget.setBudgetButton')}</Text>
                  )}
                </TouchableOpacity>
              </View>
            ) : (
              <>
                <View className="bg-white border border-slate-100 rounded-2xl p-4 mb-4">
                  <Text className="text-xs font-bold text-slate-500 mb-2">{t('budget.totalBudget')}</Text>
                  <Text className="text-2xl font-black text-slate-800 mb-3">
                    {t('routeResult.budgetExact', { amount: summary.totalBudget.toLocaleString() })}
                  </Text>
                  <View className="flex-row justify-between">
                    <View>
                      <Text className="text-xs text-slate-400">{t('budget.plannedExpense')}</Text>
                      <Text className="text-sm font-bold text-slate-700">
                        {t('routeResult.budgetExact', { amount: summary.plannedTotal.toLocaleString() })}
                      </Text>
                    </View>
                    <View>
                      <Text className="text-xs text-slate-400">{t('budget.unplannedExpense')}</Text>
                      <Text className="text-sm font-bold text-slate-700">
                        {t('routeResult.budgetExact', { amount: summary.unplannedTotal.toLocaleString() })}
                      </Text>
                    </View>
                    <View>
                      <Text className="text-xs text-slate-400">{t('budget.remaining')}</Text>
                      <Text className={`text-sm font-bold ${(summary.remaining ?? 0) < 0 ? 'text-rose-500' : 'text-sky-600'}`}>
                        {t('routeResult.budgetExact', { amount: (summary.remaining ?? 0).toLocaleString() })}
                      </Text>
                    </View>
                  </View>
                </View>

                {isTripOver && (
                  <TouchableOpacity
                    onPress={() => router.push({ pathname: '/route/[routeId]/budget/report', params: { routeId } })}
                    className="bg-sky-50 rounded-2xl p-4 mb-4 items-center"
                    activeOpacity={0.8}
                  >
                    <Text className="text-sky-600 font-bold text-sm">{t('budget.viewReport')}</Text>
                  </TouchableOpacity>
                )}

                <Text className="font-bold text-slate-700 mb-3">{t('budget.categoryRatio')}</Text>
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
              <Text className="font-bold text-slate-700">{t('budget.unplannedExpense')}</Text>
              <TouchableOpacity
                onPress={() => router.push({ pathname: '/route/[routeId]/budget/add-expense', params: { routeId } })}
                className="flex-row items-center gap-1 bg-sky-500 px-3 py-1.5 rounded-full"
                activeOpacity={0.85}
              >
                <Plus size={14} color="#fff" />
                <Text className="text-white text-xs font-bold">{t('budget.addButton')}</Text>
              </TouchableOpacity>
            </View>
          </View>
        }
        ListEmptyComponent={
          <Text className="text-slate-300 text-sm text-center mt-4">{t('budget.noExpensesYet')}</Text>
        }
        renderItem={({ item }) => (
          <View className="flex-row items-center justify-between bg-white border border-slate-100 rounded-xl px-4 py-3 mb-2">
            <View className="flex-1">
              <Text className="text-xs font-bold text-sky-600">
                {t(`budgetAddExpense.categories.${item.category.toLowerCase()}`)}
              </Text>
              <Text className="text-sm font-bold text-slate-800">
                {t('routeResult.budgetExact', { amount: item.actualAmount.toLocaleString() })}
              </Text>
              {item.memo && <Text className="text-xs text-slate-400 mt-0.5">{item.memo}</Text>}
            </View>
            <TouchableOpacity onPress={() => handleDelete(item.id)} disabled={deletingId === item.id} hitSlop={8}>
              {deletingId === item.id ? (
                <ActivityIndicator size="small" color="#f43f5e" />
              ) : (
                <Trash2 size={16} color="#f43f5e" />
              )}
            </TouchableOpacity>
          </View>
        )}
      />
    </SafeAreaView>
  );
}
