import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import { Icon, type IconName } from './Icon';

const NAMES: IconName[] = [
  'menu',
  'home',
  'chat',
  'check',
  'sessions',
  'profiles',
  'kanban',
  'cron',
  'agents',
  'robot',
  'system',
  'settings',
  'skills',
  'messaging',
  'search',
  'globe',
  'file',
  'image',
  'chart',
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
  'pause',
  'edit',
  'trash',
  'refresh',
  'shield',
  'terminal',
  'alert',
  'sparkle',
  'archive',
  'logout',
];

describe('Icon', () => {
  it.each(NAMES)('renders %s as an svg with viewBox', (name) => {
    render(<Icon name={name} data-testid={`icon-${name}`} />);
    const svg = screen.getByTestId(`icon-${name}`);
    expect(svg.tagName).toBe('svg');
    expect(svg).toHaveAttribute('viewBox', '0 -960 960 960');
    expect(svg.querySelector('path, circle, rect')).toBeInTheDocument();
  });

  it('applies custom size', () => {
    render(<Icon name="home" size={32} data-testid="icon-sized" />);
    const svg = screen.getByTestId('icon-sized');
    expect(svg).toHaveAttribute('width', '32');
    expect(svg).toHaveAttribute('height', '32');
  });

  it('uses the filled path for active navigation icons', () => {
    const { rerender } = render(<Icon name="home" data-testid="icon-fill" />);
    const outlined = screen.getByTestId('icon-fill').querySelector('path')?.getAttribute('d');
    rerender(<Icon name="home" filled data-testid="icon-fill" />);
    const filled = screen.getByTestId('icon-fill').querySelector('path')?.getAttribute('d');
    expect(filled).toBeTruthy();
    expect(filled).not.toBe(outlined);
  });
});
