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

// description은 OpenWeatherMap 원본 영어 문자열을 그대로 저장한다 — 다국어 표시는
// 화면단에서 `t(\`weather.conditions.${description}\`)`로 조회(locales/*.json "weather.conditions").
// (예전엔 lang=kr로 한국어 원문을 받아 영어 키 매핑 dict를 그냥 통과시키던 죽은 코드였음)

export interface WeatherInfo {
  description: string;
  temp: number;
  icon: string;
}

export type RainBlock = 'morning' | 'afternoon' | 'evening';

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

function diffDaysFromToday(dateStr: string): number {
  const target = new Date(dateStr);
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  return Math.round((target.getTime() - today.getTime()) / 86_400_000);
}

export function isWithinForecastRange(dateStr: string): boolean {
  const diff = diffDaysFromToday(dateStr);
  return diff >= 0 && diff < FORECAST_RANGE_DAYS;
}

// 이미 지난 날짜인지 — 과거는 예보가 영영 채워지지 않으므로(예보 API는 미래만 제공)
// "곧 볼 수 있다"는 안내가 아니라 기존 "정보 없음"으로 처리해야 함
export function isPastDate(dateStr: string): boolean {
  return diffDaysFromToday(dateStr) < 0;
}

function hourToBlock(hour: number): RainBlock | null {
  if (hour >= 6 && hour < 12) return 'morning';
  if (hour >= 12 && hour < 18) return 'afternoon';
  if (hour >= 18 && hour < 24) return 'evening';
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
      `${FORECAST_BASE}?lat=${coords.lat}&lon=${coords.lng}&units=metric&appid=${KEY}&cnt=40`,
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
      const rainyBlocks = (['morning', 'afternoon', 'evening'] as const).filter(
        (block) => (blockPop[block] ?? 0) >= RAIN_THRESHOLD,
      );

      result[date] = {
        description: rawDesc,
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
      `${BASE}?lat=${coords.lat}&lon=${coords.lng}&units=metric&appid=${KEY}`,
    );
    if (!res.ok) return null;
    const data = await res.json() as {
      weather: { description: string; icon: string }[];
      main: { temp: number };
    };
    const description = data.weather[0]?.description ?? '';
    return {
      description,
      temp: Math.round(data.main.temp),
      icon: data.weather[0]?.icon ?? '01d',
    };
  } catch {
    return null;
  }
}
