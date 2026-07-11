import { TopBar } from "@/components/TopBar";
import { ToastProvider } from "@/components/ui/Toast";

export default function DashboardLayout({ children }: { children: React.ReactNode }) {
  return (
    <ToastProvider>
      <div className="min-h-screen">
        <TopBar />
        <main className="mx-auto max-w-7xl px-6 py-8">{children}</main>
      </div>
    </ToastProvider>
  );
}
