#!/usr/bin/env node
//
// Captures the documentation screenshots from a running control panel.
//
//     OPERATOR_PASSWORD=... node scripts/capture-screenshots.mjs
//
// Or, to take the credentials from the panel's own environment file rather than typing them:
//
//     set -a; . /etc/fireflo-panel/panel.env; set +a
//     node scripts/capture-screenshots.mjs
//
// ---------------------------------------------------------------------------------------------
// WHY THIS EXISTS
//
// Twenty documentation pages describe screens that cannot be photographed without signing in, and
// the sign-in is a password that belongs to whoever operates the panel. This script is the seam:
// it reads the credentials from the environment you already have, and nobody else ever handles
// them. They are never written to a file, never logged, and never passed on a command line where
// `ps` would show them.
//
// It drives Chrome over the DevTools protocol using nothing but Node's own WebSocket, so there is
// no dependency to install and nothing to keep up to date.
//
// ---------------------------------------------------------------------------------------------
// BEFORE YOU RUN IT
//
//   1. Point it at a PRODUCTION build, not `next dev`. The development server stamps an indicator
//      badge into the corner of every page, and it lands in the screenshot.
//
//          cd ../fireflo-control-panel && npm run build && PORT=3002 npm start
//
//   2. Seed the demo data, or most of these screens photograph an empty state:
//
//          psql "$CONFIG_DATABASE_URL"  -v ON_ERROR_STOP=1 -f ../fireflo-sms-gateway/scripts/seed-india-dlt.sql
//          psql "$METRICS_DATABASE_URL" -v ON_ERROR_STOP=1 -f ../fireflo-sms-gateway/scripts/seed-demo-cdrs.sql
//
//   3. Set OPERATOR_USERNAME to something you are willing to publish. It is rendered in the
//      sidebar on every operator page, so whatever it says appears in every screenshot.
//
// ---------------------------------------------------------------------------------------------
// WHAT IT WILL NOT DO
//
// It never clicks a control that writes anything. No top-up, no rotation, no disconnect, no
// delete. Every route below is a read, and the two screens that can reveal a secret -- a rotated
// credential and the vendor password field -- are photographed only in their masked resting state.
// ---------------------------------------------------------------------------------------------

