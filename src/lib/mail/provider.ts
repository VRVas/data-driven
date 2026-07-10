import "server-only";

/**
 * Email delivery behind a provider seam.
 *
 *  - Local dev / no cloud: `LocalOutboxProvider` captures the message (the
 *    outreach store is the outbox) and reports success — nothing leaves the box.
 *  - Production: `AcsEmailProvider` sends via Azure Communication Services.
 *    Prefers managed identity (ACS_ENDPOINT + DefaultAzureCredential, keyless /
 *    MCAPS-friendly); falls back to ACS_CONNECTION_STRING when provided.
 *
 * Switching is automatic based on env — the rest of the app never changes.
 */
export interface EmailMessage {
  to: string;
  toName?: string;
  subject: string;
  body: string; // plain text
}

export interface SendResult {
  ok: boolean;
  provider: string;
  messageId?: string;
  error?: string;
}

export interface EmailProvider {
  readonly name: string;
  send(msg: EmailMessage): Promise<SendResult>;
}

class LocalOutboxProvider implements EmailProvider {
  readonly name = "local-outbox";
  async send(msg: EmailMessage): Promise<SendResult> {
    // No real delivery — the outreach record IS the outbox entry.
    return { ok: true, provider: this.name, messageId: `outbox-${Date.now().toString(36)}` };
  }
}

class AcsEmailProvider implements EmailProvider {
  readonly name = "acs";
  async send(msg: EmailMessage): Promise<SendResult> {
    const sender = process.env.ACS_SENDER_ADDRESS;
    if (!sender) return { ok: false, provider: this.name, error: "ACS_SENDER_ADDRESS is not set" };

    try {
      // Dynamic import so the ACS SDK is only loaded when actually configured.
      const { EmailClient } = await import("@azure/communication-email");
      const endpoint = process.env.ACS_ENDPOINT;
      const connectionString = process.env.ACS_CONNECTION_STRING;

      let client: InstanceType<typeof EmailClient>;
      if (endpoint) {
        const { DefaultAzureCredential } = await import("@azure/identity");
        client = new EmailClient(endpoint, new DefaultAzureCredential());
      } else if (connectionString) {
        client = new EmailClient(connectionString);
      } else {
        return { ok: false, provider: this.name, error: "ACS endpoint / connection string missing" };
      }

      const poller = await client.beginSend({
        senderAddress: sender,
        content: { subject: msg.subject, plainText: msg.body },
        recipients: { to: [{ address: msg.to, displayName: msg.toName }] },
      });
      const result = await poller.pollUntilDone();
      return { ok: result.status === "Succeeded", provider: this.name, messageId: result.id };
    } catch (err) {
      return { ok: false, provider: this.name, error: err instanceof Error ? err.message : "send failed" };
    }
  }
}

export function isAcsConfigured(): boolean {
  return !!(process.env.ACS_ENDPOINT || process.env.ACS_CONNECTION_STRING) && !!process.env.ACS_SENDER_ADDRESS;
}

let provider: EmailProvider | undefined;

export function getEmailProvider(): EmailProvider {
  if (provider) return provider;
  provider = isAcsConfigured() ? new AcsEmailProvider() : new LocalOutboxProvider();
  return provider;
}
