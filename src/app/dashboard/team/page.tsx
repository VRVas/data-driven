import { redirect } from "next/navigation";
import { Reveal } from "@/components/Reveal";
import { PeopleSection } from "@/components/access/PeopleSection";
import { ProfilesSection } from "@/components/access/ProfilesSection";
import type { AccessPerson, ProfileChoice } from "@/components/access/UserAccessDrawer";
import { can, capabilities } from "@/lib/auth/authorize";
import { getSessionUser } from "@/lib/auth/guards";
import type { Profile } from "@/lib/auth/profiles";
import { assignmentForLegacyRole } from "@/lib/auth/resolve";
import { getProfileStore } from "@/lib/store/profiles";
import { getUserStore } from "@/lib/store/users";

export const dynamic = "force-dynamic";

export default async function TeamPage() {
  const me = await getSessionUser();
  if (!me) redirect("/login");
  if (!(await can("user:read"))) redirect("/dashboard");

  const [users, storedProfiles] = await Promise.all([getUserStore().list(), getProfileStore().list()]);
  const caps = await capabilities([
    "user:create",
    "user:deactivate",
    "profile:assign",
    "profile:create",
    "profile:update",
    "profile:delete",
  ] as const);

  const profiles: Profile[] = [...storedProfiles]
    .sort((a, b) => Number(b.system) - Number(a.system) || a.name.localeCompare(b.name))
    .map((p) => ({
      id: p.id,
      name: p.name,
      description: p.description,
      permissions: { ...p.permissions },
      superuser: p.superuser === true,
      system: p.system,
    }));
  const byId = new Map(profiles.map((p) => [p.id, p]));

  const people: AccessPerson[] = [...users]
    .sort((a, b) => (a.createdAt ?? "").localeCompare(b.createdAt ?? ""))
    .map((u) => {
      // Accounts created before profiles existed still resolve through their legacy role.
      const profileIds = u.assignment?.profileIds ?? assignmentForLegacyRole(u.role).profileIds;
      return {
        id: u.id,
        name: u.name,
        email: u.email,
        active: u.active !== false,
        isSelf: u.id === me.id,
        profileIds,
        profiles: profileIds.map((id) => ({ id, name: byId.get(id)?.name ?? id })),
      };
    });

  const choices: ProfileChoice[] = profiles.map((p) => ({
    id: p.id,
    name: p.name,
    description: p.description,
  }));

  return (
    <div className="space-y-8">
      <Reveal>
        <div className="eyebrow mb-2">Access control</div>
        <h1 className="font-display text-3xl font-semibold tracking-tight">Team</h1>
        <p className="mt-1 text-[var(--color-ink-muted)]">
          {people.length} {people.length === 1 ? "member" : "members"} - {profiles.length}{" "}
          {profiles.length === 1 ? "profile" : "profiles"}. Profiles decide what someone can do; assigning one is how
          access is granted.
        </p>
      </Reveal>

      <Reveal>
        <PeopleSection
          people={people}
          profiles={choices}
          canCreate={caps["user:create"]}
          canAssign={caps["profile:assign"]}
          canDeactivate={caps["user:deactivate"]}
        />
      </Reveal>

      <Reveal>
        <ProfilesSection
          profiles={profiles}
          canCreate={caps["profile:create"]}
          canUpdate={caps["profile:update"]}
          canDelete={caps["profile:delete"]}
        />
      </Reveal>
    </div>
  );
}
