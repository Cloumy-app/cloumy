const BASE = 'https://api.openweathermap.org/data/2.5/weather';
const FORECAST_BASE = 'https://api.openweathermap.org/data/2.5/forecast';
const KEY = process.env.EXPO_PUBLIC_OPENWEATHER_API_KEY;

// 도시명 문자열 검색(q=)은 OpenWeatherMap 도시 DB에 없는 이름(예: "Jeju Island", "Geoje")에서
// 404가 나 신뢰할 수 없음 — ai/app/config/city_centers.py와 동일한 위경도로 좌표 검색(lat/lon)
const CITY_CENTERS: Record<string, { lat: number; lng: number }> = {
  서울: { lat: 37.5665, lng: 126.9780 },
  부산: { lat: 35.1796, lng: 129.0756 },
  제주: { lat: 33.4996, lng: 126.5312 },
  경주: { lat: 35.8562, lng: 129.2114 },
  강릉: { lat: 37.7519, lng: 128.8761 },
  전주: { lat: 35.8242, lng: 127.1490 },
  여수: { lat: 34.7604, lng: 127.6622 },
  속초: { lat: 38.2070, lng: 128.5918 },
  춘천: { lat: 37.8813, lng: 127.7298 },
  거제: { lat: 34.8800, lng: 128.6211 },
};

// OpenWeatherMap 공식 컨디션 설명 전체(그룹 2xx~800) 매핑 — 일부만 매핑돼 있으면
// 매핑 안 된 항목은 영어 원문이 그대로 노출됨(예: drizzle 계열 누락으로 어색한 문구가 보이던 문제)
const WEATHER_KO: Record<string, string> = {
  // 2xx 천둥번개
  'thunderstorm with light rain': '약한 비를 동반한 천둥번개',
  'thunderstorm with rain': '비를 동반한 천둥번개',
  'thunderstorm with heavy rain': '폭우를 동반한 천둥번개',
  'light thunderstorm': '약한 천둥번개',
  'thunderstorm': '천둥번개',
  'heavy thunderstorm': '강한 천둥번개',
  'ragged thunderstorm': '불규칙한 천둥번개',
  'thunderstorm with light drizzle': '약한 이슬비를 동반한 천둥번개',
  'thunderstorm with drizzle': '이슬비를 동반한 천둥번개',
  'thunderstorm with heavy drizzle': '강한 이슬비를 동반한 천둥번개',
  // 3xx 이슬비
  'light intensity drizzle': '약한 이슬비',
  'drizzle': '이슬비',
  'heavy intensity drizzle': '강한 이슬비',
  'light intensity drizzle rain': '약한 이슬비',
  'drizzle rain': '이슬비',
  'heavy intensity drizzle rain': '강한 이슬비',
  'shower rain and drizzle': '소나기와 이슬비',
  'heavy shower rain and drizzle': '강한 소나기와 이슬비',
  'shower drizzle': '이슬비 소나기',
  // 5xx 비
  'light rain': '약한 비',
  'moderate rain': '비',
  'heavy intensity rain': '강한 비',
  'very heavy rain': '매우 강한 비',
  'extreme rain': '폭우',
  'freezing rain': '얼어붙는 비',
  'light intensity shower rain': '약한 소나기',
  'shower rain': '소나기',
  'heavy intensity shower rain': '강한 소나기',
  'ragged shower rain': '불규칙한 소나기',
  // 6xx 눈
  'light snow': '약한 눈',
  'snow': '눈',
  'heavy snow': '폭설',
  'sleet': '진눈깨비',
  'light shower sleet': '약한 진눈깨비',
  'shower sleet': '진눈깨비',
  'light rain and snow': '비와 눈',
  'rain and snow': '비와 눈',
  'light shower snow': '약한 눈발',
  'shower snow': '눈발',
  'heavy shower snow': '강한 눈발',
  // 7xx 대기
  'mist': '옅은 안개',
  'smoke': '연기',
  'haze': '연무',
  'sand/dust whirls': '모래바람',
  'fog': '짙은 안개',
  'sand': '황사',
  'dust': '먼지',
  'volcanic ash': '화산재',
  'squalls': '돌풍',
  'tornado': '토네이도',
  // 800~ 맑음/구름
  'clear sky': '맑음',
  'few clouds': '구름 조금',
  'scattered clouds': '구름',
  'broken clouds': '흐림',
  'overcast clouds': '흐림',
};

export interface WeatherInfo {
  description: string;
  temp: number;
  icon: string;
}

