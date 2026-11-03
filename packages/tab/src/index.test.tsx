import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import React from 'react';
import { MobileTab, mount } from './index';

describe('MobileTab', () => {
  const fetchSpy = vi.fn();

  beforeEach(() => {
    vi.stubGlobal('__HERMES_PLUGINS__', { register: vi.fn() });
    vi.stubGlobal('__HERMES_PLUGIN_SDK__', undefined);
    vi.stubGlobal('fetch', fetchSpy);

    fetchSpy.mockImplementation(async (url: string | URL | Request) => {
      const urlStr = typeof url === 'string' ? url : url instanceof Request ? url.url : url.href;

      if (urlStr.includes('/diagnostics')) {
        return new Response(
          JSON.stringify({
            origin: 'https://example.com',
            https: true,
            localhost: false,
            private_ip: false,
            app_url: 'https://example.com/dashboard-plugins/hermes-pwa/dist/mobile/index.html',
            manifest_url: 'https://example.com/dashboard-plugins/hermes-pwa/dist/mobile/manifest.json',
            service_worker_url: 'https://example.com/dashboard-plugins/hermes-pwa/dist/mobile/service-worker.js',
            app_scope: 'https://example.com/dashboard-plugins/hermes-pwa/dist/mobile/',
            dist_ready: true,
          }),
          { status: 200, headers: { 'content-type': 'application/json' } }
        );
      }
      if (urlStr.includes('/api/status')) {
        return new Response(JSON.stringify({ auth_required: false, gateway_state: 'running' }), {
          status: 200,
          headers: { 'content-type': 'application/json' },
        });
      }
      if (urlStr.includes('/manifest.json') || urlStr.includes('/service-worker.js')) {
        return new Response('ok', { status: 200 });
      }
      return new Response('not found', { status: 404 });
    });
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('renders hero with title', () => {
    render(<MobileTab />);
    expect(screen.getByText('I.V.A.N')).toBeInTheDocument();
    expect(screen.getByText(/Installable mobile control plane/)).toBeInTheDocument();
  });

  it('renders Open PWA and Manifest buttons', () => {
    render(<MobileTab />);
    expect(screen.getByRole('link', { name: /Open PWA/i })).toBeInTheDocument();
    expect(screen.getByRole('link', { name: /Manifest/i })).toBeInTheDocument();
  });

  it('renders a QR code for the mobile app URL', async () => {
    render(<MobileTab />);
    const qr = await screen.findByRole('img', { name: /QR code for I.V.A.N app URL/i });
    expect(qr).toHaveAttribute('src', expect.stringMatching(/^data:image\/gif;base64,/));
    expect(screen.getByText('Scan to open on phone')).toBeInTheDocument();
  });

  it('loads diagnostics and shows checks', async () => {
    render(<MobileTab />);
    await waitFor(() => {
      expect(screen.getByText('PWA dist built')).toBeInTheDocument();
    }, { timeout: 3000 });
    expect(screen.getByText('HTTPS / Secure context')).toBeInTheDocument();
    expect(screen.getByText('API reachable')).toBeInTheDocument();
    expect(screen.getByText('Auth status')).toBeInTheDocument();
  });

  it('shows pass badge for HTTPS when secure', async () => {
    render(<MobileTab />);
    await waitFor(() => {
      expect(screen.getByText('HTTPS / Secure context')).toBeInTheDocument();
    }, { timeout: 3000 });
    // The badge text "OK" should appear multiple times for passing checks
    const okBadges = screen.getAllByText('OK');
    expect(okBadges.length).toBeGreaterThanOrEqual(1);
  });

  it('shows warning banner for private IP', async () => {
    fetchSpy.mockImplementation(async (url: string | URL | Request) => {
      const urlStr = typeof url === 'string' ? url : url instanceof Request ? url.url : url.href;
      if (urlStr.includes('/diagnostics')) {
        return new Response(
          JSON.stringify({
            origin: 'https://192.168.1.10',
            https: true,
            localhost: false,
            private_ip: true,
            app_url: 'https://192.168.1.10/dashboard-plugins/hermes-pwa/dist/mobile/index.html',
            manifest_url: 'https://192.168.1.10/dashboard-plugins/hermes-pwa/dist/mobile/manifest.json',
            service_worker_url: 'https://192.168.1.10/dashboard-plugins/hermes-pwa/dist/mobile/service-worker.js',
            app_scope: 'https://192.168.1.10/dashboard-plugins/hermes-pwa/dist/mobile/',
            dist_ready: true,
          }),
          { status: 200, headers: { 'content-type': 'application/json' } }
        );
      }
      if (urlStr.includes('/api/status')) {
        return new Response(JSON.stringify({}), { status: 200 });
      }
      if (urlStr.includes('/manifest.json') || urlStr.includes('/service-worker.js')) {
        return new Response('ok', { status: 200 });
      }
      return new Response('not found', { status: 404 });
    });

    render(<MobileTab />);
    await waitFor(() => {
      expect(screen.getByText('Private IP detected')).toBeInTheDocument();
    }, { timeout: 3000 });
  });

  it('shows warning banner for non-secure origin', async () => {
    fetchSpy.mockImplementation(async (url: string | URL | Request) => {
      const urlStr = typeof url === 'string' ? url : url instanceof Request ? url.url : url.href;
      if (urlStr.includes('/diagnostics')) {
        return new Response(
          JSON.stringify({
            origin: 'http://example.com',
            https: false,
            localhost: false,
            private_ip: false,
            app_url: 'http://example.com/dashboard-plugins/hermes-pwa/dist/mobile/index.html',
            manifest_url: 'http://example.com/dashboard-plugins/hermes-pwa/dist/mobile/manifest.json',
            service_worker_url: 'http://example.com/dashboard-plugins/hermes-pwa/dist/mobile/service-worker.js',
            app_scope: 'http://example.com/dashboard-plugins/hermes-pwa/dist/mobile/',
            dist_ready: true,
          }),
          { status: 200, headers: { 'content-type': 'application/json' } }
        );
      }
      if (urlStr.includes('/api/status')) {
        return new Response(JSON.stringify({}), { status: 200 });
      }
      if (urlStr.includes('/manifest.json') || urlStr.includes('/service-worker.js')) {
        return new Response('ok', { status: 200 });
      }
      return new Response('not found', { status: 404 });
    });

    render(<MobileTab />);
    await waitFor(() => {
      expect(screen.getByText('Non-secure origin')).toBeInTheDocument();
    }, { timeout: 3000 });
  });

  it('handles rejected api status gracefully', async () => {
    fetchSpy.mockImplementation(async (url: string | URL | Request) => {
      const urlStr = typeof url === 'string' ? url : url instanceof Request ? url.url : url.href;
      if (urlStr.includes('/diagnostics')) {
        return new Response(
          JSON.stringify({
            origin: 'https://example.com',
            https: true,
            localhost: false,
            private_ip: false,
            app_url: 'https://example.com/dashboard-plugins/hermes-pwa/dist/mobile/index.html',
            manifest_url: 'https://example.com/dashboard-plugins/hermes-pwa/dist/mobile/manifest.json',
            service_worker_url: 'https://example.com/dashboard-plugins/hermes-pwa/dist/mobile/service-worker.js',
            app_scope: 'https://example.com/dashboard-plugins/hermes-pwa/dist/mobile/',
            dist_ready: true,
          }),
          { status: 200, headers: { 'content-type': 'application/json' } }
        );
      }
      if (urlStr.includes('/api/status')) {
        return new Response('error', { status: 500 });
      }
      if (urlStr.includes('/manifest.json') || urlStr.includes('/service-worker.js')) {
        return new Response('ok', { status: 200 });
      }
      return new Response('not found', { status: 404 });
    });

    render(<MobileTab />);
    await waitFor(() => {
      // API check should still complete; apiStatus will be empty object from catch
      expect(screen.getByText('API reachable')).toBeInTheDocument();
    }, { timeout: 3000 });
  });

  it('shows error banner when diagnostics fail', async () => {
    fetchSpy.mockRejectedValue(new Error('Connection refused'));

    render(<MobileTab />);
    await waitFor(() => {
      expect(screen.getByText('Diagnostics failed')).toBeInTheDocument();
    }, { timeout: 3000 });
    expect(screen.getByText('Connection refused')).toBeInTheDocument();
  });

  it('handles rejected manifest and service worker checks', async () => {
    fetchSpy.mockImplementation(async (url: string | URL | Request) => {
      const urlStr = typeof url === 'string' ? url : url instanceof Request ? url.url : url.href;
      if (urlStr.includes('/diagnostics')) {
        return new Response(
          JSON.stringify({
            origin: 'https://example.com',
            https: true,
            localhost: false,
            private_ip: false,
            app_url: 'https://example.com/dashboard-plugins/hermes-pwa/dist/mobile/index.html',
            manifest_url: 'https://example.com/dashboard-plugins/hermes-pwa/dist/mobile/manifest.json',
            service_worker_url: 'https://example.com/dashboard-plugins/hermes-pwa/dist/mobile/service-worker.js',
            app_scope: 'https://example.com/dashboard-plugins/hermes-pwa/dist/mobile/',
            dist_ready: true,
          }),
          { status: 200, headers: { 'content-type': 'application/json' } }
        );
      }
      if (urlStr.includes('/api/status')) {
        return new Response(JSON.stringify({ auth_required: false }), { status: 200 });
      }
      if (urlStr.includes('/manifest.json')) {
        return Promise.reject(new Error('Manifest blocked'));
      }
      if (urlStr.includes('/service-worker.js')) {
        return Promise.reject(new Error('SW blocked'));
      }
      return new Response('not found', { status: 404 });
    });

    render(<MobileTab />);
    await waitFor(() => {
      expect(screen.getByText('Manifest reachable')).toBeInTheDocument();
    }, { timeout: 3000 });
    // Manifest and SW should show fail state due to rejected promises
    expect(screen.getByText('Could not fetch manifest.')).toBeInTheDocument();
    expect(screen.getByText('Could not fetch service worker.')).toBeInTheDocument();
  });
});

describe('mount', () => {
  it('mounts MobileTab into container and returns cleanup', async () => {
    const container = document.createElement('div');
    const cleanup = mount(container);
    await waitFor(() => {
      expect(container.textContent).toContain('I.V.A.N');
    }, { timeout: 3000 });
    cleanup();
    expect(container.innerHTML).toBe('');
  });
});

describe('window globals', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('exposes HermesMobileTab on window', async () => {
    vi.resetModules();
    await import('./index');
    expect((window as unknown as Record<string, unknown>).HermesMobileTab).toBeDefined();
    expect((window as unknown as Record<string, unknown>).HermesMobileTab).toHaveProperty('mount');
    expect((window as unknown as Record<string, unknown>).HermesMobileTab).toHaveProperty('MobileTab');
  });
});

describe('dashboard plugin registration', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('registers with host SDK when available', async () => {
    const registerMock = vi.fn();
    const containerDiv = document.createElement('div');
    const useRefMock = vi.fn(() => ({ current: containerDiv }));
    const useEffectMock = vi.fn((fn: () => void | (() => void)) => {
      const cleanup = fn();
      return cleanup;
    });

    vi.stubGlobal('__HERMES_PLUGINS__', { register: registerMock });
    vi.stubGlobal('__HERMES_PLUGIN_SDK__', {
      React: { createElement: React.createElement },
      hooks: {
        useEffect: useEffectMock,
        useRef: useRefMock,
      },
    });

    vi.resetModules();
    await import('./index');

    expect(registerMock).toHaveBeenCalledWith('hermes-pwa', expect.any(Function));
    const RegisteredComponent = registerMock.mock.calls[0][1] as React.FC;
    // Render to exercise the host-sdk component branches
    const { unmount } = render(<RegisteredComponent />);
    expect(useEffectMock).toHaveBeenCalled();
    unmount();
  });

  it('registers class-based fallback without host SDK hooks', async () => {
    const registerMock = vi.fn();

    vi.stubGlobal('__HERMES_PLUGINS__', { register: registerMock });
    vi.stubGlobal('__HERMES_PLUGIN_SDK__', {
      React: { createElement: React.createElement },
      hooks: {},
    });

    vi.resetModules();
    await import('./index');

    expect(registerMock).toHaveBeenCalledWith('hermes-pwa', expect.any(Function));
    const RegisteredComponent = registerMock.mock.calls[0][1] as React.ComponentType;
    // Render to exercise the class-based component branches
    const { unmount } = render(<RegisteredComponent />);
    unmount();
  });
});
