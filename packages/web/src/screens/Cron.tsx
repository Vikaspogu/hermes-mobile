import { useEffect, useMemo, useState } from 'react';
import {
  useCronStore,
  useProfilesStore,
  useConnectionStore,
  DEFAULT_SCHEDULE_STATE,
  buildScheduleString,
  describeSchedule,
  ENGLISH_SCHEDULE_STRINGS,
} from '@hermes-pwa/core';
import type { CronJob, CronJobRun, RestClient, ScheduleBuilderState } from '@hermes-pwa/core';
import { ScheduleBuilder } from '../components/ScheduleBuilder';
import { BottomSheet } from '../components/BottomSheet';
import { SegmentedControl } from '../components/SegmentedControl';
import '../styles/screens/work.css';

/** Mockup M6 shows 12-hour times ("Daily at 3:00 AM"); core describeSchedule returns 24h. */
export function to12h(text: string): string {
  return text.replace(/\b([01]?\d|2[0-3]):([0-5]\d)\b/g, (_m, h: string, min: string) => {
    const hour = Number(h);
    const suffix = hour < 12 ? 'AM' : 'PM';
    const h12 = hour % 12 === 0 ? 12 : hour % 12;
    return `${h12}:${min} ${suffix}`;
  });
}

/** "next in 6h" relative label; null when the job has no upcoming run. */
export function relFuture(ts: number | undefined): string | null {
  if (!ts) return null;
  const diff = ts - Date.now();
  if (diff <= 0) return 'due';
  const min = Math.round(diff / 60000);
  if (min < 60) return `in ${min}m`;
  const hours = Math.round(min / 60);
  if (hours < 48) return `in ${hours}h`;
  return `in ${Math.round(hours / 24)}d`;
}

/** ponytail: keyword heuristic for the mockup's emoji icons; unknown jobs get ⏰. */
export function jobEmoji(job: CronJob): string {
  const text = `${job.name ?? ''} ${job.prompt ?? ''}`.toLowerCase();
  if (/backup|night/.test(text)) return '🌙';
  if (/secur|audit/.test(text)) return '🛡';
  if (/health|doctor/.test(text)) return '🩺';
  if (/prune|clean/.test(text)) return '🧹';
  return '⏰';
}
interface CronProps {
  rest: RestClient;
}

type SheetMode =
  | { mode: 'create' }
  | { mode: 'edit'; job: CronJob }
  | { mode: 'detail'; job: CronJob };

