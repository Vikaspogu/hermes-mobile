import { useEffect, useMemo, useState } from 'react';
import { useChatStore, useModelStore, useProfilesStore, type Profile, type ReasoningEffort, type RestClient } from '@hermes-pwa/core';
import { Icon } from '../components/Icon';
import { BottomSheet } from '../components/BottomSheet';
import '../styles/screens/profiles.css'; // ponytail: prototype.css's trailing @import of screens/*.css is dropped by Vite

interface ProfilesProps {
  rest: RestClient;
}

const NAME_RE = /^[a-z0-9][a-z0-9_-]{0,63}$/;
const REASONING_EFFORTS: ReasoningEffort[] = ['none', 'minimal', 'low', 'medium', 'high', 'xhigh'];

function reasoningLabel(effort: ReasoningEffort | undefined): string {
  if (!effort) return 'Default';
  if (effort === 'xhigh') return 'Extra high';
  return effort.charAt(0).toUpperCase() + effort.slice(1);
}

function thinkingLabel(showReasoning: boolean | undefined): string {
  if (showReasoning === true) return 'Shown';
  if (showReasoning === false) return 'Hidden';
  return 'Default';
}

const EFFORT_SHORT: Record<ReasoningEffort, string> = {
  none: 'None',
  minimal: 'Min',
  low: 'Low',
  medium: 'Med',
  high: 'High',
  xhigh: 'XHigh',
};

// M10 sub-line: "GPT-5.5 (Med) · Reversible-first · CLI" — model (effort) · note.
function profileMeta(p: Profile): string {
  let model = p.model ?? '';
  if (model && p.reasoningEffort) {
    model = `${model} (${EFFORT_SHORT[p.reasoningEffort]})`;
  } else if (model) {
    // preview data packs "Model · Effort" into one string; mockup wants "Model (Effort)"
    model = model.replace(/ · ([^·]+)$/, ' ($1)');
  }
  return [model, p.description].filter(Boolean).join(' · ') || 'No model set';
}

