// Remote profiles + saved signal library (persisted locally).
import { create } from 'zustand';
import { persist } from 'zustand/middleware';

import type { RemoteButton, Remote, RemoteCategory, RemoteLayout, RfSignal, SavedSignal } from '../domain/types';
import { persistStorage, uid } from './storage';

interface RemotesState {
  remotes: Remote[];
  signals: SavedSignal[];

  createRemote: (input: { name: string; category: RemoteCategory; layout: RemoteLayout; columns?: number; buttons?: Omit<RemoteButton, 'id'>[] }) => Remote;
  updateRemote: (id: string, patch: Partial<Pick<Remote, 'name' | 'category' | 'layout' | 'columns'>>) => void;
  duplicateRemote: (id: string) => Remote | undefined;
  deleteRemote: (id: string) => void;
  markUsed: (id: string) => void;

  upsertButton: (remoteId: string, button: Omit<RemoteButton, 'id'> & { id?: string }) => string;
  deleteButton: (remoteId: string, buttonId: string) => void;
  moveButton: (remoteId: string, buttonId: string, delta: -1 | 1) => void;

  saveSignal: (name: string, signal: RfSignal) => SavedSignal;
  renameSignal: (id: string, name: string) => void;
  deleteSignal: (id: string) => void;

  importData: (data: { remotes: Remote[]; signals: SavedSignal[] }, mode: 'merge' | 'replace') => { remotes: number; signals: number };
  clearAll: () => void;
}

const touch = (r: Remote): Remote => ({ ...r, updatedAt: Date.now() });

export const useRemotes = create<RemotesState>()(
  persist(
    (set, get) => ({
      remotes: [],
      signals: [],

      createRemote: ({ name, category, layout, columns, buttons = [] }) => {
        const now = Date.now();
        const remote: Remote = {
          id: uid('r_'),
          name: name.trim() || 'New remote',
          category,
          layout,
          columns,
          buttons: buttons.map((b) => ({ ...b, id: uid('b_') })),
          createdAt: now,
          updatedAt: now,
        };
        set((s) => ({ remotes: [...s.remotes, remote] }));
        return remote;
      },

      updateRemote: (id, patch) =>
        set((s) => ({ remotes: s.remotes.map((r) => (r.id === id ? touch({ ...r, ...patch }) : r)) })),

      duplicateRemote: (id) => {
        const src = get().remotes.find((r) => r.id === id);
        if (!src) return undefined;
        const now = Date.now();
        const copy: Remote = {
          ...src,
          id: uid('r_'),
          name: `${src.name} (copy)`,
          buttons: src.buttons.map((b) => ({ ...b, id: uid('b_') })),
          createdAt: now,
          updatedAt: now,
          lastUsedAt: undefined,
        };
        set((s) => ({ remotes: [...s.remotes, copy] }));
        return copy;
      },

      deleteRemote: (id) => set((s) => ({ remotes: s.remotes.filter((r) => r.id !== id) })),

      markUsed: (id) =>
        set((s) => ({ remotes: s.remotes.map((r) => (r.id === id ? { ...r, lastUsedAt: Date.now() } : r)) })),

      upsertButton: (remoteId, button) => {
        const id = button.id ?? uid('b_');
        set((s) => ({
          remotes: s.remotes.map((r) => {
            if (r.id !== remoteId) return r;
            const exists = r.buttons.some((b) => b.id === id);
            const next = { ...button, id } as RemoteButton;
            return touch({ ...r, buttons: exists ? r.buttons.map((b) => (b.id === id ? next : b)) : [...r.buttons, next] });
          }),
        }));
        return id;
      },

      deleteButton: (remoteId, buttonId) =>
        set((s) => ({
          remotes: s.remotes.map((r) => (r.id === remoteId ? touch({ ...r, buttons: r.buttons.filter((b) => b.id !== buttonId) }) : r)),
        })),

      moveButton: (remoteId, buttonId, delta) =>
        set((s) => ({
          remotes: s.remotes.map((r) => {
            if (r.id !== remoteId) return r;
            const i = r.buttons.findIndex((b) => b.id === buttonId);
            const j = i + delta;
            if (i < 0 || j < 0 || j >= r.buttons.length) return r;
            const buttons = [...r.buttons];
            [buttons[i], buttons[j]] = [buttons[j], buttons[i]];
            return touch({ ...r, buttons });
          }),
        })),

      saveSignal: (name, signal) => {
        const saved: SavedSignal = { id: uid('s_'), name: name.trim() || 'Signal', signal, createdAt: Date.now() };
        set((s) => ({ signals: [saved, ...s.signals] }));
        return saved;
      },

      renameSignal: (id, name) => set((s) => ({ signals: s.signals.map((x) => (x.id === id ? { ...x, name } : x)) })),

      deleteSignal: (id) => set((s) => ({ signals: s.signals.filter((x) => x.id !== id) })),

      importData: (data, mode) => {
        if (mode === 'replace') {
          set({ remotes: data.remotes, signals: data.signals });
          return { remotes: data.remotes.length, signals: data.signals.length };
        }
        const { remotes, signals } = get();
        const remoteIds = new Set(remotes.map((r) => r.id));
        const signalIds = new Set(signals.map((x) => x.id));
        // On id collision, keep both: the imported copy gets a fresh id.
        const newRemotes = data.remotes.map((r) => (remoteIds.has(r.id) ? { ...r, id: uid('r_') } : r));
        const newSignals = data.signals.map((x) => (signalIds.has(x.id) ? { ...x, id: uid('s_') } : x));
        set({ remotes: [...remotes, ...newRemotes], signals: [...newSignals, ...signals] });
        return { remotes: newRemotes.length, signals: newSignals.length };
      },

      clearAll: () => set({ remotes: [], signals: [] }),
    }),
    { name: 'uniremote.remotes.v1', storage: persistStorage, version: 1 },
  ),
);
