// I.V.A.N brand mark: chat bubble with an AI spark (matches public/icons/icon.svg) + wordmark.
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
        <path
          d="M9.5 6 H18.5 A4.5 4.5 0 0 1 23 10.5 V14 A4.5 4.5 0 0 1 18.5 18.5 H12.8 L9 21.6 V18.5 A4.5 4.5 0 0 1 5 14 V10.5 A4.5 4.5 0 0 1 9.5 6 Z"
          fill="none" stroke="var(--hm-color-primary)" strokeWidth="1.6" strokeLinejoin="round"
        />
        <path
          d="M14 8.6 C14.35 10.9 14.95 11.5 17.2 11.9 C14.95 12.3 14.35 12.9 14 15.2 C13.65 12.9 13.05 12.3 10.8 11.9 C13.05 11.5 13.65 10.9 14 8.6 Z"
          fill="var(--hm-color-text)"
        />
        <circle cx="19.2" cy="9.4" r="1.1" fill="var(--hm-color-success)" />
      </svg>
      <span className="hm-wordmark">{wordmark}</span>
    </span>
  );
}
