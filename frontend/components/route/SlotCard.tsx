import { useState } from 'react';
import { View, Text, TouchableOpacity, ActivityIndicator } from 'react-native';
import { useTranslation } from 'react-i18next';
import { Star, RefreshCw, X, Check, Navigation, Wallet, MapPin, Sparkles, CloudRain, Footprints, Car, Bus, ChevronDown, ChevronUp } from 'lucide-react-native';
import type { BudgetLevel, RouteSlot, SlotAlternative, SlotWithCoords, TransitHop } from '@/types';
import { getBudgetStatus } from '@/types';
import { getSlotAlternatives } from '@/lib/api/routes';
import { getCurrentLocationOrFallback, openTransitNavigation, openWalkNavigation } from '@/lib/navigation';

// transport_to_next 값('walk'/'taxi'/'transit')별 아이콘·색상 —
// DayTabs.tsx의 WEATHER_THEME과 동일한 패턴(값별 테마 dict)으로 통일. 라벨은 i18n 키로 별도 관리.
const TRANSPORT_THEME: Record<string, { Icon: typeof Navigation; bg: string; text: string; dot: string; labelKey: string }> = {
  walk:    { Icon: Footprints, bg: 'bg-slate-100', text: 'text-slate-600', dot: '#64748b', labelKey: 'walk' },
  taxi:    { Icon: Car,        bg: 'bg-amber-50',  text: 'text-amber-700', dot: '#d97706', labelKey: 'taxi' },
  transit: { Icon: Bus,        bg: 'bg-sky-50',    text: 'text-sky-700',   dot: '#0284c7', labelKey: 'transit' },
};
const DEFAULT_TRANSPORT_THEME = { Icon: Navigation, bg: 'bg-slate-100', text: 'text-slate-500', dot: '#94a3b8', labelKey: 'default' };

function parseTransitDetail(detail: string | null): TransitHop[] | null {
  if (!detail) return null;
  try {
    const hops = JSON.parse(detail);
    return Array.isArray(hops) && hops.length > 0 ? hops : null;
  } catch {
    return null; // 구버전 데이터/예상 밖 포맷 — 조용히 무시(크래시보다 "펼치기 없음"이 안전)
  }
}

function TransportChip({
  mode, minutes, summary, detail, marginLeft, onNavigate,
}: {
  mode: string | null;
  minutes: number | null;
  summary: string | null;
  detail: string | null;
  marginLeft: number;
  onNavigate?: () => void;
}) {
  const { t } = useTranslation();
  const [expanded, setExpanded] = useState(false);
  const theme = TRANSPORT_THEME[mode ?? ''] ?? DEFAULT_TRANSPORT_THEME;
  const Icon = theme.Icon;
  const hops = parseTransitDetail(detail);

  const chip = (
    <View className={`flex-row items-center gap-2 self-start max-w-full ${theme.bg} rounded-full px-3.5 py-2`}>
      <Icon size={16} color={theme.dot} />
      <Text className={`text-sm font-bold shrink ${theme.text}`} numberOfLines={1}>
        {summary ?? t(`slotCard.transportModes.${theme.labelKey}`)}
        {minutes != null && (
          <Text className="font-semibold text-slate-400"> · {t('slotCard.minutesSuffix', { minutes })}</Text>
        )}
      </Text>
      {hops && (expanded ? <ChevronUp size={14} color={theme.dot} /> : <ChevronDown size={14} color={theme.dot} />)}
    </View>
  );

  // walk는 환승 상세(hops)가 없어 배지 전체가 그대로 내비 버튼이 됨.
  // transit은 배지 탭이 이미 환승 상세 펼치기에 쓰이므로, 내비는 옆의 별도 아이콘 버튼으로 분리.
  const chipOpensNavigation = !hops && mode === 'walk' && !!onNavigate;
  const showNavigateButton = mode === 'transit' && !!onNavigate;

  return (
    <View className="my-2 self-start max-w-[85%]" style={{ marginLeft }}>
      <View className="flex-row items-center gap-2">
        {hops ? (
          <TouchableOpacity onPress={() => setExpanded((v) => !v)} activeOpacity={0.7}>
            {chip}
          </TouchableOpacity>
        ) : chipOpensNavigation ? (
          <TouchableOpacity onPress={onNavigate} activeOpacity={0.7}>
            {chip}
          </TouchableOpacity>
        ) : (
          chip
        )}
        {showNavigateButton && (
          <TouchableOpacity
            onPress={onNavigate}
            className="w-9 h-9 rounded-full bg-sky-500 items-center justify-center shadow-sm shadow-sky-500/30"
            activeOpacity={0.8}
          >
            <Navigation size={16} color="#ffffff" />
          </TouchableOpacity>
        )}
      </View>
      {expanded && hops && (
        <View className="mt-1.5 gap-2 border-l-2 border-slate-100 pl-3.5">
          {hops.map((hop, i) => (
            <View key={i}>
              <Text className={`text-sm font-bold ${theme.text}`}>{hop.mode} {hop.route}</Text>
              <Text className="text-sm text-slate-400">
                {t('slotCard.boardAlight', { board: hop.board_stop, alight: hop.alight_stop, minutes: hop.minutes })}
              </Text>
            </View>
          ))}
        </View>
      )}
    </View>
  );
}

