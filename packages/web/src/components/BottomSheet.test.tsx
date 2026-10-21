import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { BottomSheet } from './BottomSheet';

describe('BottomSheet', () => {
  it('renders as a modal dialog labelled by its title', () => {
    render(
      <BottomSheet title="Model" onClose={vi.fn()}>
        <button type="button">Save</button>
      </BottomSheet>,
    );

    const dialog = screen.getByRole('dialog', { name: 'Model' });
    expect(dialog).toHaveAttribute('aria-modal', 'true');
  });

  it('closes on Escape when closing is enabled', () => {
    const onClose = vi.fn();
    render(
      <BottomSheet title="New task" onClose={onClose}>
        <button type="button">Create</button>
      </BottomSheet>,
    );

    fireEvent.keyDown(screen.getByRole('dialog', { name: 'New task' }), { key: 'Escape' });

    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it('keeps keyboard focus inside the sheet', () => {
    render(
      <BottomSheet title="Focus trap" onClose={vi.fn()}>
        <button type="button">First</button>
        <button type="button">Last</button>
      </BottomSheet>,
    );

    // the sheet's own Back/close button is the first focusable element
    const close = screen.getByRole('button', { name: 'Back' });
    const first = screen.getByRole('button', { name: 'First' });
    const last = screen.getByRole('button', { name: 'Last' });
    close.focus();
    fireEvent.keyDown(screen.getByRole('dialog', { name: 'Focus trap' }), { key: 'Tab', shiftKey: true });
    expect(last).toHaveFocus();

    fireEvent.keyDown(screen.getByRole('dialog', { name: 'Focus trap' }), { key: 'Tab' });
    expect(close).toHaveFocus();
    void first;
  });
});

describe('BottomSheet back behavior', () => {
  it('renders a back button that closes the sheet', () => {
    const onClose = vi.fn();
    render(
      <BottomSheet title="Detail" onClose={onClose}>
        <p>body</p>
      </BottomSheet>,
    );

    fireEvent.click(screen.getByRole('button', { name: 'Back' }));
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it('consumes the app-level Back press instead of navigating away', async () => {
    const { dismissTopBackLayer, clearBackLayers } = await import('../lib/backLayers');
    clearBackLayers();
    const onClose = vi.fn();
    render(
      <BottomSheet title="Schedules detail" onClose={onClose}>
        <p>body</p>
      </BottomSheet>,
    );

    expect(dismissTopBackLayer()).toBe(true);
    expect(onClose).toHaveBeenCalledTimes(1);
    clearBackLayers();
  });

  it('does not register a back layer or close button when closing is disabled', async () => {
    const { dismissTopBackLayer, clearBackLayers } = await import('../lib/backLayers');
    clearBackLayers();
    render(
      <BottomSheet title="Locked" onClose={vi.fn()} closeDisabled>
        <p>body</p>
      </BottomSheet>,
    );

    expect(screen.queryByRole('button', { name: 'Back' })).toBeNull();
    expect(dismissTopBackLayer()).toBe(false);
    clearBackLayers();
  });
});
