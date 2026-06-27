import { View, Text, TouchableOpacity, ScrollView } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useForm, Controller } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';
import { router } from 'expo-router';
import { ChevronLeft, MapPin, Users } from 'lucide-react-native';

const CITIES = ['서울', '부산', '제주', '경주', '강릉', '전주', '여수', '속초', '춘천', '거제'];
const GROUP_TYPES = [
  { value: 'solo', label: '혼자' },
  { value: 'couple', label: '커플' },
  { value: 'friends', label: '친구들' },
  { value: 'family', label: '가족' },
] as const;
const NIGHTS_OPTIONS = [1, 2, 3, 4, 5];

const step1Schema = z.object({
  destination: z.string().min(1, '목적지를 선택해주세요'),
  groupType: z.enum(['solo', 'couple', 'friends', 'family']),
  nights: z.number().min(1).max(5),
});

type Step1Form = z.infer<typeof step1Schema>;

function toDateStr(d: Date): string {
  return d.toISOString().split('T')[0];
}

export default function RouteCreateStep1() {
  const { control, handleSubmit, formState: { errors } } = useForm<Step1Form>({
    resolver: zodResolver(step1Schema),
    defaultValues: {
      destination: '',
      groupType: 'friends',
      nights: 2,
    },
  });

  const onNext = (data: Step1Form) => {
    const startDate = toDateStr(new Date());
    const end = new Date();
    end.setDate(end.getDate() + data.nights);
    const endDate = toDateStr(end);
    router.push({
      pathname: '/route/create/step-2',
      params: { ...data, startDate, endDate },
    });
  };

  return (
    <SafeAreaView className="flex-1 bg-white">
      {/* 헤더 */}
      <View className="flex-row items-center px-6 py-4">
        <TouchableOpacity onPress={() => router.back()} className="mr-4">
          <ChevronLeft size={24} color="#475569" />
        </TouchableOpacity>
        <View className="flex-1">
          <Text className="text-xs text-sky-500 font-bold mb-0.5">STEP 1 / 3</Text>
          <Text className="text-xl font-bold text-slate-800">어디로 떠날까요?</Text>
        </View>
      </View>

      <ScrollView className="flex-1 px-6" showsVerticalScrollIndicator={false}>
        {/* 목적지 */}
        <View className="mb-6">
          <View className="flex-row items-center gap-2 mb-3">
            <MapPin size={18} color="#0ea5e9" />
            <Text className="font-bold text-slate-700">목적지</Text>
          </View>
          <Controller
            control={control}
            name="destination"
            render={({ field: { value, onChange } }) => (
              <View className="flex-row flex-wrap gap-2">
                {CITIES.map((city) => (
                  <TouchableOpacity
                    key={city}
                    onPress={() => onChange(city)}
                    className={`px-4 py-2.5 rounded-2xl border-2 ${
                      value === city
                        ? 'border-sky-500 bg-sky-50'
                        : 'border-slate-200 bg-white'
                    }`}
                  >
                    <Text
                      className={`font-semibold text-sm ${
                        value === city ? 'text-sky-600' : 'text-slate-600'
                      }`}
                    >
                      {city}
                    </Text>
                  </TouchableOpacity>
                ))}
              </View>
            )}
          />
          {errors.destination && (
            <Text className="text-rose-500 text-xs mt-2">{errors.destination.message}</Text>
          )}
        </View>

        {/* 박수 */}
        <View className="mb-6">
          <Text className="font-bold text-slate-700 mb-3">여행 기간</Text>
          <Controller
            control={control}
            name="nights"
            render={({ field: { value, onChange } }) => (
              <View className="flex-row gap-2">
                {NIGHTS_OPTIONS.map((n) => (
                  <TouchableOpacity
                    key={n}
                    onPress={() => onChange(n)}
                    className={`flex-1 py-3 rounded-2xl border-2 items-center ${
                      value === n
                        ? 'border-sky-500 bg-sky-50'
                        : 'border-slate-200 bg-white'
                    }`}
                  >
                    <Text className={`font-bold text-sm ${value === n ? 'text-sky-600' : 'text-slate-500'}`}>
                      {n}박
                    </Text>
                  </TouchableOpacity>
                ))}
              </View>
            )}
          />
        </View>

        {/* 인원 유형 */}
        <View className="mb-8">
          <View className="flex-row items-center gap-2 mb-3">
            <Users size={18} color="#0ea5e9" />
            <Text className="font-bold text-slate-700">누구와 함께?</Text>
          </View>
          <Controller
            control={control}
            name="groupType"
            render={({ field: { value, onChange } }) => (
              <View className="flex-row gap-2">
                {GROUP_TYPES.map((g) => (
                  <TouchableOpacity
                    key={g.value}
                    onPress={() => onChange(g.value)}
                    className={`flex-1 py-3 rounded-2xl border-2 items-center ${
                      value === g.value
                        ? 'border-sky-500 bg-sky-50'
                        : 'border-slate-200 bg-white'
                    }`}
                  >
                    <Text className={`font-semibold text-sm ${value === g.value ? 'text-sky-600' : 'text-slate-500'}`}>
                      {g.label}
                    </Text>
                  </TouchableOpacity>
                ))}
              </View>
            )}
          />
        </View>

        <View className="h-4" />
      </ScrollView>

      {/* 다음 버튼 */}
      <View className="px-6 pb-8">
        <TouchableOpacity
          onPress={handleSubmit(onNext)}
          className="bg-sky-500 py-4 rounded-2xl items-center"
          activeOpacity={0.9}
        >
          <Text className="text-white font-bold text-base">다음 단계</Text>
        </TouchableOpacity>
      </View>
    </SafeAreaView>
  );
}
