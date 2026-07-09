import { create } from 'zustand';

// import-slots.tsx(공유 루트 브라우징 스텝)에서 고른 장소를 step-4.tsx(생성 트리거)로 전달하는 용도.
// useAccommodationPinStore와 동일한 이유로 Zustand 사용 — 여러 공개 루트에서 반복 선택 가능하도록
// 단일 값이 아닌 리스트로 계속 append한다.
export interface ImportedSlot {
  placeId: string;
  placeName: string;
  dayNumber: number;
  sourceRouteId: string;
}

interface ImportedSlotsStore {
  slots: ImportedSlot[];
  addSlot: (slot: ImportedSlot) => void;
  removeSlot: (placeId: string) => void;
  clear: () => void;
}

export const useImportedSlotsStore = create<ImportedSlotsStore>((set) => ({
  slots: [],
  addSlot: (slot) => set((s) => ({ slots: [...s.slots, slot] })),
  removeSlot: (placeId) => set((s) => ({ slots: s.slots.filter((x) => x.placeId !== placeId) })),
  clear: () => set({ slots: [] }),
}));
