import { createRecoverySession, recoveryCookie, recoveryFailure, recoveryPermission, sameOrigin } from "@/lib/recovery/auth";
import { changeControl } from "@/lib/recovery/control";
import { recoveryJson, recoveryResponse } from "@/lib/recovery/http";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(request: Request) {
  try {
    sameOrigin(request);
    const { token, session } = await createRecoverySession(await recoveryJson(request));
    const response = recoveryResponse({ authenticated: true, actor: session.actor.name, permissions: session.permissions, expiresAt: session.expiresAt });
    response.headers.set("set-cookie", `${recoveryCookie()}=${token}; Path=/; HttpOnly; SameSite=Strict; Max-Age=1800${process.env.NODE_ENV === "production" ? "; Secure" : ""}`);
    return response;
  } catch (error) { return recoveryFailure(error); }
}

export async function DELETE(request: Request) {
  try {
    const session = await recoveryPermission("data:backup", request);
    await changeControl<typeof session>(session.id, (current) => ({ ...current, expiresAt: new Date(0).toISOString() }));
    const response = recoveryResponse({ authenticated: false });
    response.headers.set("set-cookie", `${recoveryCookie()}=; Path=/; HttpOnly; SameSite=Strict; Max-Age=0${process.env.NODE_ENV === "production" ? "; Secure" : ""}`);
    return response;
  } catch (error) { return recoveryFailure(error); }
}