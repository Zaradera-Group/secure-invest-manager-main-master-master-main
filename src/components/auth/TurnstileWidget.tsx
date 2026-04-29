import { useEffect, useId, useRef } from 'react';

declare global {
  interface Window {
    turnstile?: {
      render: (
        element: HTMLElement,
        options: {
          sitekey: string;
          callback: (token: string) => void;
          'expired-callback'?: () => void;
          'error-callback'?: (errorCode?: string) => void;
          appearance?: 'always' | 'execute' | 'interaction-only';
          execution?: 'render' | 'execute';
          size?: 'normal' | 'flexible' | 'compact';
          theme?: 'light' | 'dark' | 'auto';
        },
      ) => string;
      remove?: (widgetId: string) => void;
      reset?: (widgetId: string) => void;
    };
  }
}

const scriptId = 'cf-turnstile-script';
const TURNSTILE_SCRIPT_SRC = 'https://challenges.cloudflare.com/turnstile/v0/api.js?render=explicit';

const ensureScript = () =>
  new Promise<void>((resolve, reject) => {
    if (window.turnstile) {
      resolve();
      return;
    }

    const existing = document.getElementById(scriptId) as HTMLScriptElement | null;
    if (existing) {
      const existingState = existing.dataset.state;
      if (existingState === 'error') {
        existing.remove();
      } else {
        existing.addEventListener('load', () => resolve(), { once: true });
        existing.addEventListener('error', () => reject(new Error('Failed to load Turnstile')), { once: true });
        return;
      }
    }

    const script = document.createElement('script');
    script.dataset.state = 'loading';
    script.id = scriptId;
    script.src = TURNSTILE_SCRIPT_SRC;
    script.async = true;
    script.defer = true;
    script.onload = () => {
      script.dataset.state = 'ready';
      resolve();
    };
    script.onerror = () => {
      script.dataset.state = 'error';
      reject(new Error('Failed to load Turnstile'));
    };
    document.head.appendChild(script);
  });

const loadTurnstileWithRetry = async (attempts = 2) => {
  let lastError: Error | null = null;

  for (let attempt = 0; attempt < attempts; attempt += 1) {
    try {
      await ensureScript();
      return;
    } catch (error) {
      lastError = error instanceof Error ? error : new Error('Failed to load Turnstile');

      const existing = document.getElementById(scriptId);
      if (existing) {
        existing.remove();
      }

      if (attempt < attempts - 1) {
        await new Promise((resolve) => window.setTimeout(resolve, 800));
      }
    }
  }

  throw lastError ?? new Error('Failed to load Turnstile');
};

export function TurnstileWidget({
  siteKey,
  onToken,
  onStatusChange,
}: Readonly<{
  siteKey?: string;
  onToken: (token: string | null) => void;
  onStatusChange?: (status: string | null) => void;
}>) {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const widgetIdRef = useRef<string | null>(null);
  const fallbackId = useId();

  useEffect(() => {
    if (!siteKey || !containerRef.current) {
      onToken(null);
      onStatusChange?.(siteKey ? 'Turnstile container is unavailable.' : 'Turnstile site key is missing.');
      return;
    }

    let active = true;

    void loadTurnstileWithRetry()
      .then(() => {
        if (!active || !containerRef.current || !window.turnstile) {
          onStatusChange?.('Turnstile widget could not be initialized.');
          return;
        }

        onStatusChange?.(null);
        widgetIdRef.current = window.turnstile.render(containerRef.current, {
          sitekey: siteKey,
          execution: 'render',
          appearance: 'always',
          size: 'normal',
          callback: (token) => {
            onToken(token);
            onStatusChange?.(null);
          },
          'expired-callback': () => {
            onToken(null);
            onStatusChange?.('Human verification expired. Please complete the challenge again.');
          },
          'error-callback': (errorCode) => {
            onToken(null);
            onStatusChange?.(mapTurnstileClientError(errorCode));
          },
          theme: 'auto',
        });
      })
      .catch(() => {
        onToken(null);
        onStatusChange?.('Turnstile widget failed to load. Please wait a moment and try again after your network settles.');
      });

    return () => {
      active = false;
      if (widgetIdRef.current && window.turnstile?.remove) {
        window.turnstile.remove(widgetIdRef.current);
      }
      widgetIdRef.current = null;
    };
  }, [onToken, onStatusChange, siteKey]);

  if (!siteKey) {
    return (
      <div className="rounded-lg border border-amber-300 bg-amber-50 p-3 text-xs text-amber-900">
        Human verification is not configured yet. Add `VITE_TURNSTILE_SITE_KEY` to enable Turnstile.
      </div>
    );
  }

  return <div id={`turnstile-${fallbackId}`} ref={containerRef} />;
}

function mapTurnstileClientError(errorCode?: string) {
  switch (errorCode) {
    case '110200':
      return 'Turnstile hostname authorization failed. Add your current domain or localhost in Cloudflare.';
    case '100000':
      return 'Turnstile initialization failed. Refresh the page and try again.';
    default:
      return errorCode
        ? `Turnstile failed with code ${errorCode}.`
        : 'Turnstile encountered an unexpected widget error.';
  }
}
