import { Component, type ErrorInfo, type ReactNode } from 'react';

interface LazyScreenErrorBoundaryProps {
  children: ReactNode;
}

interface LazyScreenErrorBoundaryState {
  failed: boolean;
}

export class LazyScreenErrorBoundary extends Component<LazyScreenErrorBoundaryProps, LazyScreenErrorBoundaryState> {
  override state: LazyScreenErrorBoundaryState = { failed: false };

  static getDerivedStateFromError(): LazyScreenErrorBoundaryState {
    return { failed: true };
  }

  override componentDidCatch(error: unknown, info: ErrorInfo): void {
    console.warn('Hermes PWA screen chunk failed to load', error, info.componentStack);
  }

  private reload = (): void => {
    window.location.reload();
  };

  override render(): ReactNode {
    if (this.state.failed) {
      return (
        <section className="hm-empty" role="alert" aria-live="assertive" data-testid="lazy-screen-error">
          <h2>Screen failed to load</h2>
          <p className="hm-muted">Reload I.V.A.N to fetch the latest app bundle.</p>
          <button type="button" className="hm-primary" onClick={this.reload}>
            Reload
          </button>
        </section>
      );
    }

    return this.props.children;
  }
}