export type RainBlock = '오전' | '오후' | '저녁';

export interface DayWeather extends WeatherInfo {
  rainyBlocks: RainBlock[]; // 강수확률 임계치 넘는 블록만
}

// ai/app/services/weather_service.py의 _RAIN_THRESHOLD와 동일 값 유지 —
// AI가 루트를 짤 때 쓴 기준과 사용자에게 보여주는 기준을 맞추기 위함
const RAIN_THRESHOLD = 0.6;

// OpenWeatherMap 무료 티어는 5일 예보만 제공 — fetchForecast()가 범위 밖 날짜는
// 조용히 건너뛰므로(아래 dayEntries.length===0 → continue), "범위 밖이라 없는 것"과
// "다른 이유로 없는 것"을 프론트에서 구분하려면 이 함수로 직접 판정해야 한다.
export const FORECAST_RANGE_DAYS = 5;

export function isWithinForecastRange(dateStr: string): boolean {
  const target = new Date(dateStr);
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const diffDays = Math.round((target.getTime() - today.getTime()) / 86_400_000);
  return diffDays >= 0 && diffDays < FORECAST_RANGE_DAYS;
}

function hourToBlock(hour: number): RainBlock | null {
  if (hour >= 6 && hour < 12) return '오전';
  if (hour >= 12 && hour < 18) return '오후';
  if (hour >= 18 && hour < 24) return '저녁';
  return null; // 새벽 — 여행 활동 시간대 아님
}

export async function fetchForecast(
  city: string,
  dates: string[],
): Promise<Record<string, DayWeather>> {
  if (!KEY || dates.length === 0) return {};
  const coords = CITY_CENTERS[city];
  if (!coords) return {};
  try {
    const res = await fetch(
      `${FORECAST_BASE}?lat=${coords.lat}&lon=${coords.lng}&units=metric&lang=kr&appid=${KEY}&cnt=40`,
    );
    if (!res.ok) return {};
    const data = await res.json() as {
      list: {
        dt_txt: string;
        weather: { description: string; icon: string }[];
        main: { temp: number };
        pop?: number;
      }[];
    };
    const result: Record<string, DayWeather> = {};
    for (const date of dates) {
      const dayEntries = data.list.filter((item) => item.dt_txt.startsWith(date));
      if (dayEntries.length === 0) continue;

      // 대표 설명·아이콘은 정오(12:00) 예보 우선, 없으면 가장 가까운 항목
      const noon = dayEntries.find((item) => item.dt_txt.startsWith(`${date} 12:`));
      const entry = noon ?? dayEntries[0];
      const rawDesc = entry.weather[0]?.description ?? '';

      // 기온은 하루 전체 평균 (정오 스냅샷 하나가 아니라)
      const avgTemp = dayEntries.reduce((sum, item) => sum + item.main.temp, 0) / dayEntries.length;

      const blockPop: Partial<Record<RainBlock, number>> = {};
      for (const item of dayEntries) {
        const hour = Number(item.dt_txt.slice(11, 13));
        const block = hourToBlock(hour);
        if (block === null) continue;
        const pop = item.pop ?? 0;
        blockPop[block] = Math.max(blockPop[block] ?? 0, pop);
      }
      const rainyBlocks = (['오전', '오후', '저녁'] as const).filter(
        (block) => (blockPop[block] ?? 0) >= RAIN_THRESHOLD,
      );

      result[date] = {
        description: WEATHER_KO[rawDesc] ?? rawDesc,
        temp: Math.round(avgTemp),
        icon: entry.weather[0]?.icon ?? '01d',
        rainyBlocks,
      };
    }
    return result;
  } catch {
    return {};
  }
}

export async function fetchCurrentWeather(city: string): Promise<WeatherInfo | null> {
  if (!KEY) return null;
  const coords = CITY_CENTERS[city];
  if (!coords) return null;
  try {
    const res = await fetch(
      `${BASE}?lat=${coords.lat}&lon=${coords.lng}&units=metric&lang=kr&appid=${KEY}`,
    );
    if (!res.ok) return null;
    const data = await res.json() as {
      weather: { description: string; icon: string }[];
      main: { temp: number };
    };
    const rawDesc = data.weather[0]?.description ?? '';
    const description = WEATHER_KO[rawDesc] ?? rawDesc;
    return {
      description,
      temp: Math.round(data.main.temp),
      icon: data.weather[0]?.icon ?? '01d',
    };
  } catch {
    return null;
  }
}
