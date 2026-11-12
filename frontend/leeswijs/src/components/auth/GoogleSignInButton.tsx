import { useEffect, useRef, useState } from "react";

const GOOGLE_CLIENT_ID = (import.meta.env.VITE_GOOGLE_CLIENT_ID as string | undefined) ?? "";
const SCRIPT_SRC = "https://accounts.google.com/gsi/client";

interface GoogleCredentialResponse {
  credential: string;
}

interface GoogleIdApi {
  initialize: (options: {
    client_id: string;
    callback: (response: GoogleCredentialResponse) => void;
    ux_mode?: "popup" | "redirect";
    auto_select?: boolean;
  }) => void;
  renderButton: (parent: HTMLElement, options: Record<string, string | number>) => void;
}

declare global {
  interface Window {
    google?: { accounts?: { id?: GoogleIdApi } };
  }
}

let scriptPromise: Promise<void> | null = null;

function loadGoogleScript(): Promise<void> {
  if (window.google?.accounts?.id) return Promise.resolve();
  if (scriptPromise) return scriptPromise;
  scriptPromise = new Promise((resolve, reject) => {
    const existing = document.querySelector<HTMLScriptElement>(`script[src="${SCRIPT_SRC}"]`);
    if (existing) {
      existing.addEventListener("load", () => resolve());
      existing.addEventListener("error", () => reject(new Error("Google script failed to load")));
      return;
    }
    const script = document.createElement("script");
    script.src = SCRIPT_SRC;
    script.async = true;
    script.defer = true;
    script.onload = () => resolve();
    script.onerror = () => reject(new Error("Google script failed to load"));
    document.head.appendChild(script);
  });
  return scriptPromise;
}

export function isGoogleSignInEnabled() {
  return GOOGLE_CLIENT_ID.length > 0;
}

type Props = {
  text?: "signin_with" | "signup_with" | "continue_with";
  onCredential: (credential: string) => void;
  onError?: (message: string) => void;
};

export default function GoogleSignInButton({ text = "continue_with", onCredential, onError }: Props) {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const callbackRef = useRef(onCredential);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    callbackRef.current = onCredential;
  }, [onCredential]);

  useEffect(() => {
    if (!isGoogleSignInEnabled()) return;
    let cancelled = false;

    loadGoogleScript()
      .then(() => {
        if (cancelled || !containerRef.current) return;
        const api = window.google?.accounts?.id;
        if (!api) throw new Error("Google Sign-In is unavailable");
        api.initialize({
          client_id: GOOGLE_CLIENT_ID,
          callback: (response) => callbackRef.current(response.credential),
          ux_mode: "popup",
        });
        containerRef.current.innerHTML = "";
        const width = Math.min(400, Math.max(200, containerRef.current.clientWidth || 320));
        api.renderButton(containerRef.current, {
          type: "standard",
          theme: "outline",
          size: "large",
          shape: "pill",
          text,
          logo_alignment: "left",
          width,
        });
      })
      .catch((err: unknown) => {
        if (cancelled) return;
        setFailed(true);
        onError?.(err instanceof Error ? err.message : "Google Sign-In is unavailable.");
      });

    return () => {
      cancelled = true;
    };
  }, [text, onError]);

  if (!isGoogleSignInEnabled()) return null;

  return (
    <div className="flex flex-col items-center gap-2">
      <div ref={containerRef} className="flex w-full justify-center min-h-[44px]" />
      {failed && (
        <p className="text-xs font-body text-text/45">Google Sign-In could not be loaded.</p>
      )}
    </div>
  );
}
