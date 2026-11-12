import { create } from "zustand";
import { persist } from "zustand/middleware";

import type { ReadingSession, User } from "../types";

interface AuthSlice {
  user: User | null;
  token: string | null;
  isLoadingUser: boolean;
  setAuth: (user: User, token: string) => void;
  setUser: (user: User) => void;
  setLoadingUser: (loading: boolean) => void;
  clearUser: () => void;
}

interface SessionSlice {
  currentSession: ReadingSession | null;
  isLoadingSession: boolean;
  setCurrentSession: (session: ReadingSession) => void;
  setLoadingSession: (loading: boolean) => void;
  clearSession: () => void;
}

type Store = AuthSlice & SessionSlice;

export const useStore = create<Store>()(
  persist(
    (set) => ({
      user: null,
      token: null,
      isLoadingUser: false,

      setAuth: (user, token) => set({ user, token }),
      setUser: (user) => set({ user }),
      setLoadingUser: (loading) => set({ isLoadingUser: loading }),
      clearUser: () => set({ user: null, token: null, currentSession: null }),

      currentSession: null,
      isLoadingSession: false,

      setCurrentSession: (session) => set({ currentSession: session }),
      setLoadingSession: (loading) => set({ isLoadingSession: loading }),
      clearSession: () => set({ currentSession: null }),
    }),
    {
      name: "leeswijs-store",
      version: 2,
      partialize: (state) => ({ user: state.user, token: state.token }),
      migrate: (persisted, version) => {
        // Older persisted state carries no token; start over.
        if (version < 2) return { user: null, token: null };
        const state = persisted as { user?: User | null; token?: string | null };
        return { user: state.user ?? null, token: state.token ?? null };
      },
    }
  )
);

export const useUser = () => useStore((s) => s.user);
export const useCurrentSession = () => useStore((s) => s.currentSession);
