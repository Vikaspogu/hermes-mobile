import { useState } from 'react';
import type { Clarify } from '@hermes-pwa/core';

interface ClarifyCardProps {
  item: Clarify;
  onRespond(id: string, answer: string): void;
}

export function ClarifyCard({ item, onRespond }: ClarifyCardProps) {
  const [answer, setAnswer] = useState('');

  return (
    <div className="hm-card hm-inbox-card hm-inbox-card--clarify" data-testid="clarify-card">
      <div className="hm-card__header">
        <span className="hm-badge hm-badge--info">Clarification</span>
      </div>
      <h3 className="hm-card__title">{item.title}</h3>
      <p className="hm-clarify-question">{item.question}</p>
      <div className="hm-clarify-form">
        <input
          aria-label="Your answer"
          placeholder="Type your answer…"
          value={answer}
          onChange={(e) => setAnswer(e.target.value)}
          className="hm-input"
        />
        <button
          className="hm-primary"
          disabled={answer.trim().length === 0}
          onClick={() => onRespond(item.id, answer.trim())}
          aria-label="Send answer"
        >
          Send
        </button>
      </div>
    </div>
  );
}
