import { useMemo, useState } from 'react';
import { Modal, View, Text, TouchableOpacity, ActivityIndicator, Pressable } from 'react-native';
import { useTranslation } from 'react-i18next';
import { useQuery } from '@tanstack/react-query';
import { X } from 'lucide-react-native';
import { getRouteSlots } from '@/lib/api/routes';
import type { ChatInsertion, SlotWithCoords } from '@/types';

interface InsertPlaceSheetProps {
  placeName: string;
  routeId: string;
  // 없으면(FFE #11, 구버전 서버) Day 미선택 상태로 시작한다 — 죽은 카드로 되돌리지 않는다.
  insertion?: ChatInsertion;
  // 여행 박수(nights) — 있으면 dayCount = nights + 1. 없을 때만 슬롯 캐시로 폴백한다.
  nights?: number;
  loading?: boolean;
  onConfirm: (afterSlotId: string | null, dayNumber: number) => void;
  onCancel: () => void;
}

// 그 Day의 마지막 슬롯 id를 앵커로 계산한다. 슬롯이 없으면 null(맨 앞 삽입, FFE #5와 동일 규칙).
function lastSlotIdOfDay(slots: SlotWithCoords[] | undefined, day: number): string | null {
  const daySlots = (slots ?? []).filter((s) => s.dayNumber === day);
  if (daySlots.length === 0) return null;
  return daySlots.reduce((max, s) => (s.orderIndex > max.orderIndex ? s : max)).id;
}

// "며칠차에 넣을까요?" 확인 시트 — DayPickerConfirm(가져오기/북마크 탭)과 같은 성격의 UI지만,
// 그 컴포넌트는 탭 전체를 대체하는 풀스크린형이라 챗 화면 위에 얹을 수 없다. 여기선 서버가
// 이미 제안한 자리(insertion)를 먼저 보여주고, Day 칩으로 재조정할 수 있게 Modal로 새로 만든다.
export function InsertPlaceSheet({
  placeName,
  routeId,
  insertion,
  nights,
  loading = false,
  onConfirm,
  onCancel,
}: InsertPlaceSheetProps) {
  const { t } = useTranslation();

  // 슬롯 캐시 — ①장소명 조회(문구 조립용) ②Day 개수 폴백(nights 없을 때) 양쪽에 쓴다.
  // 루트 상세 화면과 동일한 쿼리 키를 써서 캐시를 공유한다.
  const { data: slots } = useQuery({
    queryKey: ['route-slots', routeId],
    queryFn: () => getRouteSlots(routeId),
    staleTime: 1000 * 60 * 5,
  });

  // nights를 못 구한 경우에만 슬롯의 최대 dayNumber로 폴백 — 슬롯이 하나도 없으면 최소 1일차는 있다.
  const fallbackDayCount = useMemo(() => {
    if (!slots || slots.length === 0) return 1;
    return Math.max(...slots.map((s) => s.dayNumber));
  }, [slots]);
  const dayCount = nights != null ? nights + 1 : fallbackDayCount;

  const [selectedDay, setSelectedDay] = useState<number | null>(insertion?.day ?? null);
  const [selectedAfterSlotId, setSelectedAfterSlotId] = useState<string | null | undefined>(
    insertion?.afterSlotId,
  );

  const onPickDay = (day: number) => {
    setSelectedDay(day);
    // 다른 Day를 고르면 그 Day 맨 뒤로 앵커를 다시 계산한다 — "어느 장소 뒤" 세밀 선택은
    // 범위 밖이라(요청 참고) Day 단위로만 재조정한다.
    setSelectedAfterSlotId(lastSlotIdOfDay(slots, day));
  };

  // 사용자가 아직 서버 제안을 건드리지 않았을 때만 conversation/estimated 문구를 쓴다.
  // Day를 바꾸면 곧바로 "그 Day 마지막" 문구로 넘어간다 — 재계산된 자리는 더 이상
  // "말씀하신 자리"나 "지금 계신 자리"가 아니기 때문이다.
  const isOriginalProposal =
    !!insertion && selectedDay === insertion.day && selectedAfterSlotId === insertion.afterSlotId;
  const anchorSlotName =
    selectedAfterSlotId != null ? slots?.find((s) => s.id === selectedAfterSlotId)?.placeName : undefined;

  let bodyText: string;
  if (selectedDay === null) {
    bodyText = t('chat.insertSheet.pickDayPrompt', { name: placeName });
  } else if (selectedAfterSlotId == null) {
    bodyText = t('chat.insertSheet.dayFront', { day: selectedDay });
  } else if (isOriginalProposal && insertion?.source === 'conversation' && anchorSlotName) {
    bodyText = t('chat.insertSheet.conversationAfter', { name: anchorSlotName });
  } else if (isOriginalProposal && insertion?.source === 'estimated' && anchorSlotName) {
    bodyText = t('chat.insertSheet.estimatedAfter', { name: anchorSlotName });
  } else {
    bodyText = t('chat.insertSheet.defaultEnd', { day: selectedDay });
  }

  return (
    <Modal transparent animationType="slide" visible onRequestClose={onCancel}>
      <Pressable className="flex-1 bg-black/40 justify-end" onPress={onCancel}>
        <Pressable onPress={(e) => e.stopPropagation()}>
          <View className="bg-white rounded-t-3xl px-5 pt-5 pb-8">
            <View className="flex-row items-start justify-between mb-4">
              <View className="flex-1 mr-2">
                <Text className="font-bold text-slate-800 text-sm mb-1">{placeName}</Text>
                <Text className="text-sm text-slate-600">{bodyText}</Text>
              </View>
              <TouchableOpacity onPress={onCancel} disabled={loading} hitSlop={8}>
                <X size={20} color="#64748b" />
              </TouchableOpacity>
            </View>

            <View className="flex-row flex-wrap gap-1.5 mb-5">
              {Array.from({ length: dayCount }, (_, i) => i + 1).map((d) => (
                <TouchableOpacity
                  key={d}
                  onPress={() => onPickDay(d)}
                  disabled={loading}
                  className={`px-3 py-1.5 rounded-full border ${
                    selectedDay === d ? 'border-sky-500 bg-sky-50' : 'border-slate-200'
                  }`}
                >
                  <Text className={`text-xs font-bold ${selectedDay === d ? 'text-sky-600' : 'text-slate-400'}`}>
                    {t('chat.insertSheet.dayChip', { day: d })}
                  </Text>
                </TouchableOpacity>
              ))}
            </View>

            <View className="flex-row gap-2">
              <TouchableOpacity
                onPress={onCancel}
                disabled={loading}
                className="flex-1 py-3 rounded-2xl items-center border border-slate-200"
              >
                <Text className="font-bold text-slate-500 text-sm">{t('chat.insertSheet.cancelButton')}</Text>
              </TouchableOpacity>
              <TouchableOpacity
                onPress={() => selectedDay !== null && onConfirm(selectedAfterSlotId ?? null, selectedDay)}
                disabled={loading || selectedDay === null}
                className={`flex-1 py-3 rounded-2xl items-center ${
                  selectedDay === null ? 'bg-slate-200' : 'bg-sky-500'
                }`}
              >
                {loading ? (
                  <ActivityIndicator size="small" color="#ffffff" />
                ) : (
                  <Text className="font-bold text-white text-sm">{t('chat.insertSheet.confirmButton')}</Text>
                )}
              </TouchableOpacity>
            </View>
          </View>
        </Pressable>
      </Pressable>
    </Modal>
  );
}
