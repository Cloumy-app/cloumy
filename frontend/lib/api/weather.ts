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

export async function fetchForecast(
  city: string,
  dates: string[],
): Promise<Record<string, WeatherInfo>> {
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
      }[];
    };
    const result: Record<string, WeatherInfo> = {};
    for (const date of dates) {
      // 해당 날짜의 정오(12:00) 예보 우선, 없으면 가장 가까운 항목
      const noon = data.list.find((item) => item.dt_txt.startsWith(`${date} 12:`));
      const closest = data.list.find((item) => item.dt_txt.startsWith(date));
      const entry = noon ?? closest;
      if (entry) {
        const rawDesc = entry.weather[0]?.description ?? '';
        result[date] = {
          description: WEATHER_KO[rawDesc] ?? rawDesc,
          temp: Math.round(entry.main.temp),
          icon: entry.weather[0]?.icon ?? '01d',
        };
      }
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
