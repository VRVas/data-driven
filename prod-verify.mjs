import { chromium } from "@playwright/test";

/**
 * Verify the deployed copilot against the real model.
 *
 * The local suite only ever reaches the offline provider, which is
 * deterministic and cannot show that a language model holds a subject across
 * turns. This is the first place the memory fix meets a real one.
 *
 * Read-only on purpose: it asks about leads that already exist and never
 * writes. The verification account is a member and a member cannot delete a
 * lead, so anything it created would be permanent litter in a real pipeline.
 */
const BASE = process.env.PROD_URL;
const EMAIL = process.env.PROD_EMAIL;
const PASSWORD = process.env.PROD_PASSWORD;

const results = [];
/** A reply that is JSON is the schema echoed back, never an answer. */
const isSchemaEcho = (text) => /\\"type\\":\\"object\\"|\\"properties\\":/.test(text);
const check = (label, ok, detail = "") => {
  results.push({ label, ok, detail });
  console.log(`${ok ? "PASS" : "FAIL"}  ${label}${detail ? ` - ${String(detail).slice(0, 170)}` : ""}`);
};

async function ask(request, message, conversationId) {
  const res = await request.post(`${BASE}/api/copilot/stream`, {
    data: { message, ...(conversationId ? { conversationId } : {}) },
    timeout: 180_000,
  });
  const body = await res.text();
  const blocks = [];
  let tools = [];
  let id = conversationId ?? null;
  let error = null;
  for (const chunk of body.split("\n\n")) {
    const event = /^event: (\w+)/m.exec(chunk)?.[1];
    const raw = /^data: (.*)$/m.exec(chunk)?.[1];
    if (!event || !raw) continue;
    try {
      const data = JSON.parse(raw);
      if (event === "block") blocks.push(data);
      if (event === "tools") tools = data;
      if (event === "done") id = data.conversationId ?? id;
      if (event === "error") {
        error = data.message;
        id = data.conversationId ?? id;
      }
    } catch {
      /* a partial frame is not a failure of the thing under test */
    }
  }
  return { status: res.status(), text: JSON.stringify(blocks), tools, conversationId: id, blocks, error };
}

const browser = await chromium.launch();
const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 } });
const page = await ctx.newPage();

try {
  await page.goto(`${BASE}/login`, { waitUntil: "domcontentloaded" });
  await page.locator('input[name="email"]').fill(EMAIL);
  await page.locator('input[name="password"]').fill(PASSWORD);
  await page.getByRole("button", { name: /sign in/i }).click();
  await page.waitForURL("**/dashboard", { timeout: 60_000 });
  check("signed in to the deployed app", true);

  const request = page.request;

  const t1 = await ask(request, "Tell me about the Alibaba lead");
  check("turn 1 answered", !t1.error && t1.blocks.length > 0, t1.error ?? `${t1.blocks.length} blocks`);
  check("turn 1 is about the lead asked for", /alibaba/i.test(t1.text));
  check("turn 1 grounded itself in a tool", Array.isArray(t1.tools) && t1.tools.length > 0, JSON.stringify(t1.tools));
  check("a conversation id came back", !!t1.conversationId);

  // THE test. Nothing in this message names a lead.
  const t2 = await ask(request, "why does it rank where it does?", t1.conversationId);
  check("turn 2 answered", !t2.error, t2.error ?? "");
  check("turn 2 resolves 'it' to the lead from turn 1", /alibaba/i.test(t2.text), t2.text.slice(0, 200));

  // Change of subject. A naive "remember the first lead" passes above and
  // fails here, which is why both halves are asserted.
  const t3 = await ask(request, "now tell me about Poste IT instead", t1.conversationId);
  check("turn 3 switches subject", !t3.error && /poste/i.test(t3.text), t3.error ?? t3.text.slice(0, 160));

  const t4 = await ask(request, "and who owns that one?", t1.conversationId);
  check("turn 4 follows the NEW subject", !t4.error && /poste/i.test(t4.text), t4.error ?? t4.text.slice(0, 200));
  check("turn 4 is an answer, not the schema echoed back", !isSchemaEcho(t4.text), t4.text.slice(0, 140));

  // Deeper, and referring back across several turns.
  const t5 = await ask(request, "compare the two of them on value", t1.conversationId);
  check("turn 5 knows which two", !t5.error && /poste/i.test(t5.text) && /alibaba/i.test(t5.text),
    t5.error ?? t5.text.slice(0, 220));

  // An incomplete write should be questioned, never guessed at.
  const t6 = await ask(request, "add a new lead called Northwind Traders", t1.conversationId);
  check("an incomplete write is questioned, not guessed", !t6.error && /\?/.test(t6.text),
    t6.error ?? t6.text.slice(0, 260));
  check("and nothing claims to have been created", !/(^|\W)(created|added)\b.*northwind/i.test(t6.text));
  check("turn 6 is an answer, not the schema echoed back", !isSchemaEcho(t6.text), t6.text.slice(0, 140));

  const t7 = await ask(request, "no, don't create it - what would you suggest for its value?", t1.conversationId);
  check("a suggestion is reasoned, not invented", !t7.error && t7.blocks.length > 0, t7.error ?? t7.text.slice(0, 220));
  check("turn 7 is an answer, not the schema echoed back", !isSchemaEcho(t7.text), t7.text.slice(0, 140));
} catch (e) {
  check("run completed without throwing", false, e instanceof Error ? e.message : String(e));
} finally {
  await browser.close();
}

const failed = results.filter((r) => !r.ok);
console.log(`\n${results.length - failed.length}/${results.length} checks passed`);
process.exit(failed.length ? 1 : 0);
