"use client";

import Link from "next/link";
import { authClient } from "@/components/auth-client";

export default function AuthAccount() {
  const { data, isPending } = authClient.useSession();
  if (isPending) return <span className="auth-account-placeholder" aria-label="Checking account"/>;
  if (!data?.user) return <Link className="btn small" href="/auth/sign-in">Sign in</Link>;
  return (
    <div className="auth-account">
      <span className="avatar-mini" aria-hidden="true">{data.user.name?.slice(0, 1).toUpperCase() || "R"}</span>
      <Link className="auth-account-name" href="/?view=profile" aria-label="Open your profile">{data.user.name || data.user.email}</Link>
      <button className="btn small" onClick={() => void authClient.signOut()}>Sign out</button>
    </div>
  );
}
