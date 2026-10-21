// I.V.A.N brand mark: dot-constellation avatar (bottts/identicon-inspired) + wordmark.
// Colors follow the active theme via --hm-color-* tokens.
export function BrandMark({ wordmark = 'I.V.A.N' }: { wordmark?: string }) {
  return (
    <span className="hm-brand">
      <svg className="hm-brand__mark" width="26" height="26" viewBox="0 0 28 28" aria-hidden="true" focusable="false">
        <rect
          x="1" y="1" width="26" height="26" rx="8"
          fill="color-mix(in srgb, var(--hm-color-primary) 16%, transparent)"
          stroke="color-mix(in srgb, var(--hm-color-primary) 40%, transparent)"
        />
        <circle cx="14" cy="7.4" r="1.7" fill="var(--hm-color-text-muted)" />
        <circle cx="20.6" cy="14" r="1.7" fill="var(--hm-color-text-muted)" />
        <circle cx="14" cy="20.6" r="1.7" fill="var(--hm-color-text-muted)" />
        <circle cx="7.4" cy="14" r="1.7" fill="var(--hm-color-text-muted)" />
        <circle cx="18.7" cy="9.3" r="1.15" fill="var(--hm-color-primary)" opacity="0.65" />
        <circle cx="9.3" cy="18.7" r="1.15" fill="var(--hm-color-primary)" opacity="0.65" />
        <circle cx="14" cy="14" r="3.1" fill="var(--hm-color-primary)" />
      </svg>
      <span className="hm-wordmark">{wordmark}</span>
    </span>
  );
}
