import { useState } from 'react';
import { View, Text, TouchableOpacity, ActivityIndicator } from 'react-native';
import { Lock, Unlock, RefreshCw, X, Check } from 'lucide-react-native';
import type { RouteSlot, SlotAlternative, SlotWithCoords } from '@/types';
import { getSlotAlternatives } from '@/lib/api/routes';

interface SlotCardProps {
  slot: RouteSlot | null;
  apiSlot?: SlotWithCoords;
  index: number;
  isLast: boolean;
  routeId?: string;
  onPin: () => void;
  onRemove: () => void;
  onReplaceWithAlternative?: (alt: SlotAlternative) => void;
  onTap?: () => void;
}

export function SlotCard({
  slot,
  apiSlot,
  index,
  isLast,
  routeId,
  onPin,
  onRemove,
  onReplaceWithAlternative,
  onTap,
}: SlotCardProps) {
  const [alternatives, setAlternatives] = useState<SlotAlternative[]>([]);
  const [loadingAlts, setLoadingAlts] = useState(false);
  const [showAlts, setShowAlts] = useState(false);

  const placeName = apiSlot?.placeName ?? slot?.place_name ?? '';
  const tip = apiSlot?.tips ?? slot?.tip ?? null;
  const duration = apiSlot?.durationMinutes ?? slot?.duration_minutes ?? null;
  const budget = apiSlot?.estimatedCost ?? slot?.budget_estimate ?? 0;
  const pinned = apiSlot?.pinned ?? slot?.isPinned ?? false;
  const dayLabel = apiSlot ? `Day ${apiSlot.dayNumber}` : slot ? `Day ${slot.day}` : '';
  const orderLabel = apiSlot ? `${apiSlot.orderIndex + 1}번째` : slot ? `${slot.order}번째` : '';

  const handleReshuffle = async () => {
    if (pinned || !routeId || !apiSlot) return;
    if (showAlts) {
      setShowAlts(false);
      setAlternatives([]);
      return;
    }
    setLoadingAlts(true);
    try {
      const alts = await getSlotAlternatives(routeId, apiSlot.id);
      setAlternatives(alts);
      setShowAlts(true);
    } finally {
      setLoadingAlts(false);
    }
  };

  const handleSelectAlternative = (alt: SlotAlternative) => {
    onReplaceWithAlternative?.(alt);
    setShowAlts(false);
    setAlternatives([]);
  };

  return (
    <View className="relative">
      {!isLast && (
        <View className="absolute left-[19px] top-12 bottom-[-16px] w-[2px] bg-slate-100 z-0" />
      )}

      <TouchableOpacity
        activeOpacity={onTap ? 0.75 : 1}
        onPress={onTap}
        className={`flex-row gap-3 p-4 rounded-2xl border-2 ${
          pinned ? 'border-sky-500 bg-blue-50/30' : 'border-transparent bg-slate-50'
        }`}
      >
        <View className="items-center">
          <View
            className={`w-10 h-10 rounded-full items-center justify-center z-10 ${
              pinned ? 'bg-sky-500' : 'bg-white border border-slate-200'
            }`}
          >
            <Text className={`font-black text-sm ${pinned ? 'text-white' : 'text-slate-500'}`}>
              {index + 1}
            </Text>
          </View>
        </View>

        <View className="flex-1 pt-1">
          <View className="flex-row justify-between items-start mb-1">
            <View className="flex-1 mr-2">
              <View
                className={`self-start px-2 py-0.5 rounded-md mb-1.5 ${
                  pinned ? 'bg-blue-100' : 'bg-slate-200'
                }`}
              >
                <Text className={`text-[10px] font-bold ${pinned ? 'text-blue-700' : 'text-slate-600'}`}>
                  {dayLabel} · {orderLabel}
                </Text>
              </View>
              <Text className={`font-bold leading-tight ${pinned ? 'text-blue-900' : 'text-slate-800'}`}>
                {placeName}
              </Text>
            </View>

            <View className="flex-row items-center gap-1 bg-white p-1 rounded-xl border border-slate-100">
              <TouchableOpacity
                onPress={onPin}
                className={`p-1.5 rounded-lg ${pinned ? 'bg-blue-100' : ''}`}
              >
                {pinned ? <Lock size={16} color="#2563eb" /> : <Unlock size={16} color="#94a3b8" />}
              </TouchableOpacity>
              <TouchableOpacity
                onPress={handleReshuffle}
                className={`p-1.5 rounded-lg ${showAlts ? 'bg-sky-100' : ''}`}
                disabled={pinned || !apiSlot || loadingAlts}
              >
                {loadingAlts ? (
                  <ActivityIndicator size={14} color="#0ea5e9" />
                ) : (
                  <RefreshCw size={16} color={pinned || !apiSlot ? '#94a3b8' : '#0ea5e9'} />
                )}
              </TouchableOpacity>
              <TouchableOpacity
                onPress={pinned ? undefined : onRemove}
                className={`p-1.5 rounded-lg ${pinned ? 'opacity-30' : ''}`}
                disabled={pinned}
              >
                <X size={16} color={pinned ? '#94a3b8' : '#f43f5e'} />
              </TouchableOpacity>
            </View>
          </View>

          {tip ? (
            <Text className="text-xs text-slate-500 font-medium leading-relaxed" numberOfLines={2}>
              {tip}
            </Text>
          ) : null}

          <View className="flex-row gap-3 mt-2">
            {duration != null && <Text className="text-xs text-slate-400">⏱ {duration}분</Text>}
            {budget > 0 && (
              <Text className="text-xs text-slate-400">💰 {budget.toLocaleString()}원</Text>
            )}
          </View>

          {/* 대안 추천 인라인 패널 */}
          {showAlts && alternatives.length > 0 && (
            <View className="mt-3 gap-2">
              <Text className="text-xs font-bold text-slate-600 mb-1">대안 장소 추천</Text>
              {alternatives.map((alt, i) => (
                <TouchableOpacity
                  key={i}
                  onPress={() => handleSelectAlternative(alt)}
                  className="flex-row items-start gap-2 p-3 bg-white rounded-xl border border-sky-100"
                  activeOpacity={0.8}
                >
                  <View className="w-6 h-6 rounded-full bg-sky-500 items-center justify-center mt-0.5 shrink-0">
                    <Text className="text-white font-black text-[10px]">{i + 1}</Text>
                  </View>
                  <View className="flex-1">
                    <Text className="font-bold text-slate-800 text-sm">{alt.placeName}</Text>
                    <Text className="text-slate-500 text-xs mt-0.5 leading-relaxed" numberOfLines={2}>
                      {alt.reason}
                    </Text>
                    {alt.estimatedCost > 0 && (
                      <Text className="text-sky-500 text-xs font-bold mt-1">
                        💰 {alt.estimatedCost.toLocaleString()}원
                      </Text>
                    )}
                  </View>
                  <Check size={16} color="#0ea5e9" />
                </TouchableOpacity>
              ))}
            </View>
          )}
        </View>
      </TouchableOpacity>
    </View>
  );
}
