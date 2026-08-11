import { redirect } from "next/navigation";
import { Reveal } from "@/components/Reveal";
import { RoleControl } from "@/components/RoleControl";
import { getSessionUser } from "@/lib/auth/guards";
import { getUserStore } from "@/lib/store/users";

export const dynamic = "force-dynamic";

export default async function TeamPage() {
  const me = await getSessionUser();
  if (!me) redirect("/login");
  if (me.role !== "admin") redirect("/dashboard");

  const users = [...(await getUserStore().list())].sort(
    (a, b) => (a.createdAt ?? "").localeCompare(b.createdAt ?? ""),
  );
  const admins = users.filter((u) => u.role === "admin").length;

  return (
    <div className="space-y-8">
      <Reveal>
        <div className="eyebrow mb-2">Access control</div>
        <h1 className="font-display text-3xl font-semibold tracking-tight">Team</h1>
        <p className="mt-1 text-[var(--color-ink-muted)]">
          {users.length} {users.length === 1 ? "member" : "members"} · {admins} admin{admins === 1 ? "" : "s"}.
          Admins manage roles, delete leads and approve outreach.
        </p>
      </Reveal>

      <Reveal>
        <div className="glass overflow-hidden">
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="border-b border-[var(--color-border)]">
                <tr className="text-left">
                  <th className="eyebrow px-4 py-3 sm:px-6">Name</th>
                  <th className="eyebrow hidden px-4 py-3 sm:table-cell sm:px-6">Email</th>
                  <th className="eyebrow hidden px-4 py-3 md:table-cell sm:px-6">Joined</th>
                  <th className="eyebrow px-4 py-3 text-right sm:px-6">Role</th>
                </tr>
              </thead>
              <tbody>
                {users.map((u) => (
                  <tr key={u.id} className="border-t border-[var(--color-border)]">
                    <td className="px-4 py-3 font-medium sm:px-6">
                      {u.name}
                      {u.id === me.id && <span className="ml-2 text-xs text-[var(--color-ink-faint)]">you</span>}
                    </td>
                    <td className="hidden px-4 py-3 font-mono text-xs text-[var(--color-ink-muted)] sm:table-cell sm:px-6">{u.email}</td>
                    <td className="hidden px-4 py-3 tabular-nums text-[var(--color-ink-muted)] md:table-cell sm:px-6">
                      {u.createdAt ? u.createdAt.slice(0, 10) : "—"}
                    </td>
                    <td className="px-4 py-3 sm:px-6">
                      <div className="flex justify-end">
                        <RoleControl userId={u.id} role={u.role} />
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      </Reveal>
    </div>
  );
}
