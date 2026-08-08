/**
 * Google Identity Services (GIS) loader — renders the official "Continue with
 * Google" button and yields the signed ID-token credential our API verifies
 * (POST /auth/google).
 *
 * Fully env-gated: without NEXT_PUBLIC_GOOGLE_CLIENT_ID the button never
 * renders and the gsi script is never loaded. The client ID is public by
 * design (it is the OAuth audience, not a secret).
 */

export const GOOGLE_CLIENT_ID = process.env['NEXT_PUBLIC_GOOGLE_CLIENT_ID'] ?? '';

/** The subset of the GIS API we use (the script has no bundled types). */
interface GsiCredentialResponse {
  credential: string;
}

interface GsiIdApi {
  initialize(config: {
    client_id: string;
    callback: (response: GsiCredentialResponse) => void;
    ux_mode?: 'popup' | 'redirect';
  }): void;
  renderButton(
    parent: HTMLElement,
    options: {
      type?: 'standard' | 'icon';
      theme?: 'outline' | 'filled_blue' | 'filled_black';
      size?: 'large' | 'medium' | 'small';
      text?: 'signin_with' | 'signup_with' | 'continue_with';
      shape?: 'rectangular' | 'pill';
      width?: number;
      logo_alignment?: 'left' | 'center';
    },
  ): void;
}

interface GsiWindow extends Window {
  google?: { accounts?: { id?: GsiIdApi } };
}

let scriptPromise: Promise<void> | null = null;

/** Inject the gsi/client script once; resolves when `google.accounts.id` exists. */
function loadGisScript(): Promise<void> {
  scriptPromise ??= new Promise<void>((resolvePromise, rejectPromise) => {
    if (typeof window === 'undefined') {
      rejectPromise(new Error('GIS can only load in the browser'));
      return;
    }
    if ((window as GsiWindow).google?.accounts?.id) {
      resolvePromise();
      return;
    }
    const script = document.createElement('script');
    script.src = 'https://accounts.google.com/gsi/client';
    script.async = true;
    script.defer = true;
    script.onload = () => resolvePromise();
    script.onerror = () => {
      scriptPromise = null; // allow a retry on the next render
      rejectPromise(new Error('Failed to load Google sign-in'));
    };
    document.head.appendChild(script);
  });
  return scriptPromise;
}

/**
 * Render the official Google button into `container`. `onCredential` receives
 * the raw ID-token credential to exchange at our API. No-op without a client ID.
 */
export async function renderGoogleButton(
  container: HTMLElement,
  onCredential: (credential: string) => void,
): Promise<void> {
  if (!GOOGLE_CLIENT_ID) return;
  await loadGisScript();
  const id = (window as GsiWindow).google?.accounts?.id;
  if (!id) throw new Error('Google sign-in unavailable');
  id.initialize({
    client_id: GOOGLE_CLIENT_ID,
    callback: (response) => onCredential(response.credential),
    ux_mode: 'popup',
  });
  id.renderButton(container, {
    type: 'standard',
    theme: 'filled_black',
    size: 'large',
    text: 'continue_with',
    shape: 'pill',
    logo_alignment: 'left',
  });
}
