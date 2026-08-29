import { Text, TouchableOpacity, ActivityIndicator, Platform } from 'react-native';
import { useEffect } from 'react';
import { useTranslation } from 'react-i18next';
import * as Google from 'expo-auth-session/providers/google';

const IOS_CLIENT_ID = process.env.EXPO_PUBLIC_GOOGLE_IOS_CLIENT_ID;
const ANDROID_CLIENT_ID = process.env.EXPO_PUBLIC_GOOGLE_ANDROID_CLIENT_ID;
const WEB_CLIENT_ID = process.env.EXPO_PUBLIC_GOOGLE_WEB_CLIENT_ID;

/** 이 플랫폼에서 구글 로그인을 쓸 수 있는가.
 *
 * expo-auth-session의 useAuthRequest는 해당 플랫폼 clientId가 없으면 **훅 안에서 throw**한다
 * ("Client Id property `iosClientId` must be defined to use Google auth on this platform").
 * 훅은 조건부로 호출할 수 없으므로, 이 판정으로 컴포넌트 자체를 렌더할지 말지 정한다.
 * 2026-08-27 시뮬레이터 실행에서 키 미설정 시 로그인 화면이 통째로 크래시하는 걸 확인하고 분리했다.
 */
export const GOOGLE_LOGIN_AVAILABLE = Platform.select({
  ios: !!IOS_CLIENT_ID,
  android: !!ANDROID_CLIENT_ID,
  default: !!WEB_CLIENT_ID,
});

interface Props {
  loading: boolean;
  onToken: (accessToken: string) => void;
}

export function GoogleLoginButton({ loading, onToken }: Props) {
  const { t } = useTranslation();

  const [request, response, promptAsync] = Google.useAuthRequest({
    iosClientId: IOS_CLIENT_ID,
    androidClientId: ANDROID_CLIENT_ID,
    webClientId: WEB_CLIENT_ID,
  });

  useEffect(() => {
    // 사용자가 동의창을 취소한 경우는 에러가 아니므로 조용히 무시한다
    if (response?.type !== 'success') return;
    const accessToken = response.authentication?.accessToken;
    if (!accessToken) return;
    onToken(accessToken);
    // onToken은 매 렌더 새 함수라 의존성에 넣으면 중복 호출된다
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [response]);

  return (
    <TouchableOpacity
      className="w-full bg-white border border-slate-200 rounded-xl py-4 items-center"
      onPress={() => promptAsync()}
      disabled={!request || loading}
    >
      {loading ? (
        <ActivityIndicator size="small" color="#334155" />
      ) : (
        <Text className="text-slate-700 font-semibold text-base">{t('login.googleButton')}</Text>
      )}
    </TouchableOpacity>
  );
}
