import { useSyncExternalStore } from "react";
import type { World } from "./world";

export interface Toast {
  id: number;
  title: string;
  sub?: string;
  color?: string;
  big?: boolean;
}

export interface FeedLine {
  id: number;
  html: string;
  at: number;
}

export interface HudState {
  world: World | null;
  me: number;
  extractPct: number;
  nearPrompt: string | null;
  toasts: Toast[];
  feed: FeedLine[];
  inventoryOpen: boolean;
  paused: boolean;
  revision: number;
}

let state: HudState = {
  world: null,
  me: 0,
  extractPct: 0,
  nearPrompt: null,
  toasts: [],
  feed: [],
  inventoryOpen: false,
  paused: false,
  revision: 0,
};
const subs = new Set<() => void>();
let nextId = 1;

export const hud = {
  get: () => state,
  set(patch: Partial<HudState>) {
    state = { ...state, ...patch, revision: state.revision + 1 };
    subs.forEach((s) => s());
  },
  toast(t: Omit<Toast, "id">, ms = 2600) {
    const id = nextId++;
    hud.set({ toasts: [...state.toasts.slice(-2), { ...t, id }] });
    setTimeout(() => hud.set({ toasts: state.toasts.filter((x) => x.id !== id) }), ms);
  },
  feed(html: string) {
    const id = nextId++;
    hud.set({ feed: [...state.feed.slice(-5), { id, html, at: Date.now() }] });
    setTimeout(() => hud.set({ feed: state.feed.filter((x) => x.id !== id) }), 7000);
  },
  reset() {
    state = { ...state, world: null, toasts: [], feed: [], extractPct: 0, nearPrompt: null, inventoryOpen: false, paused: false };
    subs.forEach((s) => s());
  },
  subscribe(cb: () => void) {
    subs.add(cb);
    return () => subs.delete(cb);
  },
};

export function useHud() {
  return useSyncExternalStore(hud.subscribe, hud.get);
}

/** Minimap canvas is drawn by the game scene and mounted by the HUD. */
export const minimap = { canvas: null as HTMLCanvasElement | null };
