/**
 * NextAuth configuration — Google Sign-In ONLY.
 *
 * Password/credentials auth was removed 2026-07-09. All sign-in must go
 * through Google OAuth; the allowed_user table gates who can complete the flow.
 *
 * Allowlist gate: only emails present in `allowed_user` with `active = true`
 * may sign in. Enforced in the `signIn` callback so it applies to Google and
 * any future provider.
 *
 * Environment:
 *   GOOGLE_CLIENT_ID       — from Google Cloud Console → OAuth 2.0 Client ID
 *   GOOGLE_CLIENT_SECRET   — pair with the above
 *   NEXTAUTH_URL           — public origin (must match Google OAuth Redirect URI)
 *   NEXTAUTH_SECRET        — random 32+ char string for JWT signing
 *
 * JWT sessions are used, so no adapter/session tables are needed.
 */
import type { NextAuthOptions } from "next-auth";
import type { Provider } from "next-auth/providers/index";
import GoogleProvider from "next-auth/providers/google";
import { prisma } from "./db";

function buildProviders(): Provider[] {
  const list: Provider[] = [];
  if (process.env.GOOGLE_CLIENT_ID && process.env.GOOGLE_CLIENT_SECRET) {
    list.push(
      GoogleProvider({
        clientId: process.env.GOOGLE_CLIENT_ID,
        clientSecret: process.env.GOOGLE_CLIENT_SECRET,
        // Force the Google account picker every time — avoids silently reusing a
        // stale session from a personal browser account.
        authorization: { params: { prompt: "select_account" } },
      }),
    );
  }
  return list;
}

export const authOptions: NextAuthOptions = {
  providers: buildProviders(),
  session: { strategy: "jwt" },
  pages: {
    signIn: "/login",
    error: "/login",
  },
  callbacks: {
    // Gate every sign-in on the `allowed_user` allowlist. Provider-agnostic.
    async signIn({ user }) {
      const email = user.email?.trim().toLowerCase();
      if (!email) return false;
      const allowed = await prisma.allowedUser.findFirst({
        where: { email, active: true },
        select: { id: true },
      });
      return Boolean(allowed);
    },
    // Persist the Google profile picture into the JWT so the session can serve it.
    async jwt({ token, profile, user }) {
      // On initial sign-in `profile.picture` is set (Google); afterwards use whatever's in the token.
      const picture =
        (profile as { picture?: string } | undefined)?.picture ??
        (user as { image?: string } | undefined)?.image ??
        (token as { picture?: string }).picture;
      if (picture) (token as { picture?: string }).picture = picture;
      return token;
    },
    async session({ session, token }) {
      if (session.user) {
        if (token.email) session.user.email = token.email;
        if (token.name) session.user.name = token.name;
        const pic = (token as { picture?: string }).picture;
        if (pic) session.user.image = pic;
      }
      return session;
    },
  },
};
