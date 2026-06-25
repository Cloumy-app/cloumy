import { View, Text, TouchableOpacity } from 'react-native';
import { Lock, Unlock, RefreshCw, X } from 'lucide-react-native';
import type { RouteSlot } from '@/types';

interface SlotCardProps {
  slot: RouteSlot;
  index: number;
  isLast: boolean;
  onPin: () => void;
  onReshuffle: () => void;
  onRemove: () => void;
}

export function SlotCard({ slot, index, isLast, onPin, onReshuffle, onRemove }: SlotCardProps) {
  const pinned = slot.isPinned ?? false;

  return (
    <View className="relative">
      {/* 타임라인 연결선 */}
      {!isLast && (
        <View className="absolute left-[19px] top-12 bottom-[-16px] w-[2px] bg-slate-100 z-0" />
      )}

      <View
        className={`flex-row gap-3 p-4 rounded-2xl border-2 ${
          pinned ? 'border-sky-500 bg-blue-50/30' : 'border-transparent bg-slate-50'
        }`}
      >
        {/* 순서 번호 */}
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

        {/* 내용 */}
        <View className="flex-1 pt-1">
          <View className="flex-row justify-between items-start mb-1">
            <View className="flex-1 mr-2">
              <View
                className={`self-start px-2 py-0.5 rounded-md mb-1.5 ${
                  pinned ? 'bg-blue-100' : 'bg-slate-200'
                }`}
              >
                <Text className={`text-[10px] font-bold ${pinned ? 'text-blue-700' : 'text-slate-600'}`}>
                  Day {slot.day} · {slot.order}번째
                </Text>
              </View>
              <Text className={`font-bold leading-tight ${pinned ? 'text-blue-900' : 'text-slate-800'}`}>
                {slot.place_name}
              </Text>
            </View>

            {/* 액션 버튼 */}
            <View className="flex-row items-center gap-1 bg-white p-1 rounded-xl border border-slate-100">
              <TouchableOpacity
                onPress={onPin}
                className={`p-1.5 rounded-lg ${pinned ? 'bg-blue-100' : ''}`}
              >
                {pinned ? (
                  <Lock size={16} color="#2563eb" />
                ) : (
                  <Unlock size={16} color="#94a3b8" />
                )}
              </TouchableOpacity>
              <TouchableOpacity
                onPress={pinned ? undefined : onReshuffle}
                className={`p-1.5 rounded-lg ${pinned ? 'opacity-30' : ''}`}
                disabled={pinned}
              >
                <RefreshCw size={16} color={pinned ? '#94a3b8' : '#0ea5e9'} />
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

          {slot.tip ? (
            <Text className="text-xs text-slate-500 font-medium leading-relaxed" numberOfLines={2}>
              {slot.tip}
            </Text>
          ) : null}

          <View className="flex-row gap-3 mt-2">
            <Text className="text-xs text-slate-400">⏱ {slot.duration_minutes}분</Text>
            <Text className="text-xs text-slate-400">
              💰 {slot.budget_estimate.toLocaleString()}원
            </Text>
          </View>
        </View>
      </View>
    </View>
  );
}
