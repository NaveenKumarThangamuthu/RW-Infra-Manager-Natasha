"use client";
import { useSession } from "next-auth/react";

/** Compact app bar shown only on mobile (brand + user avatar). */
export default function MobileTopBar() {
  const { data } = useSession();
  const email = data?.user?.email ?? "";
  const initial = (data?.user?.name ?? email).charAt(0).toUpperCase() || "•";

  return (
    <header className="m-topbar">
      <div className="m-brand">
        <span className="dot" /> Natasha
      </div>
      {email && <span className="avatar">{initial}</span>}
    </header>
  );
}
