const BASE = 'https://api.openweathermap.org/data/2.5/weather';
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