export function Profiles({ rest }: ProfilesProps) {
  const { profiles, loading, error, activeName, currentName, load, activate, create, rename, delete: deleteProfile, setModel } = useProfilesStore();
  const { options, loading: modelLoading, error: modelError, loadOptions } = useModelStore();
  const [sheetOpen, setSheetOpen] = useState(false);
  const [name, setName] = useState('');
  const [description, setDescription] = useState('');
  const [cloneFromDefault, setCloneFromDefault] = useState(true);
  const [creating, setCreating] = useState(false);
  const [actingName, setActingName] = useState<string | undefined>();
  const [menuProfile, setMenuProfile] = useState<Profile | undefined>();
  const [formError, setFormError] = useState<string | undefined>();
  const [modelProfile, setModelProfile] = useState<Profile | undefined>();
  const [selectedProvider, setSelectedProvider] = useState('');
  const [selectedModel, setSelectedModel] = useState('');
  const [selectedEffort, setSelectedEffort] = useState<ReasoningEffort>('high');
  const [selectedShowReasoning, setSelectedShowReasoning] = useState(false);
  const [modelSaving, setModelSaving] = useState(false);
  const [modelFormError, setModelFormError] = useState<string | undefined>();

  useEffect(() => {
    void load(rest);
  }, [rest, load]);

  useEffect(() => {
    void loadOptions(rest);
  }, [rest, loadOptions]);

  const providersBySlug = useMemo(() => {
    const map = new Map<string, NonNullable<typeof options>['providers'][number]>();
    options?.providers.forEach((p) => map.set(p.slug, p));
    return map;
  }, [options]);

  function openSheet() {
    setName('');
    setDescription('');
    setCloneFromDefault(true);
    setFormError(undefined);
    setSheetOpen(true);
  }

  function closeSheet() {
    if (creating) return;
    setSheetOpen(false);
  }

  async function handleCreate() {
    const trimmed = name.trim();
    if (!trimmed) {
      setFormError('Profile name is required');
      return;
    }
    if (!NAME_RE.test(trimmed)) {
      setFormError('Use lowercase letters, numbers, underscore or hyphen');
      return;
    }
    if (profiles.some((p) => p.name === trimmed)) {
      setFormError('Profile already exists');
      return;
    }
    setCreating(true);
    setFormError(undefined);
    const body: import('@hermes-pwa/core').ProfileCreateBody = {
      name: trimmed,
      clone_from_default: cloneFromDefault,
    };
    if (description.trim()) body.description = description.trim();
    try {
      await create(rest, body);
      closeSheet();
    } catch (err) {
      setFormError(err instanceof Error ? err.message : 'Failed to create profile');
    } finally {
      setCreating(false);
    }
  }

  async function handleActivate(profileName: string) {
    setActingName(profileName);
    try {
      await activate(rest, profileName);
      useChatStore.getState().startNewSession(profileName);
      setMenuProfile(undefined);
    } finally {
      setActingName(undefined);
    }
  }
  async function handleRename(profileName: string) {
    const nextName = window.prompt(`Rename profile "${profileName}" to:`, profileName)?.trim();
    if (!nextName || nextName === profileName) return;
    if (!NAME_RE.test(nextName)) {
      window.alert('Use lowercase letters, numbers, underscore or hyphen.');
      return;
    }
    if (profiles.some((p) => p.name === nextName)) {
      window.alert('Profile already exists.');
      return;
    }
    setActingName(profileName);
    try {
      await rename(rest, profileName, nextName);
    } finally {
      setActingName(undefined);
    }
  }

  async function handleDelete(profileName: string) {
    const confirmed = window.confirm(`Delete profile "${profileName}"? This removes that profile directory and its local state.`);
    if (!confirmed) return;
    setActingName(profileName);
    try {
      await deleteProfile(rest, profileName);
    } finally {
      setActingName(undefined);
    }
  }

  function openModelSheet(profile: Profile) {
    const providerSlug = profile.provider ?? options?.provider ?? options?.providers[0]?.slug ?? '';
    const provider = providersBySlug.get(providerSlug);
    const model = profile.model && provider?.models.includes(profile.model)
      ? profile.model
      : provider?.models[0] ?? profile.model ?? options?.model ?? '';
    setModelProfile(profile);
    setSelectedProvider(providerSlug);
    setSelectedModel(model);
    setSelectedEffort(profile.reasoningEffort ?? 'high');
    setSelectedShowReasoning(profile.showReasoning ?? false);
    setModelFormError(undefined);
  }

  function closeModelSheet() {
    if (modelSaving) return;
    setModelProfile(undefined);
    setModelFormError(undefined);
  }

  function handleProviderChange(providerSlug: string) {
    setSelectedProvider(providerSlug);
    const provider = providersBySlug.get(providerSlug);
    setSelectedModel(provider?.models[0] ?? '');
  }

  async function handleSaveModel() {
    if (!modelProfile) return;
    if (!selectedProvider || !selectedModel) {
      setModelFormError('Provider and model are required');
      return;
    }
    setModelSaving(true);
    setModelFormError(undefined);
    try {
      await setModel(rest, modelProfile.name, selectedProvider, selectedModel, selectedEffort, selectedShowReasoning);
      closeModelSheet();
    } catch (err) {
      setModelFormError(err instanceof Error ? err.message : 'Failed to update profile model');
    } finally {
      setModelSaving(false);
    }
  }

  const currentProvider = providersBySlug.get(selectedProvider);
  const modelPickerTitle = modelProfile ? `Model for ${modelProfile.displayName ?? modelProfile.name}` : 'Profile model';

  return (
    <div className="hm-profiles hm-scroll">
      {/* M10: "+" lives in the header in the mockup; the shell owns the header,
          so it sits in a right-aligned row directly beneath it. */}
      <div className="hm-profiles__bar">
        <button
          type="button"
          className="hm-iconbtn hm-profiles__add"
          aria-label="New profile"
          onClick={openSheet}
        >
          <Icon name="plus" size={18} />
        </button>
      </div>

      {error && <div className="hm-warning-banner hm-warning-banner--error">{error}</div>}
      {modelError && <div className="hm-warning-banner hm-warning-banner--error">{modelError}</div>}
      {loading && <p className="hm-muted hm-loading">Loading profiles…</p>}

      {profiles.length === 0 && !loading && (
        <button type="button" className="hm-ghost" onClick={() => void load(rest)}>
          Reload profiles
        </button>
      )}

      {profiles.map((p) => (
        <div
          key={p.name}
          className={`hm-card hm-profile-card${p.isActive ? ' hm-profile-card--active' : ''}`}
          data-testid="agent-card"
        >
          <button
            type="button"
            className="hm-profile-card__main"
            onClick={() => (p.isActive ? setMenuProfile(p) : void handleActivate(p.name))}
            disabled={actingName === p.name}
            aria-label={p.isActive ? `Manage active profile ${p.name}` : `Switch to profile ${p.name}`}
          >
            <span className="hm-profile-card__title">
              <span className="hm-profile-card__name">{p.displayName ?? p.name}</span>
              {p.isActive && <span className="hm-profile-card__active-pill">ACTIVE</span>}
            </span>
            <span className="hm-profile-card__meta">{profileMeta(p)}</span>
          </button>
          <button
            type="button"
            className="hm-profile-card__more"
            aria-label={`Open actions for profile ${p.name}`}
            onClick={() => setMenuProfile(p)}
          >
            ⋯
          </button>
        </div>
      ))}

      {profiles.length > 0 && (
        <p className="hm-profiles__note">
          Model settings live here only —<br />
          Settings deep-links to this screen.
        </p>
      )}

      {menuProfile && (() => {
        const p = menuProfile;
        const protectedProfile = p.name === 'default' || p.name === activeName || p.name === currentName || p.isActive;
        const acting = actingName === p.name;
        const modelLine = [
          p.model ?? 'No model set',
          p.reasoningEffort ? `Effort ${reasoningLabel(p.reasoningEffort)}` : '',
          p.showReasoning !== undefined ? `Thinking ${thinkingLabel(p.showReasoning)}` : '',
        ].filter(Boolean).join(' · ');
        return (
          <BottomSheet title={p.displayName ?? p.name} onClose={() => setMenuProfile(undefined)}>
            <p className="hm-muted hm-profile-sheet__summary">{modelLine}</p>
            <div className="hm-sheet-actions">
              <button
                type="button"
                className="hm-primary"
                onClick={() => {
                  setMenuProfile(undefined);
                  openModelSheet(p);
                }}
                disabled={modelLoading || acting}
                aria-label={`Change model for profile ${p.name}`}
              >
                Change model settings
              </button>
              {!p.isActive && (
                <button
                  type="button"
                  className="hm-ghost"
                  onClick={() => void handleActivate(p.name)}
                  disabled={acting}
                  aria-label={`Activate ${p.name}`}
                >
                  Activate
                </button>
              )}
              <button
                type="button"
                className="hm-ghost"
                onClick={() => void handleRename(p.name)}
                disabled={acting || protectedProfile}
                title={protectedProfile ? 'Switch away before renaming this profile' : 'Rename profile'}
                aria-label={`Rename profile ${p.name}`}
              >
                Rename
              </button>
              <button
                type="button"
                className="hm-ghost hm-text-danger"
                onClick={() => void handleDelete(p.name)}
                disabled={acting || protectedProfile}
                title={protectedProfile ? 'Default/current/active profiles are protected' : 'Delete profile'}
                aria-label={`Delete profile ${p.name}`}
              >
                Delete
              </button>
            </div>
          </BottomSheet>
        );
      })()}

      {modelProfile && (
        <BottomSheet
          title={modelPickerTitle}
          onClose={closeModelSheet}
          closeDisabled={modelSaving}
          footer={
            <div className="hm-projects__inline-actions">
              <button
                type="button"
                className="hm-primary hm-projects__inline-save"
                disabled={modelSaving || !selectedProvider || !selectedModel}
                onClick={() => void handleSaveModel()}
              >
                {modelSaving ? 'Saving…' : 'Save model'}
              </button>
              <button type="button" className="hm-ghost" onClick={closeModelSheet} disabled={modelSaving}>
                Cancel
              </button>
            </div>
          }
        >
              <div className="hm-projects__field">
                <label className="hm-projects__label" htmlFor="profile-model-provider">
                  Provider
                </label>
                <select
                  id="profile-model-provider"
                  className="hm-select"
                  value={selectedProvider}
                  onChange={(e) => handleProviderChange(e.target.value)}
                  disabled={modelSaving}
                >
                  {options?.providers.map((provider) => (
                    <option key={provider.slug} value={provider.slug}>
                      {provider.name} {provider.authenticated ? '✓' : ''}
                    </option>
                  ))}
                </select>
              </div>

              <div className="hm-projects__field">
                <label className="hm-projects__label" htmlFor="profile-model-model">
                  Model
                </label>
                <select
                  id="profile-model-model"
                  className="hm-select"
                  value={selectedModel}
                  onChange={(e) => setSelectedModel(e.target.value)}
                  disabled={modelSaving || !currentProvider}
                >
                  {currentProvider?.models.map((model) => (
                    <option key={model} value={model}>
                      {model}
                    </option>
                  ))}
                </select>
              </div>

              <div className="hm-projects__field">
                <label className="hm-projects__label" htmlFor="profile-model-effort">
                  Reasoning effort
                </label>
                <select
                  id="profile-model-effort"
                  className="hm-select"
                  value={selectedEffort}
                  onChange={(e) => setSelectedEffort(e.target.value as ReasoningEffort)}
                  disabled={modelSaving}
                >
                  {REASONING_EFFORTS.map((effort) => (
                    <option key={effort} value={effort}>
                      {reasoningLabel(effort)}
                    </option>
                  ))}
                </select>
              </div>

              <label className="hm-settings-row hm-settings-row--checkbox hm-profile-thinking-toggle">
                <input
                  type="checkbox"
                  checked={selectedShowReasoning}
                  onChange={(e) => setSelectedShowReasoning(e.target.checked)}
                  disabled={modelSaving}
                />
                <span>Show thinking / reasoning in chat</span>
              </label>

              {modelFormError && <div className="hm-warning-banner hm-warning-banner--error">{modelFormError}</div>}
        </BottomSheet>
      )}

      {sheetOpen && (
        <BottomSheet
          title="New profile"
          onClose={closeSheet}
          closeDisabled={creating}
          footer={
            <div className="hm-projects__inline-actions">
              <button
                type="button"
                className="hm-primary hm-projects__inline-save"
                disabled={creating || !name.trim()}
                onClick={() => void handleCreate()}
              >
                {creating ? 'Creating…' : 'Create profile'}
              </button>
              <button type="button" className="hm-ghost" onClick={closeSheet} disabled={creating}>
                Cancel
              </button>
            </div>
          }
        >
              <div className="hm-projects__field">
                <label className="hm-projects__label" htmlFor="profile-name">
                  Name
                </label>
                <input
                  id="profile-name"
                  className="hm-input"
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  placeholder="e.g. research"
                  disabled={creating}
                  autoFocus
                />
                <p className="hm-projects__hint hm-muted">Lowercase, numbers, _ and - only.</p>
              </div>

              <div className="hm-projects__field">
                <label className="hm-projects__label" htmlFor="profile-desc">
                  Description
                </label>
                <textarea
                  id="profile-desc"
                  className="hm-input"
                  value={description}
                  onChange={(e) => setDescription(e.target.value)}
                  placeholder="What is this profile for?"
                  disabled={creating}
                  rows={3}
                />
              </div>

              <label className="hm-settings-row hm-settings-row--checkbox">
                <input
                  type="checkbox"
                  checked={cloneFromDefault}
                  onChange={(e) => setCloneFromDefault(e.target.checked)}
                  disabled={creating}
                />
                <span>Clone from default</span>
              </label>

              {formError && <div className="hm-warning-banner hm-warning-banner--error">{formError}</div>}
        </BottomSheet>
      )}
    </div>
  );
}
