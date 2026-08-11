import { TopBar } from "@/components/TopBar";
import { ToastProvider } from "@/components/ui/Toast";
import { TourProvider } from "@/components/tour/TourProvider";
import { CommandPalette } from "@/components/CommandPalette";
import { SmoothScrollProvider } from "@/lib/gsap/SmoothScrollProvider";
import { auth, signOut } from "@/auth";
import { getBrands } from "@/lib/data";

export default async function DashboardLayout({ children }: { children: React.ReactNode }) {
  const session = await auth();
  const isAdmin = session?.user?.role === "admin";

  let leads: { id: string; name: string }[] = [];
  try {
    leads = (await getBrands()).map((b) => ({ id: b.id, name: b.name }));
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
        <CommandPalette leads={leads} isAdmin={isAdmin} signOutAction={signOutAction} />
      </TourProvider>
    </ToastProvider>
  );
}
