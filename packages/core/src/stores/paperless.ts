import { create } from 'zustand';
import type { PaperlessPending, RestClient } from '../transport/rest';

/** Pending Paperless PDF import approval (cron email-pdf-triage), if any. */
export interface PaperlessStore {
  pending: PaperlessPending | null;
  busy: boolean;
  error: string | undefined;
  result: string | undefined;

  load(rest: RestClient): Promise<void>;
  decide(rest: RestClient, action: 'approve' | 'discard', numbers?: number[]): Promise<void>;
}

export const usePaperlessStore = create<PaperlessStore>((set, get) => ({
  pending: null,
  busy: false,
  error: undefined,
  result: undefined,

  async load(rest) {
    try {
      set({ pending: await rest.paperlessPending(), error: undefined });
    } catch {
      // ponytail: route missing (plugin not deployed) means nothing to show.
      set({ pending: null });
    }
  },

  async decide(rest, action, numbers = []) {
    const pending = get().pending;
    if (!pending || get().busy) return;
    set({ busy: true, error: undefined });
    try {
      const res = await rest.paperlessDecide(action, pending.runId, numbers);
      set({
        pending: null,
        busy: false,
        result: action === 'approve' ? `Import queued: ${(res.titles ?? []).join(', ')}` : 'Discarded',
      });
    } catch (err) {
      set({ busy: false, error: err instanceof Error ? err.message : 'Request failed.' });
    }
  },
}));