function formatTime(ts: string | number | undefined): string {
  if (!ts) return '—';
  const d = new Date(typeof ts === 'string' ? ts : ts);
  if (Number.isNaN(d.getTime())) return '—';
  return d.toLocaleString([], { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' });
}

function getJobTitle(job: CronJob): string {
  if (job.name) return job.name;
  if (job.prompt) return job.prompt.slice(0, 60) + (job.prompt.length > 60 ? '…' : '');
  if (job.script) return job.script.slice(0, 60) + (job.script.length > 60 ? '…' : '');
  return job.id || 'Cron job';
}

function isPaused(job: CronJob): boolean {
  return job.state === 'paused' || !job.enabled;
}

export function Cron({ rest }: CronProps) {
  const connection = useConnectionStore();
  const profiles = useProfilesStore();
  const loadProfiles = useProfilesStore((state) => state.load);
  const {
    jobs,
    deliveryTargets,
    selectedProfile,
    loading,
    actionLoading,
    error,
    setProfile,
    loadJobs,
    loadDeliveryTargets,
    createJob,
    updateJob,
    deleteJob,
    pauseJob,
    resumeJob,
    triggerJob,
    loadJobRuns,
  } = useCronStore();

  const [sheet, setSheet] = useState<SheetMode | null>(null);
  const [runs, setRuns] = useState<CronJobRun[]>([]);
  const [runsLoading, setRunsLoading] = useState(false);

  const [createForm, setCreateForm] = useState<{
    name: string;
    prompt: string;
    schedule: ScheduleBuilderState;
    deliver: string;
    profile: string;
  }>({
    name: '',
    prompt: '',
    schedule: DEFAULT_SCHEDULE_STATE,
    deliver: 'local',
    profile: 'default',
  });

  const [editForm, setEditForm] = useState<{
    name: string;
    prompt: string;
    schedule: string;
    deliver: string;
  }>({
    name: '',
    prompt: '',
    schedule: '',
    deliver: 'local',
  });

  useEffect(() => {
    if (connection.state === 'connected') {
      void loadJobs(rest);
      void loadDeliveryTargets(rest);
      void loadProfiles(rest);
    }
  }, [connection.state, rest, loadJobs, loadDeliveryTargets, loadProfiles]);

  useEffect(() => {
    if (connection.state === 'connected') {
      void loadJobs(rest);
    }
  }, [selectedProfile, rest, loadJobs, connection.state]);

  const scheduleString = useMemo(() => buildScheduleString(createForm.schedule), [createForm.schedule]);

  const profileOptions = useMemo(
    () => [{ name: 'all', displayName: 'All profiles' }, ...profiles.profiles],
    [profiles.profiles],
  );

  const deliverOptions = useMemo(() => {
    if (deliveryTargets.length === 0) {
      return [{ id: 'local', name: 'Local', homeTargetSet: true, homeEnvVar: null }];
    }
    return deliveryTargets;
  }, [deliveryTargets]);

  function openCreate() {
    const defaultProfile =
      selectedProfile === 'all'
        ? (profiles.currentName ?? profiles.activeName ?? 'default')
        : selectedProfile;
    setCreateForm({
      name: '',
      prompt: '',
      schedule: DEFAULT_SCHEDULE_STATE,
      deliver: 'local',
      profile: defaultProfile,
    });
    setSheet({ mode: 'create' });
  }

  function openEdit(job: CronJob) {
    setEditForm({
      name: job.name ?? '',
      prompt: job.prompt ?? '',
      schedule: job.schedule?.expr ?? job.expression ?? '',
      deliver: job.deliver ?? 'local',
    });
    setSheet({ mode: 'edit', job });
  }

  async function openDetail(job: CronJob) {
    setSheet({ mode: 'detail', job });
    setRunsLoading(true);
    const result = await loadJobRuns(rest, job.id, job.profile);
    setRuns(result);
    setRunsLoading(false);
  }

  function closeSheet() {
    setSheet(null);
    setRuns([]);
  }

  async function handleCreate() {
    if (!createForm.prompt.trim() || !scheduleString) return;
    await createJob(rest, {
      prompt: createForm.prompt,
      schedule: scheduleString,
      name: createForm.name,
      deliver: createForm.deliver,
      profile: createForm.profile,
    });
    closeSheet();
  }

  async function handleUpdate() {
    if (!sheet || sheet.mode !== 'edit') return;
    if (!editForm.prompt.trim() || !editForm.schedule.trim()) return;
    await updateJob(rest, sheet.job.id, {
      prompt: editForm.prompt,
      schedule: editForm.schedule,
      name: editForm.name,
      deliver: editForm.deliver,
      profile: sheet.job.profile,
    });
    closeSheet();
  }

  async function handleDelete(job: CronJob) {
    if (!confirm(`Delete job "${getJobTitle(job)}"?`)) return;
    await deleteJob(rest, job.id, job.profile);
  }

  async function handlePauseResume(job: CronJob) {
    if (isPaused(job)) {
      await resumeJob(rest, job.id, job.profile);
    } else {
      await pauseJob(rest, job.id, job.profile);
    }
  }

  async function handleTrigger(job: CronJob) {
    await triggerJob(rest, job.id, job.profile);
  }

  function deliverLabel(targetId: string): string {
    const target = deliverOptions.find((t) => t.id === targetId);
    if (!target) return targetId;
    if (target.id === 'local') return target.name;
    if (!target.homeTargetSet) return `${target.name} — set home channel first`;
    return target.name;
  }

  if (connection.state === 'init' || connection.state === 'login' || connection.state === 'offline') {
    return (
      <div className="hm-empty-state">
        <p>Connecting to Hermes…</p>
        <p className="hm-muted">{connection.error ?? 'Please wait.'}</p>
      </div>
    );
  }

  return (
    <div className="hm-cron">
      <div className="work-head">
        <SegmentedControl
          ariaLabel="Work view"
          options={[
            { value: 'tasks', label: 'Tasks' },
            { value: 'schedules', label: 'Schedules' },
          ]}
          value="schedules"
          onChange={(v) => {
            if (v === 'tasks') window.location.hash = '#/kanban';
          }}
        />
      </div>
      <div className="hm-cron__topbar">
        <select
          className="hm-select hm-cron__profile"
          value={selectedProfile}
          onChange={(e) => setProfile(e.target.value)}
          aria-label="Profile filter"
        >
          {profileOptions.map((p) => (
            <option key={p.name} value={p.name}>
              {p.displayName ?? p.name}
            </option>
          ))}
        </select>
      </div>

      {error && <div className="hm-warning-banner hm-warning-banner--error">{error}</div>}
      {loading && jobs.length === 0 && <p className="hm-muted hm-loading">Loading schedules…</p>}

      <div className="hm-cron__list">
        {jobs.length === 0 && !loading && (
          <div className="hm-empty-state hm-empty-state--inline">
            <p className="hm-body-semibold">No schedules yet</p>
            <p className="hm-muted">Tap + to schedule your first job.</p>
          </div>
        )}

        {jobs.map((job) => {
          const title = getJobTitle(job);
          const paused = isPaused(job);
          const scheduleText = describeSchedule(
            job.schedule,
            job.scheduleDisplay ?? job.expression,
            ENGLISH_SCHEDULE_STRINGS,
          );
          const next = relFuture(job.nextRun);
          const lastLabel =
            job.lastError || (job.lastStatus && job.lastStatus !== 'ok')
              ? '✗'
              : job.lastRun || job.lastStatus === 'ok'
                ? '✓'
                : '—';
          const meta = `${to12h(scheduleText)} · next ${next ?? '—'} · last ${lastLabel}`;
          return (
            <div
              key={`${job.profile}:${job.id}`}
              className={`work-listrow${paused ? ' work-listrow--paused' : ''}`}
            >
              <button
                type="button"
                className="work-listrow__main"
                onClick={() => openDetail(job)}
                aria-label={`Open ${title}`}
              >
                <span className="work-listrow__icon" aria-hidden="true">
                  {jobEmoji(job)}
                </span>
                <span className="work-listrow__body">
                  <span className="work-listrow__name">{title}</span>
                  <span className="work-listrow__meta">{meta}</span>
                </span>
              </button>
              <label className="hm-toggle" onClick={(e) => e.stopPropagation()}>
                <input
                  type="checkbox"
                  checked={!paused}
                  disabled={actionLoading === `pause:${job.id}` || actionLoading === `resume:${job.id}`}
                  onChange={() => void handlePauseResume(job)}
                  aria-label={paused ? `Enable ${title}` : `Pause ${title}`}
                />
                <span className="hm-toggle__track" aria-hidden="true" />
              </label>
            </div>
          );
        })}
      </div>

      <p className="work-footnote">
        Cron expressions live in the edit sheet — you read plain English here.
      </p>

      <button
        type="button"
        className="hm-fab"
        data-testid="cron-new"
        aria-label="New schedule"
        onClick={openCreate}
      >
        +
      </button>
      {sheet?.mode === 'create' && (
        <BottomSheet
          title="New schedule"
          onClose={closeSheet}
          footer={
            <div className="hm-projects__inline-actions">
              <button
                type="button"
                className="hm-primary hm-projects__inline-save"
                disabled={!createForm.prompt.trim() || !scheduleString || actionLoading === 'create'}
                onClick={() => void handleCreate()}
              >
                Create
              </button>
              <button type="button" className="hm-ghost" onClick={closeSheet}>
                Cancel
              </button>
            </div>
          }
        >
          <div className="hm-projects__field">
            <label className="hm-projects__label">Profile</label>
            <select
              className="hm-select"
              value={createForm.profile}
              onChange={(e) => setCreateForm((f) => ({ ...f, profile: e.target.value }))}
            >
              {profiles.profiles.map((p) => (
                <option key={p.name} value={p.name}>
                  {p.displayName ?? p.name}
                </option>
              ))}
            </select>
          </div>

          <div className="hm-projects__field">
            <label className="hm-projects__label">Name (optional)</label>
            <input
              type="text"
              className="hm-input"
              placeholder="e.g. Nightly backup"
              value={createForm.name}
              onChange={(e) => setCreateForm((f) => ({ ...f, name: e.target.value }))}
              autoFocus
            />
          </div>

          <div className="hm-projects__field">
            <label className="hm-projects__label">Prompt</label>
            <textarea
              className="hm-textarea"
              rows={3}
              placeholder="What should the cron job do?"
              value={createForm.prompt}
              onChange={(e) => setCreateForm((f) => ({ ...f, prompt: e.target.value }))}
            />
          </div>

          <div className="hm-projects__field">
            <label className="hm-projects__label">Schedule</label>
            <ScheduleBuilder
              value={createForm.schedule}
              onChange={(schedule) => setCreateForm((f) => ({ ...f, schedule }))}
            />
          </div>

          <div className="hm-projects__field">
            <label className="hm-projects__label">Deliver to</label>
            <select
              className="hm-select"
              value={createForm.deliver}
              onChange={(e) => setCreateForm((f) => ({ ...f, deliver: e.target.value }))}
            >
              {deliverOptions.map((t) => (
                <option key={t.id} value={t.id}>
                  {deliverLabel(t.id)}
                </option>
              ))}
            </select>
            {deliverOptions.length <= 1 && (
              <p className="hm-note">No external delivery targets configured. Jobs will run locally only.</p>
            )}
          </div>
        </BottomSheet>
      )}

      {sheet?.mode === 'edit' && (
        <BottomSheet
          title="Edit schedule"
          onClose={closeSheet}
          footer={
            <div className="hm-projects__inline-actions">
              <button
                type="button"
                className="hm-primary hm-projects__inline-save"
                disabled={
                  !editForm.prompt.trim() ||
                  !editForm.schedule.trim() ||
                  actionLoading === `update:${sheet.job.id}`
                }
                onClick={() => void handleUpdate()}
              >
                Save
              </button>
              <button type="button" className="hm-ghost" onClick={closeSheet}>
                Cancel
              </button>
            </div>
          }
        >
          <div className="hm-projects__field">
            <label className="hm-projects__label">Name</label>
            <input
              type="text"
              className="hm-input"
              value={editForm.name}
              onChange={(e) => setEditForm((f) => ({ ...f, name: e.target.value }))}
              autoFocus
            />
          </div>

          <div className="hm-projects__field">
            <label className="hm-projects__label">Prompt</label>
            <textarea
              className="hm-textarea"
              rows={3}
              placeholder="What should the cron job do?"
              value={editForm.prompt}
              onChange={(e) => setEditForm((f) => ({ ...f, prompt: e.target.value }))}
            />
          </div>

          <div className="hm-projects__field">
            <label className="hm-projects__label">Schedule</label>
            <input
              type="text"
              className="hm-input hm-mono"
              placeholder="0 9 * * *"
              value={editForm.schedule}
              onChange={(e) => setEditForm((f) => ({ ...f, schedule: e.target.value }))}
            />
          </div>

          <div className="hm-projects__field">
            <label className="hm-projects__label">Deliver to</label>
            <select
              className="hm-select"
              value={editForm.deliver}
              onChange={(e) => setEditForm((f) => ({ ...f, deliver: e.target.value }))}
            >
              {deliverOptions.map((t) => (
                <option key={t.id} value={t.id}>
                  {deliverLabel(t.id)}
                </option>
              ))}
            </select>
          </div>
        </BottomSheet>
      )}

      {sheet?.mode === 'detail' && (
        <BottomSheet
          title={getJobTitle(sheet.job)}
          onClose={closeSheet}
          meta={
            <div className="hm-sheet__meta">
              <span className={`hm-badge ${isPaused(sheet.job) ? 'hm-badge--pending' : 'hm-badge--pass'}`}>
                {isPaused(sheet.job) ? 'paused' : sheet.job.state ?? 'scheduled'}
              </span>
              <span className="hm-badge hm-badge--profile">{sheet.job.profile}</span>
              {sheet.job.deliver && sheet.job.deliver !== 'local' && (
                <span className="hm-badge hm-badge--info">{sheet.job.deliver}</span>
              )}
            </div>
          }
          footer={
            <div className="hm-cron__detail-actions">
              <button
                type="button"
                className="hm-ghost hm-cron__detail-delete"
                disabled={actionLoading === `delete:${sheet.job.id}`}
                onClick={() => {
                  closeSheet();
                  void handleDelete(sheet.job);
                }}
              >
                Delete
              </button>
              <button
                type="button"
                className="hm-ghost"
                disabled={actionLoading === `trigger:${sheet.job.id}`}
                onClick={() => void handleTrigger(sheet.job)}
              >
                Run now
              </button>
              <button
                type="button"
                className="hm-primary"
                onClick={() => openEdit(sheet.job)}
              >
                Edit
              </button>
            </div>
          }
        >
          {sheet.job.prompt && (
            <div className="hm-projects__field">
              <label className="hm-projects__label">Prompt</label>
              <p className="hm-projects__body">{sheet.job.prompt}</p>
            </div>
          )}

          <div className="hm-projects__field">
            <label className="hm-projects__label">Schedule</label>
            <p className="hm-mono hm-muted">
              {describeSchedule(
                sheet.job.schedule,
                sheet.job.scheduleDisplay ?? sheet.job.expression,
                ENGLISH_SCHEDULE_STRINGS,
              )}
            </p>
            {sheet.job.expression && <code className="hm-mono hm-note">{sheet.job.expression}</code>}
          </div>

          <div className="hm-projects__form-row">
            <div className="hm-projects__field">
              <label className="hm-projects__label">Next run</label>
              <p className="hm-muted">{formatTime(sheet.job.nextRun)}</p>
            </div>
            <div className="hm-projects__field">
              <label className="hm-projects__label">Last run</label>
              <p className="hm-muted">{formatTime(sheet.job.lastRun)}</p>
            </div>
          </div>

          {sheet.job.lastError && (
            <div className="hm-projects__field">
              <label className="hm-projects__label">Last error</label>
              <p className="hm-cron-card__error">{sheet.job.lastError}</p>
            </div>
          )}

          <div className="hm-projects__field">
            <label className="hm-projects__label">Recent runs</label>
            {runsLoading ? (
              <p className="hm-muted">Loading…</p>
            ) : runs.length === 0 ? (
              <p className="hm-muted">No recent runs.</p>
            ) : (
              <div className="hm-cron__runs">
                {runs.map((run) => (
                  <div key={run.sessionId} className="hm-cron__run">
                    <span className="hm-cron__run-title">{run.title ?? run.sessionId}</span>
                    <span className="hm-muted">
                      {run.isActive ? 'active' : formatTime(run.startedAt)}
                    </span>
                  </div>
                ))}
              </div>
            )}
          </div>
        </BottomSheet>
      )}
    </div>
  );
}
