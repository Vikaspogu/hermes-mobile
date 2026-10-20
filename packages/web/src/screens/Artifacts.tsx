import { useEffect, useState } from 'react';
// ponytail: prototype.css's trailing @import of screens/*.css is dropped by Vite
import '../styles/screens/artifacts.css';
import { HermesHttpError, useChatStore, type RestClient, type Artifact } from '@hermes-pwa/core';

interface ArtifactsProps {
  rest: RestClient;
}

type ArtifactKind = 'image' | 'text' | 'chart' | 'link' | 'file';

const KIND_ICON: Record<ArtifactKind, string> = {
  image: '🖼',
  text: '📄',
  chart: '📊',
  link: '🔗',
  file: '📄',
};

const KIND_LABEL: Record<ArtifactKind, string> = {
  image: 'Image',
  text: 'Text',
  chart: 'Markdown',
  link: 'Link',
  file: 'File',
};

function detectKind(artifact: Artifact): ArtifactKind {
  const t = artifact.type.toLowerCase();
  if (t === 'image' || t.startsWith('image/')) return 'image';
  if (t === 'link' || t === 'text/uri-list') return 'link';
  if (t.includes('markdown') || artifact.name.toLowerCase().endsWith('.md')) return 'chart';
  if (t.startsWith('text/')) return 'text';
  return 'file';
}

function fmtAge(ts: number): string {
  const mins = Math.max(0, Math.round((Date.now() - ts) / 60000));
  if (mins < 60) return `${mins}m`;
  const hours = Math.round(mins / 60);
  if (hours < 24) return `${hours}h`;
  return `${Math.round(hours / 24)}d`;
}

function ArtifactRow({ artifact }: { artifact: Artifact }) {
  const kind = detectKind(artifact);
  const iconClass = `hm-artifact-row__icon${
    kind === 'image' ? ' hm-artifact-row__icon--image' : kind === 'chart' ? ' hm-artifact-row__icon--chart' : ''
  }`;
  const body = (
    <>
      <span className={iconClass} aria-hidden="true">
        {KIND_ICON[kind]}
      </span>
      <span className="hm-artifact-row__body">
        <span className="hm-artifact-row__name">{artifact.name}</span>
        <span className="hm-artifact-row__sub">
          {KIND_LABEL[kind]} · {fmtAge(artifact.createdAt)}
        </span>
      </span>
      <span className="hm-artifact-row__chevron" aria-hidden="true">
        ›
      </span>
    </>
  );
  return artifact.path ? (
    <a
      className="hm-artifact-row"
      data-testid="artifact-row"
      href={artifact.path}
      target="_blank"
      rel="noreferrer"
      aria-label={`Open ${artifact.name}`}
    >
      {body}
    </a>
  ) : (
    <div className="hm-artifact-row" data-testid="artifact-row">
      {body}
    </div>
  );
}

export function Artifacts({ rest }: ArtifactsProps) {
  const sessionId = useChatStore((s) => s.sessionId);
  const [artifacts, setArtifacts] = useState<Artifact[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | undefined>(undefined);

  useEffect(() => {
    if (!sessionId) return;
    setLoading(true);
    void rest
      .sessionArtifacts(sessionId)
      .then(setArtifacts)
      .catch((err) =>
        setError(
          err instanceof HermesHttpError && err.status === 404
            ? 'Artifacts need a newer Hermes backend — this server has no artifacts API yet.'
            : err instanceof Error
              ? err.message
              : 'Failed to load',
        ),
      )
      .finally(() => setLoading(false));
  }, [rest, sessionId]);

  return (
    <div className="hm-artifacts-screen">
      {!sessionId ? (
        <div className="hm-empty-state">
          <span style={{ fontSize: 36 }} aria-hidden="true">📎</span>
          <p>No active session</p>
          <p className="hm-muted">Start a chat to see artifacts.</p>
        </div>
      ) : (
        <>
          {error && <div className="hm-warning-banner hm-warning-banner--error">{error}</div>}
          {loading && <p className="hm-muted hm-loading">Loading artifacts…</p>}

          {!loading && artifacts.length === 0 ? (
            <div className="hm-empty-state">
              <p>No artifacts</p>
              <p className="hm-muted">Files and images from this session will appear here.</p>
            </div>
          ) : (
            <>
              {artifacts.map((a) => (
                <ArtifactRow key={a.id} artifact={a} />
              ))}
              <p className="hm-artifacts-screen__note">
                Tap a row for full-screen preview.
                <br />
                Desktop shows the preview beside the list.
              </p>
            </>
          )}
        </>
      )}
    </div>
  );
}
