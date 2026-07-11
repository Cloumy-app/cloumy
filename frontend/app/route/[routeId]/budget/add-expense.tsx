import { useState } from 'react';
import { ActivityIndicator, Alert, ScrollView, Text, TextInput, TouchableOpacity, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useTranslation } from 'react-i18next';
import { router, useLocalSearchParams } from 'expo-router';
import { X, Utensils, Bus, Ticket, Gift, MoreHorizontal } from 'lucide-react-native';
import { useQueryClient } from '@tanstack/react-query';
import { addExpense } from '@/lib/api/budget';
import type { ExpenseCategory } from '@/types';
import { BUDGET_COLORS, EXPENSE_CATEGORY_COLORS, RECEIPT_LABEL, TABULAR_NUMS } from '@/lib/constants/budgetTheme';

const CATEGORIES: ExpenseCategory[] = ['FOOD', 'TRANSPORT', 'ADMISSION', 'SOUVENIR', 'ETC'];
const CATEGORY_ICONS: Record<ExpenseCategory, typeof Utensils> = {
  FOOD: Utensils,
  TRANSPORT: Bus,
  ADMISSION: Ticket,
  SOUVENIR: Gift,
  ETC: MoreHorizontal,
};

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
    <SafeAreaView className="flex-1" style={{ backgroundColor: BUDGET_COLORS.screenBg }}>
      <View
        className="flex-row items-center justify-between px-5 py-3 border-b"
        style={{ backgroundColor: BUDGET_COLORS.paper, borderColor: BUDGET_COLORS.perforation }}
      >
        <Text className="text-lg font-bold" style={{ color: BUDGET_COLORS.ink }}>{t('budgetAddExpense.headerTitle')}</Text>
        <TouchableOpacity onPress={() => router.back()} hitSlop={8}>
          <X size={22} color={BUDGET_COLORS.ink} />
        </TouchableOpacity>
      </View>

      <ScrollView className="flex-1 px-6 pt-6" keyboardShouldPersistTaps="handled">
        <Text className="text-xs font-bold mb-3" style={{ color: BUDGET_COLORS.ink, ...RECEIPT_LABEL }}>
          {t('budgetAddExpense.categoryLabel')}
        </Text>
        <View className="flex-row flex-wrap gap-2 mb-6">
          {CATEGORIES.map((c) => {
            const selected = category === c;
            const color = EXPENSE_CATEGORY_COLORS[c];
            const Icon = CATEGORY_ICONS[c];
            return (
              <TouchableOpacity
                key={c}
                onPress={() => setCategory(c)}
                className="flex-row items-center gap-1.5 px-4 py-2 rounded-full border-2"
                style={{
                  borderColor: selected ? color : BUDGET_COLORS.perforation,
                  backgroundColor: selected ? `${color}1A` : '#fff',
                }}
                activeOpacity={0.8}
              >
                <Icon size={14} color={selected ? color : '#9C8F73'} />
                <Text className="text-sm font-bold" style={{ color: selected ? color : '#7A6F58' }}>
                  {t(`budgetAddExpense.categories.${c.toLowerCase()}`)}
                </Text>
              </TouchableOpacity>
            );
          })}
        </View>

        <Text className="text-xs font-bold mb-3" style={{ color: BUDGET_COLORS.ink, ...RECEIPT_LABEL }}>
          {t('budgetAddExpense.amountLabel')}
        </Text>
        <View
          className="flex-row items-center rounded-2xl px-4 mb-6 border"
          style={{ backgroundColor: BUDGET_COLORS.paper, borderColor: BUDGET_COLORS.perforation }}
        >
          <Text className="text-lg font-bold mr-1" style={{ color: BUDGET_COLORS.ledgerGreen }}>₩</Text>
          <TextInput
            value={amount}
            onChangeText={(text) => setAmount(text.replace(/[^0-9]/g, ''))}
            placeholder={t('budgetAddExpense.amountPlaceholder')}
            keyboardType="number-pad"
            className="flex-1 py-3 px-2 text-lg font-bold"
            style={{ color: BUDGET_COLORS.ink, ...TABULAR_NUMS }}
            placeholderTextColor="#B5AA92"
          />
        </View>

        <Text className="text-xs font-bold mb-3" style={{ color: BUDGET_COLORS.ink, ...RECEIPT_LABEL }}>
          {t('budgetAddExpense.memoLabel')}
        </Text>
        <TextInput
          value={memo}
          onChangeText={setMemo}
          placeholder={t('budgetAddExpense.memoPlaceholder')}
          className="rounded-2xl px-4 py-3 text-sm mb-6 border"
          style={{ backgroundColor: BUDGET_COLORS.paper, borderColor: BUDGET_COLORS.perforation, color: BUDGET_COLORS.ink }}
          placeholderTextColor="#B5AA92"
        />
      </ScrollView>

      <View className="px-6 pb-8">
        <TouchableOpacity
          onPress={handleSubmit}
          disabled={submitting}
          className="py-4 rounded-2xl items-center"
          style={{ backgroundColor: BUDGET_COLORS.ledgerGreen }}
          activeOpacity={0.9}
        >
          {submitting ? <ActivityIndicator color="#fff" /> : <Text className="text-white font-bold text-base">{t('budgetAddExpense.submitButton')}</Text>}
        </TouchableOpacity>
      </View>
    </SafeAreaView>
  );
}
