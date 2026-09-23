import { z } from "zod";
import { SYSTEM_PROFILES, type Profile, type Assignment } from "@/lib/auth/profiles";
import { resolvePermissions } from "@/lib/auth/effective";
import { CONTAINERS, emptyContainer } from "./datasets";
import { RecoveryError, portableDocument, type BackupContainer, type Document } from "./package";

export type ImportMode = "full" | "crm";
export interface ImportChange { container: string; count: number; reason: string }
const BUSINESS = new Set(["brands", "agents", "industries", "crm", "notes", "comments"]);

export function prepareImport(source: BackupContainer[], mode: ImportMode, current: BackupContainer[], now = Date.now()): { containers: BackupContainer[]; changes: ImportChange[]; warnings: string[] } {
  const changes: ImportChange[] = [];
  const warnings: string[] = [];
  const containers = source.map((container) => structuredClone(container));
  if (mode === "crm") {
    for (let index = containers.length - 1; index >= 0; index--) {
      if (!BUSINESS.has(containers[index].definition.id)) containers.splice(index, 1);
    }
    for (const name of ["users", "profiles", "audit"]) {
      const existing = current.find((container) => container.definition.id === name);
      if (existing) containers.push(structuredClone(existing));
    }
    changes.push({ container: "CRM reset", count: 0, reason: "Current users, profiles and audit are retained. Personal views, conversations, document links and delivery queues are cleared." });
  }
  for (const name of Object.keys(CONTAINERS)) if (!containers.some((container) => container.definition.id === name)) containers.push(emptyContainer(name));
  for (const container of containers) {
    const name = container.definition.id;
    if (CONTAINERS[name] && JSON.stringify(container.definition.partitionKey.paths) !== JSON.stringify([CONTAINERS[name].key])) {
      throw new RecoveryError("incompatible_partition", `The ${name} partition key is incompatible with this application.`);
    }
    if (Object.values(container.scripts).some((scripts) => scripts.length)) throw new RecoveryError("scripts_require_review", "Executable database scripts require a reviewed operator migration.");
    const originals = container.items;
    if (["authChallenges", "copilotIntegrations", "documents"].includes(name)) {
      if (originals.length) changes.push({ container: name, count: originals.length, reason: name === "documents" ? "External file references are detached; uploaded Foundry files are not contained in this backup." : "Credentials, callbacks and queued integration work are not reactivated." });
      container.items = [];
      continue;
    }
    container.items = originals.flatMap((raw) => {
      const item = portableDocument(raw);
      const ttl = typeof raw.ttl === "number" ? raw.ttl : typeof container.definition.defaultTtl === "number" ? container.definition.defaultTtl : -1;
      if (ttl > 0 && container.definition.defaultTtl != null) {
        const remaining = Math.floor(Number(raw._ts) + ttl - now / 1000);
        if (!Number.isFinite(remaining)) throw new RecoveryError("invalid_ttl", `The ${name} TTL timestamp is missing.`);
        if (remaining <= 0) { changes.push({ container: name, count: 1, reason: "Expired document omitted." }); return []; }
        item.ttl = remaining;
      }
      if (name === "reminders" && ["scheduled", "sending", "failed"].includes(String(item.status))) {
        item.status = "cancelled"; item.error = "Delivery paused by backup import.";
        changes.push({ container: name, count: 1, reason: "Pending reminder cancelled to prevent duplicate delivery." });
      }
      if (name === "outreach" && item.status !== "sent" && item.status !== "cancelled") {
        item.status = "cancelled"; item.error = "Delivery paused by backup import.";
        changes.push({ container: name, count: 1, reason: "Unsent outreach cancelled for review." });
      }
      return [item];
    });
  }
  const leads = new Set(containers.find((container) => container.definition.id === "brands")!.items.map((item) => item.id));
  const users = containers.find((container) => container.definition.id === "users")!.items;
  const userIds = new Set(users.map((item) => item.id));
  const profiles = new Map<string, Profile>(SYSTEM_PROFILES.map((profile) => [profile.id, profile]));
  for (const item of containers.find((container) => container.definition.id === "profiles")!.items) profiles.set(item.id, item as unknown as Profile);
  let hasAdmin = false;
  const emails = new Set<string>();
  for (const user of users) {
    const parsed = z.object({ email: z.string().email(), name: z.string().min(1), passwordHash: z.string().regex(/^\$2[aby]\$\d{2}\$.{53}$/), role: z.enum(["admin", "member"]) }).safeParse(user);
    if (!parsed.success || emails.has(String(user.email).toLowerCase())) throw new RecoveryError("invalid_user", "The backup contains an invalid or duplicate user account.");
    emails.add(String(user.email).toLowerCase());
    const assignment = user.assignment as Assignment | undefined ?? { profileIds: [user.role === "admin" ? "administrator" : "sales-rep"] };
    if (!Array.isArray(assignment.profileIds) || assignment.profileIds.some((id) => !profiles.has(id))) throw new RecoveryError("missing_profile", "A restored account references a missing permission profile.");
    const effective = resolvePermissions(assignment.profileIds.map((id) => profiles.get(id)!), assignment);
    if (effective.superuser && user.active !== false) hasAdmin = true;
  }
  if (!hasAdmin) throw new RecoveryError("administrator_required", "The resulting dataset must contain an active administrator account.");
  for (const container of containers) for (const item of container.items) {
    if (container.definition.id === "brands" && (typeof item.name !== "string" || !item.name)) throw new RecoveryError("invalid_lead", "A lead is missing its name.");
    const leadReference = container.definition.id === "notes" ? item.leadId : container.definition.id === "comments" ? item.recordId : container.definition.id === "crm" ? item.dealId : undefined;
    if (leadReference && !leads.has(String(leadReference))) throw new RecoveryError("missing_relationship", `${container.definition.id} references a lead absent from the package.`);
    const userReference = ["conversations", "savedViews", "notifications"].includes(container.definition.id) ? item.userId : container.definition.id === "reminders" ? item.ownerId : undefined;
    if (userReference && !userIds.has(String(userReference))) warnings.push(`${container.definition.id}: historical record references an absent user.`);
  }
  return { containers, changes, warnings: [...new Set(warnings)] };
}