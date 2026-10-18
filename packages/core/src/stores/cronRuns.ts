import { create } from 'zustand';
import type { Session } from '../domain/session';
import type { RestClient } from '../transport/rest';

/** Cron chip list: paged, optionally including silent runs, optionally one job. */
export interface CronRunsStore {
  runs: Session[];
  nextCursor: number | null;
  includeSilent: boolean;
  jobId: string | undefined;
  loading: boolean;
  error: string | undefined;

  /** Reload page 1 with the given filters (omitted filters keep their value). */
  load(rest: RestClient, filters?: { includeSilent?: boolean; jobId?: string | undefined }): Promise<void>;
  loadMore(rest: RestClient): Promise<void>;
}

export const useCronRunsStore = create<CronRunsStore>((set, get) => ({
  runs: [],
  nextCursor: null,
  includeSilent: false,
  jobId: undefined,
  loading: false,
  error: undefined,

  async load(rest, filters = {}) {
    const includeSilent = filters.includeSilent ?? get().includeSilent;
    const jobId = 'jobId' in filters ? filters.jobId : get().jobId;
    set({ includeSilent, jobId, loading: true, error: undefined, runs: [], nextCursor: null });
    try {
      const page = await rest.cronRuns({ includeSilent, ...(jobId ? { jobId } : {}) });
      // Drop a stale response if filters changed while it was in flight.
      if (get().includeSilent !== includeSilent || get().jobId !== jobId) return;
      set({ runs: page.runs, nextCursor: page.nextCursor, loading: false });
    } catch (err) {
      set({ loading: false, error: err instanceof Error ? err.message : 'Failed to load cron runs.' });
    }
  },

  async loadMore(rest) {
    const { nextCursor, includeSilent, jobId, loading } = get();
    if (nextCursor == null || loading) return;
    set({ loading: true, error: undefined });
    try {
      const page = await rest.cronRuns({ before: nextCursor, includeSilent, ...(jobId ? { jobId } : {}) });
      if (get().includeSilent !== includeSilent || get().jobId !== jobId) return;
      const seen = new Set(get().runs.map((r) => r.id));
      set({
        runs: [...get().runs, ...page.runs.filter((r) => !seen.has(r.id))],
        nextCursor: page.nextCursor,
        loading: false,
      });
    } catch (err) {
      set({ loading: false, error: err instanceof Error ? err.message : 'Failed to load cron runs.' });
    }
  },
}));
