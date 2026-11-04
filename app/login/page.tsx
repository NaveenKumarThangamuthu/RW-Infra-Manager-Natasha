"use client";
import { signIn } from "next-auth/react";
import { useSearchParams } from "next/navigation";
import { Suspense, useEffect, useState } from "react";
import NatashaLogo from "@/components/NatashaLogo";

function GoogleIcon() {
  return (
    <svg width="18" height="18" viewBox="0 0 48 48" aria-hidden>
      <path fill="#EA4335" d="M24 9.5c3.54 0 6.71 1.22 9.21 3.6l6.85-6.85C35.9 2.38 30.47 0 24 0 14.62 0 6.51 5.38 2.56 13.22l7.98 6.19C12.43 13.72 17.74 9.5 24 9.5z" />
      <path fill="#4285F4" d="M46.98 24.55c0-1.57-.15-3.09-.38-4.55H24v9.02h12.94c-.58 2.96-2.26 5.48-4.78 7.18l7.73 6c4.51-4.18 7.09-10.36 7.09-17.65z" />
      <path fill="#FBBC05" d="M10.53 28.59c-.48-1.45-.76-2.99-.76-4.59s.27-3.14.76-4.59l-7.98-6.19C.92 16.46 0 20.12 0 24c0 3.88.92 7.54 2.56 10.78l7.97-6.19z" />
      <path fill="#34A853" d="M24 48c6.48 0 11.93-2.13 15.89-5.81l-7.73-6c-2.15 1.45-4.92 2.3-8.16 2.3-6.26 0-11.57-4.22-13.47-9.91l-7.98 6.19C6.51 42.62 14.62 48 24 48z" />
    </svg>
  );
}

interface Provider { id: string; name: string }
function useAvailableProviders(): Set<string> {
  const [set, setSet] = useState<Set<string> | null>(null);
  useEffect(() => {
    let alive = true;
    fetch("/api/auth/providers")
      .then((r) => (r.ok ? r.json() : null))
      .then((j: Record<string, Provider> | null) => {
        if (alive) setSet(new Set(Object.keys(j ?? {})));
      })
      .catch(() => { if (alive) setSet(new Set()); });
    return () => { alive = false; };
  }, []);
  return set ?? new Set(["google"]);
}

function LoginCard() {
  const params = useSearchParams();
  const callbackUrl = params.get("callbackUrl") || "/";
  const urlError = params.get("error");
  const providers = useAvailableProviders();

  const [error, setError] = useState<string | null>(
    urlError === "AccessDenied"
      ? "This email isn't on the allowlist. Ask an admin to add you to `allowed_user` in the DB."
      : urlError
        ? "Sign-in failed. Please try again."
        : null,
  );
  const [googleBusy, setGoogleBusy] = useState(false);

  async function onGoogle() {
    setGoogleBusy(true);
    setError(null);
    await signIn("google", { callbackUrl });
    setGoogleBusy(false);
  }

  return (
      <div className="login-card">
        <div className="login-brand">
          <NatashaLogo size={36} />
          <div>
            <div className="brand-name" style={{ fontSize: 22 }}>Natasha</div>
            <div className="brand-sub">Infra Command Center</div>
          </div>
        </div>
        <h1 className="login-title">Welcome back</h1>
        <p className="login-sub">Sign in with your <b>@rw.team</b> Google account.</p>

        {error && <div className="login-error">{error}</div>}

        {providers.has("google") ? (
          <button
            type="button"
            className="btn-google"
            onClick={onGoogle}
            disabled={googleBusy}
          >
            <GoogleIcon />
            <span>{googleBusy ? "Redirecting to Google…" : "Sign in with Google"}</span>
          </button>
        ) : (
          <div className="login-error" style={{ background: "rgba(234,179,8,0.08)", borderColor: "rgba(234,179,8,0.35)", color: "#facc15" }}>
            Google sign-in isn&apos;t configured yet — set <code>GOOGLE_CLIENT_ID</code> + <code>GOOGLE_CLIENT_SECRET</code> and restart the server.
          </div>
        )}

        <p className="login-foot">Authorized users only · Access controlled via allowlist</p>
      </div>
  );
}

export default function LoginPage() {
  return (
    <div className="login-shell">
      <Suspense fallback={null}>
        <LoginCard />
      </Suspense>
    </div>
  );
}
