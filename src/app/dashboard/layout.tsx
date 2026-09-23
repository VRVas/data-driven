import { TopBar } from "@/components/TopBar";
import { ToastProvider } from "@/components/ui/Toast";
import { TourProvider } from "@/components/tour/TourProvider";
import { CommandPalette } from "@/components/CommandPalette";
import { SmoothScrollProvider } from "@/lib/gsap/SmoothScrollProvider";
import { auth, signOut } from "@/auth";
import { capabilities } from "@/lib/auth/authorize";
import { getVisibleBrands } from "@/lib/leads/visible";
import { recoveryState } from "@/lib/recovery/control";
import { getSessionUser } from "@/lib/auth/guards";
import { redirect } from "next/navigation";

export default async function DashboardLayout({ children }: { children: React.ReactNode }) {
  if ((await recoveryState()).mode !== "ready") redirect("/recovery");
  if (!(await getSessionUser())) redirect("/login");
  const session = await auth();
  // Same two gates the top bar uses. The legacy role claim is not one of them:
  // it stays "member" no matter which profile the user holds.
  const caps = session?.user
    ? await capabilities(["audit:read", "user:read"] as const)
    : { "audit:read": false, "user:read": false };

  let leads: { id: string; name: string }[] = [];
  try {
    leads = (await getVisibleBrands()).map((b) => ({ id: b.id, name: b.name }));
  } catch {
    leads = [];
  }

  async function signOutAction() {
    "use server";
    await signOut({ redirectTo: "/" });
  }

  return (
    <ToastProvider>
      <TourProvider autoStart>
        {/* Outside the smoother: ScrollSmoother transforms its content, which
            would defeat a sticky/fixed header. */}
        <TopBar tour fixed />
        <SmoothScrollProvider>
          <main className="mx-auto max-w-7xl px-6 pb-8 pt-24">{children}</main>
        </SmoothScrollProvider>
        <CommandPalette
          leads={leads}
          canSeeActivity={caps["audit:read"]}
          canSeeTeam={caps["user:read"]}
          signOutAction={signOutAction}
        />
      </TourProvider>
    </ToastProvider>
  );
}
