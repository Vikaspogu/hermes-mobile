import { describe, expect, it } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/react';
import { ThinkingDisclosure } from './ThinkingDisclosure';

describe('ThinkingDisclosure', () => {
  it('shows a collapsed "Thought" link for finished turns and opens on tap', () => {
    render(<ThinkingDisclosure text="plan the merge" streaming={false} />);
    const button = screen.getByRole('button', { name: /Thought/ });
    expect(button).toHaveAttribute('aria-expanded', 'false');
    expect(screen.queryByText('plan the merge')).toBeNull();
    fireEvent.click(button);
    expect(screen.getByText('plan the merge')).toBeInTheDocument();
  });

  it('shows "Thinking" open while streaming', () => {
    render(<ThinkingDisclosure text="working" streaming />);
    expect(screen.getByRole('button', { name: /Thinking/ })).toHaveAttribute('aria-expanded', 'true');
  });
});
