import { useState } from 'react';
import { ActivityIndicator, Alert, ScrollView, Text, TextInput, TouchableOpacity, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useTranslation } from 'react-i18next';
import { router, useLocalSearchParams } from 'expo-router';
import { X } from 'lucide-react-native';
import { useQueryClient } from '@tanstack/react-query';
import { addExpense } from '@/lib/api/budget';
import type { ExpenseCategory } from '@/types';

const CATEGORIES: ExpenseCategory[] = ['FOOD', 'TRANSPORT', 'ADMISSION', 'SOUVENIR', 'ETC'];

export default function AddExpenseScreen() {
  const { t } = useTranslation();
  const { routeId } = useLocalSearchParams<{ routeId: string }>();
  const queryClient = useQueryClient();

  const [category, setCategory] = useState<ExpenseCategory>('FOOD');
  const [amount, setAmount] = useState('');
  const [memo, setMemo] = useState('');
  const [submitting, setSubmitting] = useState(false);

  const handleSubmit = async () => {
    const actualAmount = Number(amount);
    if (!amount || Number.isNaN(actualAmount) || actualAmount < 0) {
      Alert.alert(t('budgetAddExpense.amountRequiredTitle'), t('budgetAddExpense.amountRequiredBody'));
      return;
    }

    setSubmitting(true);
    try {
      await addExpense(routeId, { category, actualAmount, memo: memo.trim() || undefined });
      queryClient.invalidateQueries({ queryKey: ['expenses', routeId] });
      queryClient.invalidateQueries({ queryKey: ['budget', routeId] });
      router.back();
    } catch (e) {
      console.error('[budget] addExpense 실패:', e);
      Alert.alert(t('budgetAddExpense.addFailedTitle'), t('budgetAddExpense.addFailedBody'));
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <SafeAreaView className="flex-1 bg-white">
      <View className="flex-row items-center justify-between px-5 py-3 border-b border-slate-100">
        <Text className="text-lg font-bold text-slate-800">{t('budgetAddExpense.headerTitle')}</Text>
        <TouchableOpacity onPress={() => router.back()} hitSlop={8}>
          <X size={22} color="#475569" />
        </TouchableOpacity>
      </View>

      <ScrollView className="flex-1 px-6 pt-6" keyboardShouldPersistTaps="handled">
        <Text className="font-bold text-slate-700 mb-3">{t('budgetAddExpense.categoryLabel')}</Text>
        <View className="flex-row flex-wrap gap-2 mb-6">
          {CATEGORIES.map((c) => {
            const selected = category === c;
            return (
              <TouchableOpacity
                key={c}
                onPress={() => setCategory(c)}
                className={`px-4 py-2 rounded-full border-2 ${
                  selected ? 'border-sky-500 bg-sky-50' : 'border-slate-200 bg-white'
                }`}
                activeOpacity={0.8}
              >
                <Text className={`text-sm font-bold ${selected ? 'text-sky-700' : 'text-slate-600'}`}>
                  {t(`budgetAddExpense.categories.${c.toLowerCase()}`)}
                </Text>
              </TouchableOpacity>
            );
          })}
        </View>

        <Text className="font-bold text-slate-700 mb-3">{t('budgetAddExpense.amountLabel')}</Text>
        <View className="flex-row items-center bg-slate-50 border-2 border-slate-200 rounded-2xl px-4 mb-6">
          <TextInput
            value={amount}
            onChangeText={(text) => setAmount(text.replace(/[^0-9]/g, ''))}
            placeholder={t('budgetAddExpense.amountPlaceholder')}
            keyboardType="number-pad"
            className="flex-1 py-3 px-2 text-sm text-slate-700"
          />
          <Text className="text-slate-400 text-sm">{t('routeCreateStep3.currencyWon')}</Text>
        </View>

        <Text className="font-bold text-slate-700 mb-3">{t('budgetAddExpense.memoLabel')}</Text>
        <TextInput
          value={memo}
          onChangeText={setMemo}
          placeholder={t('budgetAddExpense.memoPlaceholder')}
          className="bg-slate-50 border-2 border-slate-200 rounded-2xl px-4 py-3 text-sm text-slate-700 mb-6"
        />
      </ScrollView>

      <View className="px-6 pb-8">
        <TouchableOpacity
          onPress={handleSubmit}
          disabled={submitting}
          className="bg-sky-500 py-4 rounded-2xl items-center"
          activeOpacity={0.9}
        >
          {submitting ? <ActivityIndicator color="#fff" /> : <Text className="text-white font-bold text-base">{t('budgetAddExpense.submitButton')}</Text>}
        </TouchableOpacity>
      </View>
    </SafeAreaView>
  );
}
