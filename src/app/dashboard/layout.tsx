import { TopBar } from "@/components/TopBar";
import { ToastProvider } from "@/components/ui/Toast";
import { TourProvider } from "@/components/tour/TourProvider";

export default function DashboardLayout({ children }: { children: React.ReactNode }) {
  return (
    <ToastProvider>
      <TourProvider autoStart>
        <div className="min-h-screen">
          <TopBar tour />
          <main className="mx-auto max-w-7xl px-6 py-8">{children}</main>
        </div>
      </TourProvider>
    </ToastProvider>
  );
}
