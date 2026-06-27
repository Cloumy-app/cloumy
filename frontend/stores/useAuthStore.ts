import { create } from 'zustand';
import { createMMKV } from 'react-native-mmkv';
import type { User, PassType } from '@/types';

const storage = createMMKV({ id: 'auth' });

interface AuthStore {
  user: User | null;
  accessToken: string | null;
  refreshToken: string | null;
  passType: PassType;
  isHydrated: boolean;
  setUser: (user: User) => void;
  setTokens: (access: string, refresh: string) => void;
  logout: () => void;
  loadFromStorage: () => void;
}

export const useAuthStore = create<AuthStore>((set) => ({
  user: null,
  accessToken: null,
  refreshToken: null,
  passType: 'free',
  isHydrated: false,

  setUser: (user) => set({ user }),

  setTokens: (access, refresh) => {
    storage.set('accessToken', access);
    storage.set('refreshToken', refresh);
    set({ accessToken: access, refreshToken: refresh });
  },

  logout: () => {
    storage.delete('accessToken');
    storage.delete('refreshToken');
    set({ user: null, accessToken: null, refreshToken: null, passType: 'free' });
  },

  loadFromStorage: () => {
    const access = storage.getString('accessToken') ?? null;
    const refresh = storage.getString('refreshToken') ?? null;
    set({ accessToken: access, refreshToken: refresh, isHydrated: true });
  },
}));
