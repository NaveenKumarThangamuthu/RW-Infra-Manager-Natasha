export const dynamic = "force-dynamic";

export default function AccountPage() {
  return (
    <>
      <div className="page-head">
        <div>
          <h1 className="page-title">Account</h1>
          <p className="page-sub">Sign-in is handled via Google. Password auth was removed 2026-07-09.</p>
        </div>
      </div>
      <div className="panel" style={{ padding: 20 }}>
        <p style={{ margin: 0, color: "var(--muted)" }}>
          To change your Google-account password, visit <a href="https://myaccount.google.com/security" target="_blank" rel="noopener noreferrer">https://myaccount.google.com/security</a>.
          To be added or removed from the Natasha allowlist, ask an admin to edit the <code>allowed_user</code> table.
        </p>
      </div>
    </>
  );
}
