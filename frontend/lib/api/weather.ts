const BASE = 'https://api.openweathermap.org/data/2.5/weather';
const FORECAST_BASE = 'https://api.openweathermap.org/data/2.5/forecast';
const KEY = process.env.EXPO_PUBLIC_OPENWEATHER_API_KEY;

const CITY_EN_MAP: Record<string, string> = {
  서울: 'Seoul',
  부산: 'Busan',
  제주: 'Jeju Island',
  경주: 'Gyeongju',
  강릉: 'Gangneung',
  전주: 'Jeonju',
  여수: 'Yeosu',
  속초: 'Sokcho',
  춘천: 'Chuncheon',
  거제: 'Geoje',
};

const WEATHER_KO: Record<string, string> = {
  'clear sky': '맑음',
  'few clouds': '구름 조금',
  'scattered clouds': '구름',
  'broken clouds': '흐림',
  'overcast clouds': '흐림',
  'light rain': '가랑비',
  'moderate rain': '비',
  'heavy intensity rain': '폭우',
  'thunderstorm': '천둥번개',
  'snow': '눈',
  'mist': '안개',
  'fog': '짙은 안개',
  'haze': '연무',
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
  const cityEn = CITY_EN_MAP[city] ?? city;
  try {
    const res = await fetch(
      `${FORECAST_BASE}?q=${encodeURIComponent(cityEn)}&units=metric&lang=kr&appid=${KEY}&cnt=40`,
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
  const cityEn = CITY_EN_MAP[city] ?? city;
  try {
    const res = await fetch(
      `${BASE}?q=${encodeURIComponent(cityEn)}&units=metric&lang=kr&appid=${KEY}`,
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
