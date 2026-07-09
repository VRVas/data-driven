import { TopBar } from "@/components/TopBar";

export default function DashboardLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className="min-h-screen">
      <TopBar active="Overview" />
      <main className="mx-auto max-w-7xl px-6 py-8">{children}</main>
    </div>
  );
}
