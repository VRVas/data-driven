import NextAuth from "next-auth";
import Credentials from "next-auth/providers/credentials";
import authConfig from "./auth.config";
import { getUserStore } from "@/lib/store/users";
import { credentialsSchema, verifyPassword } from "@/lib/auth/password";
import { getChallengeStore } from "@/lib/store/challenges";
import { otpLoginEnabled } from "@/lib/auth/challenge";

export const { handlers, auth, signIn, signOut } = NextAuth({
  ...authConfig,
  providers: [
    Credentials({
      credentials: {
        email: { label: "Email", type: "email" },
        password: { label: "Password", type: "password" },
      },
      authorize: async (credentials) => {
        const parsed = credentialsSchema.safeParse(credentials);
        if (!parsed.success) return null;

        const { email, password } = parsed.data;
        const user = await getUserStore().findByEmail(email);
        if (!user) return null;

        const ok = await verifyPassword(password, user.passwordHash);
        if (!ok) return null;

        return { id: user.id, email: user.email, name: user.name, role: user.role };
      },
    }),
    // Sign-in by emailed code. Separate provider rather than a branch inside
    // the password one, so a request can never satisfy the password check by
    // supplying a code, or the reverse.
    Credentials({
      id: "otp",
      name: "Email code",
      credentials: {
        email: { label: "Email", type: "email" },
        code: { label: "Code", type: "text" },
      },
      authorize: async (credentials) => {
        // The last of the three gates: page, action, provider. Without this a
        // direct POST to the sign-in endpoint would still redeem codes.
        if (!otpLoginEnabled()) return null;

        const email = String(credentials?.email ?? "").trim().toLowerCase();
        const code = String(credentials?.code ?? "").trim();
        if (!email || !/^\d{6}$/.test(code)) return null;

        // Redeem first: it counts the attempt and burns the code, so a wrong
        // guess costs the attacker one of five whether the account exists or not.
        const redeemed = await getChallengeStore().redeem(email, "otp", code);
        if (!redeemed.ok) return null;

        const user = await getUserStore().findByEmail(email);
        if (!user || user.active === false) return null;

        return { id: user.id, email: user.email, name: user.name, role: user.role };
      },
    }),
  ],
});
