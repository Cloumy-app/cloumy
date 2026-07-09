import { create } from 'zustand';

// 공유 루트 가져오기 — import-slots.tsx(자식 화면들, 여러 공개 루트를 순회하며 선택 가능)에서
// 고른 장소를 step-4.tsx(생성 트리거)까지 들고 가는 용도. accommodation-pin/step-4와
// 동일하게 expo-router params 대신 Zustand로 화면 간 상태를 전달한다.
export interface ImportedSlot {
  placeId: string;
  placeName: string;
  dayNumber: number;
  sourceRouteId: string;
}

interface ImportedSlotsStore {
  items: ImportedSlot[];
  add: (slot: ImportedSlot) => void;
  remove: (placeId: string) => void;
  clear: () => void;
}

export const useImportedSlotsStore = create<ImportedSlotsStore>((set) => ({
  items: [],
  add: (slot) =>
    set((state) => ({
      items: [...state.items.filter((i) => i.placeId !== slot.placeId), slot],
    })),
  remove: (placeId) =>
    set((state) => ({ items: state.items.filter((i) => i.placeId !== placeId) })),
  clear: () => set({ items: [] }),
}));
