import { create } from 'zustand';

// accommodation-pin.tsx(자식 화면)가 고른 좌표를 step-4.tsx(부모 화면)로 전달하는 용도.
// expo-router의 params는 자식->부모 역방향 전달이 안정적이지 않아(부모 라우트로 병합 안 됨)
// 기존 프로젝트의 Zustand 패턴을 그대로 재사용.
interface AccommodationPin {
  lat: number;
  lng: number;
  address: string | null;
}

interface AccommodationPinStore {
  pin: AccommodationPin | null;
  setPin: (pin: AccommodationPin) => void;
  clearPin: () => void;
}

export const useAccommodationPinStore = create<AccommodationPinStore>((set) => ({
  pin: null,
  setPin: (pin) => set({ pin }),
  clearPin: () => set({ pin: null }),
}));
