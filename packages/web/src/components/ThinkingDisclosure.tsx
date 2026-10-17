import { useEffect, useState } from 'react';
import { Icon } from './Icon';

interface ThinkingDisclosureProps {
  text: string;
  streaming?: boolean | undefined;
}

export function ThinkingDisclosure({ text, streaming }: ThinkingDisclosureProps) {
  const [open, setOpen] = useState(streaming ?? false);

  useEffect(() => {
    setOpen(streaming ?? false);
  }, [streaming]);

  return (
    <div className="hm-thinking">
      <button type="button" className="hm-thinking__header" onClick={() => setOpen((v) => !v)} aria-expanded={open}>
        <span className="hm-thinking__icon">
          <Icon name="bolt" size={14} />
        </span>
        <span className="hm-thinking__title">{streaming ? 'Thinking' : 'Thought'}</span>
        {!streaming && (
          <span className="hm-thinking__chevron" aria-hidden="true">
            {open ? '▾' : '›'}
          </span>
        )}
        {streaming && <span className="hm-thinking__spinner" aria-label="thinking" />}
      </button>
      {open && (
        <pre className="hm-thinking__body">
          <code>{text}</code>
        </pre>
      )}
    </div>
  );
}