import { spawn } from "node:child_process";
import { mkdirSync, writeFileSync, rmSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { createHash, randomBytes } from "node:crypto";
import { execFileSync } from "node:child_process";

const PANEL = process.env.PANEL_URL ?? "http://localhost:3002";
const OUT = resolve(import.meta.dirname, "..", "images");
const USER = process.env.OPERATOR_USERNAME ?? "operator";
const PASS = process.env.OPERATOR_PASSWORD;
const CHROME = process.env.CHROME_BIN ?? "/usr/bin/google-chrome";
const PORT = 9222;

// The account the demo seed creates. Screens that need one customer use this.
const DEMO_ACCOUNT = process.env.DEMO_ACCOUNT ?? "acct-in-2001";

/** Route → image path, relative to images/. Order is the order they are visited. */
const OPERATOR = [
  ["/cp", "platform/control-panel/dashboard.png"],
  ["/cp/cdrs", "platform/control-panel/messages.png"],
  ["/cp/usage", "platform/control-panel/usage.png"],
  ["/cp/revenue", "platform/control-panel/revenue.png"],
  ["/cp/rejected", "platform/control-panel/refused.png"],
  ["/cp/queues", "platform/control-panel/queues.png"],
  ["/cp/receipts", "platform/control-panel/receipt-quality.png"],
  ["/cp/metrics", "platform/control-panel/runtime-metrics.png"],
  ["/cp/diagnostics", "platform/control-panel/diagnostics.png"],
  ["/cp/accounts", "platform/control-panel/accounts.png"],
  [`/cp/accounts/${DEMO_ACCOUNT}/billing`, "platform/control-panel/accounts-billing.png"],
];

const PORTAL = [
  ["/overview", "developers/portal/overview.png"],
  ["/messages", "developers/portal/messages.png"],
  ["/statement", "developers/portal/statement.png"],
  ["/senders", "developers/portal/senders.png"],
  ["/templates", "developers/portal/templates.png"],
  ["/playground", "developers/portal/playground.png"],
];

if (!PASS) {
  console.error(
    "OPERATOR_PASSWORD is not set. Source the panel's environment file first, or pass it in\n" +
      "the environment -- not as an argument, which would put it in your shell history."
  );
  process.exit(2);
}

// --------------------------------------------------------------------------------------------
// A very small DevTools protocol client. One socket, one id counter, promises keyed by id.
// --------------------------------------------------------------------------------------------
function connect(url) {
  const ws = new WebSocket(url);
  const pending = new Map();
  let next = 1;
  const events = new Map();

  ws.addEventListener("message", (m) => {
    const msg = JSON.parse(m.data);
    if (msg.id && pending.has(msg.id)) {
      const { ok, fail } = pending.get(msg.id);
      pending.delete(msg.id);
      msg.error ? fail(new Error(msg.error.message)) : ok(msg.result);
    } else if (msg.method && events.has(msg.method)) {
      events.get(msg.method).forEach((f) => f(msg.params));
      events.delete(msg.method);
    }
  });

  const ready = new Promise((ok) => ws.addEventListener("open", ok));

  return {
    ready,
    send(method, params = {}, sessionId) {
      const id = next++;
      return new Promise((ok, fail) => {
        pending.set(id, { ok, fail });
        ws.send(JSON.stringify({ id, method, params, sessionId }));
      });
    },
    once(method) {
      return new Promise((ok) => {
        if (!events.has(method)) events.set(method, []);
        events.get(method).push(ok);
      });
    },
    close: () => ws.close(),
  };
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function main() {
  const profile = `/tmp/fireflo-capture-${process.pid}`;
  const chrome = spawn(CHROME, [
    "--headless=new",
    `--remote-debugging-port=${PORT}`,
    `--user-data-dir=${profile}`,
    "--window-size=1280,860",
    "--hide-scrollbars",
    "--disable-gpu",
    "--no-first-run",
  ]);
  chrome.on("error", (e) => {
    console.error(`Could not start ${CHROME}: ${e.message}`);
    process.exit(1);
  });

  // wait for the debugging endpoint rather than guessing at a sleep
  let version;
  for (let i = 0; i < 60; i++) {
    try {
      version = await (await fetch(`http://localhost:${PORT}/json/version`)).json();
      break;
    } catch {
      await sleep(500);
    }
  }
  if (!version) throw new Error("Chrome never opened its debugging port");

  const cdp = connect(version.webSocketDebuggerUrl);
  await cdp.ready;

  const { targetId } = await cdp.send("Target.createTarget", { url: "about:blank" });
  const { sessionId } = await cdp.send("Target.attachToTarget", { targetId, flatten: true });
  await cdp.send("Page.enable", {}, sessionId);
  await cdp.send("Runtime.enable", {}, sessionId);

  const go = async (path) => {
    const loaded = cdp.once("Page.loadEventFired");
    await cdp.send("Page.navigate", { url: PANEL + path }, sessionId);
    await Promise.race([loaded, sleep(15000)]);
    // the panel fetches after load; give the first paint of real data a chance
    await sleep(2500);
  };

  const evaluate = (expression) =>
    cdp.send("Runtime.evaluate", { expression, awaitPromise: true }, sessionId);

  const shoot = async (file) => {
    const { data } = await cdp.send(
      "Page.captureScreenshot",
      { format: "png", captureBeyondViewport: true },
      sessionId
    );
    const full = resolve(OUT, file);
    mkdirSync(dirname(full), { recursive: true });
    writeFileSync(full, Buffer.from(data, "base64"));
    console.log(`  ${file}`);
  };

  // ------------------------------------------------------------------------------------------
  // Operator sign-in. React tracks input state itself, so setting `.value` is not enough -- the
  // native setter has to be called and an input event dispatched, or the form submits empty.
  // ------------------------------------------------------------------------------------------
  console.log("signing in as", USER);
  await go("/cp/login");
  await evaluate(`(() => {
    const set = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value").set;
    const type = (el, v) => { set.call(el, v); el.dispatchEvent(new Event("input", { bubbles: true })); };
    const [u, p] = [...document.querySelectorAll("input")].filter(
      i => i.type === "text" || i.type === "password");
    type(u, ${JSON.stringify(USER)});
    type(p, ${JSON.stringify(PASS)});
    document.querySelector("form").requestSubmit();
  })()`);
  await sleep(5000);

  const { result } = await evaluate("location.pathname");
  if (String(result.value).includes("/login")) {
    console.error(
      "Still on the sign-in page. The password was refused, or OPERATOR_PASSWORD is not the one\n" +
        "this panel was started with. Nothing was captured."
    );
    cdp.close();
    chrome.kill();
    rmSync(profile, { recursive: true, force: true });
    process.exit(1);
  }

  console.log("operator screens:");
  for (const [path, file] of OPERATOR) {
    await go(path);
    await shoot(file);
  }

  // ------------------------------------------------------------------------------------------
  // The customer portal. There is no operator-side link generator, and the public request form
  // needs working SMTP -- so where a database is reachable we mint a token the same way the panel
  // does and follow it. Skipped silently otherwise: the operator screens are the bulk of the set.
  //
  // A token is 32 random bytes, base64url; the row stores its SHA-256 as hex, and nothing else.
  // ------------------------------------------------------------------------------------------
  const db = process.env.CONFIG_DATABASE_URL;
  if (db) {
    const email = process.env.DEMO_EMAIL ?? "ops@sunrise-retail.example";
    const token = randomBytes(32).toString("base64url");
    const digest = createHash("sha256").update(token).digest("hex");
    try {
      execFileSync("psql", [db, "-v", "ON_ERROR_STOP=1", "-q", "-c",
        `INSERT INTO app_login_token (token_hash, account_id, expires_at)
         SELECT '${digest}', id, now() + interval '15 minutes'
           FROM app_account WHERE lower(email) = lower('${email}') AND enabled LIMIT 1`]);
      await go(`/verify?token=${token}`);
      await sleep(4000);
      console.log("portal screens:");
      for (const [path, file] of PORTAL) {
        await go(path);
        await shoot(file);
      }
    } catch (e) {
      console.warn(`  portal skipped: ${e.message.split("\n")[0]}`);
    }
  } else {
    console.log("portal skipped: set CONFIG_DATABASE_URL to capture it too");
  }

  cdp.close();
  chrome.kill();
  rmSync(profile, { recursive: true, force: true });
  console.log("\nDone. Check every image for anything that should not be published before committing.");
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
