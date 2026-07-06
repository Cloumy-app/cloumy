import { useState } from 'react';
import { ActivityIndicator, Alert, FlatList, Text, TouchableOpacity, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { router, useLocalSearchParams } from 'expo-router';
import { ChevronLeft, Plus, Trash2 } from 'lucide-react-native';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { deleteExpense, getBudgetSummary, getExpenses, updateBudgetRatios } from '@/lib/api/budget';
import { getRoute } from '@/lib/api/routes';
import { CategoryRatioSliders } from '@/components/route/CategoryRatioSliders';

export default function BudgetScreen() {
  const { routeId } = useLocalSearchParams<{ routeId: string }>();
  const queryClient = useQueryClient();
  const [deletingId, setDeletingId] = useState<string | null>(null);

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
      Alert.alert('저장 실패', '비율 저장에 실패했어요. 잠시 후 다시 시도해주세요.');
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
      Alert.alert('삭제 실패', '지출 삭제에 실패했어요. 잠시 후 다시 시도해주세요.');
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
        <Text className="text-lg font-bold text-slate-800">예산 관리</Text>
      </View>

      <FlatList
        data={expenses ?? []}
        keyExtractor={(item) => item.id}
        contentContainerStyle={{ padding: 20, paddingBottom: 100 }}
        ListHeaderComponent={
          <View className="mb-5">
            {!summary || summary.totalBudget === null ? (
              <View className="bg-slate-50 rounded-2xl p-4 mb-5">
                <Text className="text-sm text-slate-500 text-center">
                  이 루트는 예산이 설정되지 않았어요.{'\n'}루트 생성 시 총예산을 입력하면 여기서 관리할 수 있어요.
                </Text>
              </View>
            ) : (
              <>
                <View className="bg-white border border-slate-100 rounded-2xl p-4 mb-4">
                  <Text className="text-xs font-bold text-slate-500 mb-2">총예산</Text>
                  <Text className="text-2xl font-black text-slate-800 mb-3">
                    {summary.totalBudget.toLocaleString()}원
                  </Text>
                  <View className="flex-row justify-between">
                    <View>
                      <Text className="text-xs text-slate-400">계획 지출</Text>
                      <Text className="text-sm font-bold text-slate-700">{summary.plannedTotal.toLocaleString()}원</Text>
                    </View>
                    <View>
                      <Text className="text-xs text-slate-400">비계획 지출</Text>
                      <Text className="text-sm font-bold text-slate-700">{summary.unplannedTotal.toLocaleString()}원</Text>
                    </View>
                    <View>
                      <Text className="text-xs text-slate-400">잔여</Text>
                      <Text className={`text-sm font-bold ${(summary.remaining ?? 0) < 0 ? 'text-rose-500' : 'text-sky-600'}`}>
                        {(summary.remaining ?? 0).toLocaleString()}원
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
                    <Text className="text-sky-600 font-bold text-sm">여행 지출 리포트 보기</Text>
                  </TouchableOpacity>
                )}

                <Text className="font-bold text-slate-700 mb-3">카테고리 비율</Text>
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
              <Text className="font-bold text-slate-700">비계획 지출</Text>
              <TouchableOpacity
                onPress={() => router.push({ pathname: '/route/[routeId]/budget/add-expense', params: { routeId } })}
                className="flex-row items-center gap-1 bg-sky-500 px-3 py-1.5 rounded-full"
                activeOpacity={0.85}
              >
                <Plus size={14} color="#fff" />
                <Text className="text-white text-xs font-bold">추가</Text>
              </TouchableOpacity>
            </View>
          </View>
        }
        ListEmptyComponent={
          <Text className="text-slate-300 text-sm text-center mt-4">아직 기록된 지출이 없어요</Text>
        }
        renderItem={({ item }) => (
          <View className="flex-row items-center justify-between bg-white border border-slate-100 rounded-xl px-4 py-3 mb-2">
            <View className="flex-1">
              <Text className="text-xs font-bold text-sky-600">{item.category}</Text>
              <Text className="text-sm font-bold text-slate-800">{item.actualAmount.toLocaleString()}원</Text>
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
