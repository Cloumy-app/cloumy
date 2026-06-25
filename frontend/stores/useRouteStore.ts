import { create } from 'zustand';
import type { Route, RouteSlot } from '@/types';

interface RouteStore {
  currentRoute: Route | null;
  streamingSlots: RouteSlot[];
  isStreaming: boolean;
  selectedDay: number;
  mapViewMode: 'full' | 'day';
  setCurrentRoute: (route: Route) => void;
  appendStreamingSlot: (slot: RouteSlot) => void;
  finalizeRoute: (routeId: string, destination: string, startDate: string, endDate: string) => void;
  setSelectedDay: (day: number) => void;
  toggleSlotPin: (day: number, order: number) => void;
  replaceSlot: (day: number, order: number, newSlot: Partial<RouteSlot>) => void;
  removeSlot: (day: number, order: number) => void;
  setIsStreaming: (v: boolean) => void;
  reset: () => void;
}

export const useRouteStore = create<RouteStore>((set) => ({
  currentRoute: null,
  streamingSlots: [],
  isStreaming: false,
  selectedDay: 1,
  mapViewMode: 'full',

  setCurrentRoute: (route) => set({ currentRoute: route, selectedDay: 1 }),

  appendStreamingSlot: (slot) =>
    set((s) => ({ streamingSlots: [...s.streamingSlots, slot] })),

  finalizeRoute: (routeId, destination, startDate, endDate) =>
    set((s) => ({
      currentRoute: {
        id: routeId,
        destination,
        startDate,
        endDate,
        slots: s.streamingSlots,
        createdAt: new Date().toISOString(),
      },
      streamingSlots: [],
      isStreaming: false,
    })),

  setSelectedDay: (day) => set({ selectedDay: day }),

  toggleSlotPin: (day, order) =>
    set((s) => {
      if (!s.currentRoute) return s;
      const slots = s.currentRoute.slots.map((slot) =>
        slot.day === day && slot.order === order
          ? { ...slot, isPinned: !slot.isPinned }
          : slot,
      );
      return { currentRoute: { ...s.currentRoute, slots } };
    }),

  replaceSlot: (day, order, newSlot) =>
    set((s) => {
      if (!s.currentRoute) return s;
      const slots = s.currentRoute.slots.map((slot) =>
        slot.day === day && slot.order === order ? { ...slot, ...newSlot } : slot,
      );
      return { currentRoute: { ...s.currentRoute, slots } };
    }),

  removeSlot: (day, order) =>
    set((s) => {
      if (!s.currentRoute) return s;
      const slots = s.currentRoute.slots.filter(
        (slot) => !(slot.day === day && slot.order === order),
      );
      return { currentRoute: { ...s.currentRoute, slots } };
    }),

  setIsStreaming: (v) => set({ isStreaming: v }),

  reset: () =>
    set({ currentRoute: null, streamingSlots: [], isStreaming: false, selectedDay: 1 }),
}));
