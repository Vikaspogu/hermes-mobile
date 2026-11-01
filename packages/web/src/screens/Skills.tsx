import { useEffect, useMemo, useState } from 'react';
import type { RestClient } from '@hermes-pwa/core';
import { Icon, type IconName } from '../components/Icon';

interface SkillsProps {
  rest: RestClient;
}

type SkillTag = 'built-in' | 'plugin' | 'custom' | 'core' | 'guarded' | 'ops';

interface Skill {
  id: string;
  name: string;
  description: string | undefined;
  tag: SkillTag;
  enabled: boolean;
  icon: string | undefined;
}

const ICON_NAMES = new Set<string>([
  'menu',
  'home',
  'chat',
  'check',
  'sessions',
  'kanban',
  'cron',
  'agents',
  'robot',
  'system',
  'settings',
  'skills',
  'messaging',
  'search',
  'plus',
  'mic',
  'wave',
  'arrowUp',
  'bolt',
  'chevR',
  'chevD',
  'close',
  'branch',
  'play',
  'refresh',
  'shield',
  'terminal',
  'alert',
  'sparkle',
  'archive',
]);

function isIconName(value: string): value is IconName {
  return ICON_NAMES.has(value);
}

function parseSkill(raw: Record<string, unknown>): Skill {
  const str = (v: unknown) => (typeof v === 'string' && v ? v : undefined);
  const tagRaw = typeof raw.tag === 'string' ? raw.tag : typeof raw.type === 'string' ? raw.type : 'built-in';
  const tag: SkillTag =
    tagRaw === 'core' || tagRaw === 'guarded' || tagRaw === 'ops' || tagRaw === 'plugin' || tagRaw === 'custom'
      ? (tagRaw as SkillTag)
      : 'built-in';
  return {
    id: String(raw.id ?? raw.name ?? ''),
    name: String(raw.name ?? raw.id ?? 'Skill'),
    description: str(raw.description),
    tag,
    enabled: raw.enabled !== false,
    icon: str(raw.icon),
  };
}

const TAG_LABEL: Record<SkillTag, string> = {
  'built-in': 'CORE',
  plugin: 'PLUGIN',
  custom: 'CUSTOM',
  core: 'CORE',
  guarded: 'GUARDED',
  ops: 'OPS',
};

export function Skills({ rest }: SkillsProps) {
  const [skills, setSkills] = useState<Skill[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | undefined>(undefined);

  useEffect(() => {
    void rest
      .skillsList()
      .then((raw) => setSkills((raw as unknown as Record<string, unknown>[]).map(parseSkill)))
      .catch((err) => setError(err instanceof Error ? err.message : 'Failed to load'))
      .finally(() => setLoading(false));
  }, [rest]);

  const sortedSkills = useMemo(
    () => skills.slice().sort((a, b) => Number(b.enabled) - Number(a.enabled)),
    [skills],
  );
  const enabledCount = useMemo(() => skills.filter((s) => s.enabled).length, [skills]);

  return (
    <div className="hm-skills">
      <div className="hm-qp-hero" data-testid="skills-hero">
        <div className="hm-qp-hero__top">
          <div>
            <div className="hm-qp-hero__title">Capability Registry</div>
            <div className="hm-qp-hero__telemetry">
              {enabledCount} ENABLED · {skills.length} TOTAL
            </div>
          </div>
          <span className="hm-qp-presence hm-qp-presence--sky">
            <span className="hm-qp-pill__dot" aria-hidden="true" />
            TOOLSET
          </span>
        </div>
        <div className="hm-qp-pills">
          <span className="hm-qp-pill hm-qp-pill--emerald">
            <span className="hm-qp-pill__dot" aria-hidden="true" />
            {enabledCount} ACTIVE
          </span>
          <span className="hm-qp-pill hm-qp-pill--sky">
            <span className="hm-qp-pill__dot" aria-hidden="true" />
            {skills.length} REGISTERED
          </span>
        </div>
      </div>

      <p className="hm-skills__subtitle">Skills &amp; tools available to the active profile.</p>

      {error && <div className="hm-warning-banner hm-warning-banner--error">{error}</div>}
      {loading && <p className="hm-muted hm-loading">Loading skills…</p>}

      {skills.length === 0 && !loading ? (
        <div className="hm-empty-state">
          <p>No skills available</p>
        </div>
      ) : (
        <>
          <div className="hm-qp-section__head">
            <span className="hm-qp-kicker">REGISTERED SKILLS</span>
            <span className="hm-qp-meta-badge">{skills.length} TOOLS</span>
          </div>
          <div className="hm-skills__list">
            {sortedSkills.map((skill) => (
              <div
                key={skill.id}
                className={`hm-skill-row${skill.enabled ? ' hm-skill-row--enabled' : ' hm-skill-row--disabled'}${skill.tag === 'guarded' ? ' hm-skill-row--guarded' : ''}`}
                data-testid="skill-row"
                data-tag={skill.tag}
              >
                <span className="hm-skill-row__icon" aria-hidden="true">
                  {skill.icon && isIconName(skill.icon) ? (
                    <Icon name={skill.icon} size={18} />
                  ) : (
                    skill.icon ?? '⚡'
                  )}
                </span>
                <span className="hm-skill-row__body">
                  <span className="hm-skill-row__name">{skill.name}</span>
                  <span className="hm-skill-row__desc hm-muted">{skill.description}</span>
                </span>
                <span className="hm-skill-row__tag">{TAG_LABEL[skill.tag]}</span>
              </div>
            ))}
          </div>
        </>
      )}
    </div>
  );
}