interface SlotCardProps {
  slot: RouteSlot | null;
  apiSlot?: SlotWithCoords;
  index: number;
  isLast: boolean;
  routeId?: string;
  budgetLevel?: BudgetLevel;
  viewMode?: 'edit' | 'detail';
  showActions?: boolean;
  isFocused?: boolean;
  isRainy?: boolean;
  // 다음 슬롯 좌표 — walk/transit 내비 목적지로 사용(apiSlot 기반 렌더링일 때만 전달됨)
  nextPlace?: { lat: number; lng: number; name: string } | null;
  onPin: () => void;
  onRemove: () => void;
  onReplaceWithAlternative?: (alt: SlotAlternative) => void;
  onTap?: () => void;
}

function formatTime(timeStr: string | null): string | null {
  if (!timeStr) return null;
  return timeStr.slice(0, 5);
}

export function SlotCard({
  slot,
  apiSlot,
  index,
  isLast,
  routeId,
  budgetLevel,
  viewMode = 'edit',
  showActions = true,
  isFocused = false,
  isRainy = false,
  nextPlace = null,
  onPin,
  onRemove,
  onReplaceWithAlternative,
  onTap,
}: SlotCardProps) {
  const { t } = useTranslation();
  const [alternatives, setAlternatives] = useState<SlotAlternative[]>([]);
  const [loadingAlts, setLoadingAlts] = useState(false);
  const [showAlts, setShowAlts] = useState(false);
  const [tipExpanded, setTipExpanded] = useState(false);

  const placeName = apiSlot?.placeName ?? slot?.place_name ?? '';
  const tip = apiSlot?.tips ?? slot?.tip ?? null;
  const duration = apiSlot?.durationMinutes ?? slot?.duration_minutes ?? null;
  const budget = apiSlot?.estimatedCost ?? slot?.budget_estimate ?? 0;
  const pinned = apiSlot?.pinned ?? slot?.isPinned ?? false;
  const startTime = formatTime(apiSlot?.startTime ?? null);
  const transportMinutes = apiSlot?.transportMinutes ?? null;
  const transportToNext = apiSlot?.transportToNext ?? null;
  const transitSummary = apiSlot?.transitSummary ?? null;
  const transitDetail = apiSlot?.transitDetail ?? null;

  // walk/transit만 내비 대상(taxi는 이번 스코프 제외 — project_taxi_navigation_pending 메모리 참고)
  const handleNavigate = (() => {
    if (!nextPlace) return undefined;
    if (transportToNext === 'walk') {
      return () => openWalkNavigation(nextPlace.lat, nextPlace.lng);
    }
    if (transportToNext === 'transit' && apiSlot) {
      return async () => {
        const origin = await getCurrentLocationOrFallback({ lat: apiSlot.lat, lng: apiSlot.lng });
        await openTransitNavigation(origin, nextPlace);
      };
    }
    return undefined;
  })();

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

  // ─── detail 모드: Itinerary 스타일 ───────────────────────────────────────
  if (viewMode === 'detail') {
    const budgetStatus = budgetLevel ? getBudgetStatus(budget, budgetLevel) : 'ok';

    return (
      <View className="mb-8">
        <TouchableOpacity
          activeOpacity={0.85}
          onPress={() => setTipExpanded((v) => !v)}
        >
          <View className="flex-row">
            {/* 좌측: dot(지도 이동 탭 타겟) + 수직 연결선 */}
            <View className="items-center" style={{ width: 32 }}>
              <TouchableOpacity
                onPress={onTap}
                activeOpacity={onTap ? 0.7 : 1}
                className="w-8 h-8 rounded-full bg-sky-500 border-4 border-slate-50 items-center justify-center shadow-sm z-10"
              >
                <MapPin size={12} color="white" />
              </TouchableOpacity>
              {!isLast && <View className="flex-1 w-0.5 bg-sky-100 mt-1" style={{ minHeight: 24 }} />}
            </View>

            {/* 우측: 흰 카드 */}
            <View className="flex-1 ml-4 bg-white rounded-3xl p-4 shadow-sm border border-slate-100">
              <View className="flex-row justify-between items-start mb-2">
                <View className="flex-1 mr-2">
                  {startTime && (
                    <Text className="text-sky-600 font-black text-sm">{startTime}</Text>
                  )}
                  <Text className="text-lg font-bold text-slate-800 leading-tight">{placeName}</Text>
                </View>
                <View className="flex-row items-center gap-1.5">
                  {isRainy && <CloudRain size={12} color="#0ea5e9" />}
                  {duration != null && (
                    <Text className="text-xs bg-slate-100 text-slate-500 px-2 py-1 rounded-lg font-bold">
                      {t('slotCard.minutesSuffix', { minutes: duration })}
                    </Text>
                  )}
                </View>
              </View>

              {tip && (
                <View className="flex-row items-start gap-1 mb-3">
                  <Text className="flex-1 text-xs text-slate-500 leading-relaxed" numberOfLines={tipExpanded ? undefined : 2}>
                    {tip}
                  </Text>
                  {tipExpanded ? <ChevronUp size={14} color="#94a3b8" /> : <ChevronDown size={14} color="#94a3b8" />}
                </View>
              )}

              <View className="flex-row justify-between items-center pt-3 border-t border-slate-50">
                <Text className="text-[10px] font-bold px-2 py-1 rounded-md bg-slate-100 text-slate-500">
                  {t('slotCard.visitTag')}
                </Text>
                <View className="flex-row items-center gap-3">
                  <View className="flex-row items-center gap-1">
                    <Wallet size={11} color="#475569" />
                    <Text className={`text-xs font-bold ${
                      budgetStatus === 'hard' ? 'text-rose-500' :
                      budgetStatus === 'soft' ? 'text-amber-500' :
                      'text-slate-600'
                    }`}>
                      {budget === 0 ? t('slotCard.free') : t('slotCard.priceWon', { amount: budget.toLocaleString() })}
                    </Text>
                  </View>

                  {showActions && (
                    <View className="flex-row gap-2 items-center">
                      <TouchableOpacity onPress={onPin} hitSlop={8}>
                        <Star
                          size={13}
                          color={pinned ? '#0ea5e9' : '#cbd5e1'}
                          fill={pinned ? '#0ea5e9' : 'none'}
                        />
                      </TouchableOpacity>
                      <TouchableOpacity
                        onPress={handleReshuffle}
                        disabled={pinned || !apiSlot || loadingAlts}
                        hitSlop={8}
                      >
                        {loadingAlts
                          ? <ActivityIndicator size={12} color="#0ea5e9" />
                          : <RefreshCw size={13} color={pinned || !apiSlot ? '#e2e8f0' : showAlts ? '#0ea5e9' : '#94a3b8'} />}
                      </TouchableOpacity>
                      <TouchableOpacity
                        onPress={pinned ? undefined : onRemove}
                        disabled={pinned}
                        hitSlop={8}
                      >
                        <X size={13} color={pinned ? '#e2e8f0' : '#f43f5e'} />
                      </TouchableOpacity>
                    </View>
                  )}
                </View>
              </View>
            </View>
          </View>
        </TouchableOpacity>

        {!isLast && (transportMinutes != null || transportToNext) && (
          <TransportChip
            mode={transportToNext}
            minutes={transportMinutes}
            summary={transitSummary}
            detail={transitDetail}
            marginLeft={40}
            onNavigate={handleNavigate}
          />
        )}

        {showAlts && alternatives.length > 0 && (
          <View className="ml-10 mt-2 p-4 bg-sky-50 border border-sky-100 rounded-2xl">
            <View className="flex-row items-center gap-1.5 mb-3">
              <Sparkles size={13} color="#0369a1" />
              <Text className="text-xs font-bold text-sky-800">{t('slotCard.alternativesTitle')}</Text>
            </View>
            {alternatives.map((alt, i) => (
              <TouchableOpacity
                key={i}
                onPress={() => handleSelectAlternative(alt)}
                className="flex-row items-start gap-2 p-3 bg-white rounded-xl border border-sky-100 mb-2"
                activeOpacity={0.8}
              >
                <View className="w-6 h-6 rounded-full bg-sky-500 items-center justify-center mt-0.5 shrink-0">
                  <Text className="text-white font-black text-[10px]">{i + 1}</Text>
                </View>
                <View className="flex-1">
                  <Text className="font-bold text-slate-800 text-sm">{alt.placeName}</Text>
                  <Text className="text-slate-400 text-xs mt-0.5 leading-relaxed" numberOfLines={2}>
                    {alt.reason}
                  </Text>
                  {alt.estimatedCost > 0 && (
                    <Text className="text-sky-500 text-xs font-semibold mt-1">
                      {t('slotCard.priceWon', { amount: alt.estimatedCost.toLocaleString() })}
                    </Text>
                  )}
                </View>
                <Check size={16} color="#0ea5e9" />
              </TouchableOpacity>
            ))}
          </View>
        )}
      </View>
    );
  }

  // ─── edit 모드: Planner 스타일 ───────────────────────────────────────────
  return (
    <View className="relative">
      {!isLast && (
        <View className="absolute left-[19px] top-12 bottom-[-16px] w-[2px] bg-slate-100 z-0" />
      )}

      <TouchableOpacity
        activeOpacity={0.75}
        onPress={() => setTipExpanded((v) => !v)}
        style={{
          flexDirection: 'row',
          gap: 12,
          padding: 16,
          borderRadius: 16,
          borderWidth: 2,
          borderColor: isFocused ? '#0ea5e9' : pinned ? '#7dd3fc' : 'transparent',
          backgroundColor: isFocused ? '#f0f9ff' : pinned ? 'rgba(240,249,255,0.4)' : '#f8fafc',
        }}
      >
        {/* 번호 원(지도 이동 탭 타겟) */}
        <View className="items-center">
          <TouchableOpacity
            onPress={onTap}
            activeOpacity={onTap ? 0.7 : 1}
            className={`relative w-10 h-10 rounded-full items-center justify-center z-10 shadow-sm ${
              pinned ? 'bg-sky-500 shadow-sky-500/30' : 'bg-white border border-slate-200'
            }`}
          >
            <Text className={`font-black text-sm ${pinned ? 'text-white' : 'text-slate-500'}`}>
              {index + 1}
            </Text>
            {isRainy && (
              <View className="absolute -top-2 -right-2 z-20">
                <CloudRain size={19} color="#0ea5e9" />
              </View>
            )}
          </TouchableOpacity>
          {startTime && (
            <Text className="text-[10px] font-bold text-slate-500 mt-2 whitespace-nowrap">{startTime}</Text>
          )}
        </View>

        <View className="flex-1 pt-0.5">
          <View className="flex-row justify-between items-start mb-1">
            <View className="flex-1 mr-2">
              <Text className={`font-bold text-base leading-tight ${pinned ? 'text-sky-900' : 'text-slate-800'}`}>
                {placeName}
              </Text>
            </View>

            {/* 액션 버튼들 */}
            {showActions && (
              <View className="flex-row items-center gap-1 bg-white p-1 rounded-xl border border-slate-100">
                <TouchableOpacity
                  onPress={onPin}
                  className={`p-1.5 rounded-lg ${pinned ? 'bg-sky-100' : ''}`}
                >
                  <Star
                    size={16}
                    color={pinned ? '#0ea5e9' : '#cbd5e1'}
                    fill={pinned ? '#0ea5e9' : 'none'}
                  />
                </TouchableOpacity>
                <TouchableOpacity
                  onPress={handleReshuffle}
                  className={`p-1.5 rounded-lg ${showAlts ? 'bg-sky-100' : ''}`}
                  disabled={pinned || !apiSlot || loadingAlts}
                >
                  {loadingAlts ? (
                    <ActivityIndicator size={14} color="#0ea5e9" />
                  ) : (
                    <RefreshCw size={16} color={pinned || !apiSlot ? '#cbd5e1' : '#0ea5e9'} />
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
            )}
          </View>

          {tip && (
            <View className="flex-row items-start gap-1 mb-1.5">
              <Text className="flex-1 text-xs text-slate-500 leading-relaxed" numberOfLines={tipExpanded ? undefined : 2}>
                {tip}
              </Text>
              {tipExpanded ? <ChevronUp size={14} color="#94a3b8" /> : <ChevronDown size={14} color="#94a3b8" />}
            </View>
          )}

          <View className="flex-row gap-3 mt-1 items-center flex-wrap">
            {!startTime && duration != null && (
              <Text className="text-xs text-slate-400">⏱ {t('slotCard.minutesSuffix', { minutes: duration })}</Text>
            )}
            {budget > 0 && (() => {
              const status = budgetLevel ? getBudgetStatus(budget, budgetLevel) : 'ok';
              return (
                <View className="flex-row items-center gap-1">
                  <Text className={`text-xs ${
                    status === 'hard' ? 'text-rose-500 font-bold' :
                    status === 'soft' ? 'text-amber-500 font-semibold' :
                    'text-slate-400'
                  }`}>
                    {budget === 0 ? t('slotCard.free') : t('slotCard.priceWon', { amount: budget.toLocaleString() })}
                  </Text>
                  {status === 'soft' && (
                    <Text className="text-[10px] text-amber-600 font-bold bg-amber-50 px-1.5 py-0.5 rounded-md">
                      {t('slotCard.budgetCaution')}
                    </Text>
                  )}
                  {status === 'hard' && (
                    <Text className="text-[10px] text-rose-600 font-bold bg-rose-50 px-1.5 py-0.5 rounded-md">
                      {t('slotCard.budgetExceeded')}
                    </Text>
                  )}
                </View>
              );
            })()}
          </View>

          {showAlts && alternatives.length > 0 && (
            <View className="mt-3 gap-2">
              <View className="flex-row items-center gap-1.5 mb-1">
                <Sparkles size={12} color="#0369a1" />
                <Text className="text-xs font-bold text-slate-500">{t('slotCard.alternativesTitle')}</Text>
              </View>
              {alternatives.map((alt, i) => (
                <TouchableOpacity
                  key={i}
                  onPress={() => handleSelectAlternative(alt)}
                  className="flex-row items-start gap-2 p-3 bg-white rounded-xl border border-slate-100"
                  activeOpacity={0.8}
                >
                  <View className="w-6 h-6 rounded-full bg-sky-500 items-center justify-center mt-0.5 shrink-0">
                    <Text className="text-white font-black text-[10px]">{i + 1}</Text>
                  </View>
                  <View className="flex-1">
                    <Text className="font-bold text-slate-800 text-sm">{alt.placeName}</Text>
                    <Text className="text-slate-400 text-xs mt-0.5 leading-relaxed" numberOfLines={2}>
                      {alt.reason}
                    </Text>
                    {alt.estimatedCost > 0 && (
                      <Text className="text-sky-500 text-xs font-semibold mt-1">
                        {t('slotCard.priceWon', { amount: alt.estimatedCost.toLocaleString() })}
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

      {!isLast && (transportMinutes != null || transportToNext) && (
        <TransportChip
          mode={transportToNext}
          minutes={transportMinutes}
          summary={transitSummary}
          detail={transitDetail}
          marginLeft={56}
          onNavigate={handleNavigate}
        />
      )}
    </View>
  );
}
