// Probe the DEPLOYED copilot on what this wave changed.
//
// prod-verify.mjs covers the things that were already true. This covers the
// things that became true: the renamed stages, High/Medium/Low, the two-part
// notes, and the surfaces that were removed. Every check asks the live model a
// question a user would actually ask, and looks at what it answered with.
import { chromium } from "playwright";
import { readFileSync } from "node:fs";

const BASE = process.env.PROD_URL;
const [EMAIL, PASSWORD] = readFileSync(process.env.PROD_CREDS ?? "/tmp/.pv", "utf8").trim().split("\n");
if (!BASE) throw new Error("PROD_URL is required");

const results = [];
const check = (label, ok, detail = "") => {
  results.push({ label, ok });
  console.log(`${ok ? "PASS" : "FAIL"}  ${label}${detail ? ` - ${String(detail).slice(0, 200)}` : ""}`);
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
      if (event === "error") error = data.message;
    } catch {
      /* a partial frame is not a failure of the thing under test */
    }
  }
  return { text: JSON.stringify(blocks), tools: tools.map((t) => t.tool ?? t), conversationId: id, error };
}

const RETIRED = ["Deal Closed", "Did not work out", "Back to Attack", "Still to open", "Hot Lead", "Warm Lead", "Cold Lead"];

const browser = await chromium.launch();
const page = await (await browser.newContext()).newPage();

try {
  await page.goto(`${BASE}/login`, { waitUntil: "domcontentloaded", timeout: 90_000 });
  await page.locator("input[name=email]").fill(EMAIL);
  await page.locator("input[name=password]").fill(PASSWORD);
  await page.getByRole("button", { name: /sign in|log in/i }).first().click();
  await page.waitForURL(/dashboard/, { timeout: 90_000 });
  check("signed in to the deployed app", true);
  const request = page.request;

  // --- the renamed stages -------------------------------------------------
  const stages = await ask(request, "What pipeline stages exist and what does each one mean?");
  check("it describes the stages", !stages.error, stages.error ?? "");
  const named = ["Seed", "Qualify lead", "Shape proposal", "Closed deal", "Lost"].filter((s) =>
    stages.text.toLowerCase().includes(s.toLowerCase()),
  );
  check(`it names the new stages (${named.length}/5)`, named.length >= 4, named.join(", "));
  const ghosts = RETIRED.filter((s) => stages.text.includes(s));
  check("it does not offer a stage that no longer exists", ghosts.length === 0, ghosts.join(", "));

  // --- the renamed priorities ---------------------------------------------
  const hot = await ask(request, "Show me the hot leads");
  check("it still understands the old word for priority", !hot.error, hot.error ?? "");
  const oldLabels = ["Hot Lead", "Warm Lead", "Cold Lead"].filter((s) => hot.text.includes(s));
  check("but answers in High/Medium/Low", oldLabels.length === 0, oldLabels.join(", "));

  // --- lost is a real outcome ---------------------------------------------
  const lost = await ask(request, "How many leads did we lose, and what were they worth?");
  check("Lost is a real outcome it can count", !lost.error && /lost/i.test(lost.text), lost.error ?? "");

  // --- the two-part notes --------------------------------------------------
  const notesQ = await ask(request, "What is the difference between a lead's initial note and its notes thread?");
  const explains =
    /initial note/i.test(notesQ.text) && /(thread|append|entries)/i.test(notesQ.text);
  check("it explains the two-part notes model", explains, notesQ.text.slice(0, 160));

  const write = await ask(
    request,
    "On the lead Alibaba, note that they asked about phased pricing. Do it now.",
  );
  check("adding to notes goes through append_note, not update_lead", write.tools.includes("append_note"), write.tools.join(", "));
  check("it did not overwrite the initial note", !write.tools.includes("update_lead"), write.tools.join(", "));

  const read = await ask(request, "What is the latest on Alibaba?");
  check("it reads the thread back", read.tools.includes("read_notes"), read.tools.join(", "));
  check("and finds what was just written", /phased pricing/i.test(read.text), read.text.slice(0, 160));

  const find = await ask(request, "Which lead mentions phased pricing?");
  check("a note in the thread is findable by searching", /alibaba/i.test(find.text), find.text.slice(0, 160));

  // --- surfaces that were removed -----------------------------------------
  const gone = await ask(request, "Add a comment to Alibaba saying the client went quiet.");
  check("no tool claims to add a comment", !gone.tools.some((t) => /comment/i.test(t)), gone.tools.join(", "));

  // --- the counts it quotes about itself ----------------------------------
  const self = await ask(request, "How many permissions does this app have, and how many tools do you have?");
  check("it quotes 47 permissions", /\b47\b/.test(self.text), self.text.slice(0, 200));
  check("it quotes 49 tools", /\b49\b/.test(self.text), self.text.slice(0, 200));

  // --- house style ---------------------------------------------------------
  const style = await ask(request, "Summarise the pipeline in two sentences.");
  check("it writes without em dashes or middle dots", !/[\u2014\u2013\u00b7]/.test(style.text), style.text.slice(0, 160));
} finally {
  await browser.close();
}

const failed = results.filter((r) => !r.ok);
console.log(`\n${results.length - failed.length}/${results.length} checks passed`);
if (failed.length) {
  console.log(`FAILED: ${failed.map((f) => f.label).join(" | ")}`);
  process.exitCode = 1;
}
