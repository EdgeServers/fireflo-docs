// Render the social preview card to images/og-card.png.
//
//     node scripts/make-og-card.mjs
//
// A link to docs.fireflo.au shared into Slack, Teams, LinkedIn or a search preview renders whatever
// og:image points at. There was no image and no og: block at all, so a shared link arrived as a bare
// URL. `docs.json` now declares this file at the 1200x630 that every platform crops from.
//
// Same headless-Chrome-over-CDP approach as capture-screenshots.mjs, and for the same reason: no npm
// dependency, nothing to keep up to date, and the card stays reproducible from the text below rather
// than living in someone's design tool. Unlike that script this one signs into nothing and reads no
// credential -- it renders a local string.
//
// The mark is inlined from logo/mark.svg at run time, so the card cannot drift from the logo the
// site header uses.

import { spawn } from "node:child_process";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";

const CHROME = process.env.CHROME_BIN ?? "/usr/bin/google-chrome";
const PORT = 9223;
const OUT = resolve(import.meta.dirname, "..", "images", "og-card.png");
const MARK = resolve(import.meta.dirname, "..", "logo", "mark.svg");

const WIDTH = 1200;
const HEIGHT = 630;

//the site's own primary, from docs.json. Kept literal rather than parsed: this is one value, and a
//JSON parse here would fail silently into a black card if the key ever moved
const PRIMARY = "#E2571E";

function card(markSvg) {
  //the mark is a data URI rather than inline SVG so its own width/height attributes cannot fight
  //the layout -- the img box decides, and the artwork scales into it
  const mark = `data:image/svg+xml;base64,${Buffer.from(markSvg).toString("base64")}`;
  return `<!doctype html>
<html><head><meta charset="utf-8"><style>
  * { margin: 0; padding: 0; box-sizing: border-box; }
  html, body { width: ${WIDTH}px; height: ${HEIGHT}px; }
  body {
    background: #0E110E;
    color: #F7F5F2;
    font-family: ui-sans-serif, system-ui, -apple-system, "Segoe UI", Roboto, sans-serif;
    display: flex; flex-direction: column;
    padding: 80px 96px; position: relative; overflow: hidden;
  }
  .glow {
    position: absolute; right: -180px; top: -180px; width: 620px; height: 620px;
    border-radius: 50%; background: ${PRIMARY}; opacity: 0.14; filter: blur(40px);
  }
  .mark { width: 84px; height: 84px; margin-bottom: 36px; }
  h1 { font-size: 72px; font-weight: 600; letter-spacing: -0.02em; line-height: 1.05; }
  h1 .accent { color: ${PRIMARY}; }
  /* wide enough to sit on one line at this size. At 20ch it broke into three and ran into the
     footer, which an absolute footer cannot push out of the way */
  p { font-size: 29px; line-height: 1.4; color: #B9B5AE; margin-top: 26px; max-width: 46ch; }
  /* in the flow with margin-top:auto rather than absolutely positioned, so the footer is pushed to
     the floor by the layout and can never be overlapped by content that grew */
  /* an explicit line-height, or the descenders in "fireflo" sit on the padding edge and read as
     clipped. This is the last line on a 1200x630 crop, so there is nothing below it to absorb them */
  .foot {
    margin-top: auto; font-size: 23px; line-height: 1.6; letter-spacing: 0.04em; color: #8A867F;
  }
</style></head>
<body>
  <div class="glow"></div>
  <img class="mark" src="${mark}" alt="">
  <h1>FireFlo<br><span class="accent">SMS/SMPP Gateway</span></h1>
  <p>Self-hosted. HTTP in, SMPP out, both directions.</p>
  <div class="foot">docs.fireflo.au</div>
</body></html>`;
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

function connect(url) {
  const ws = new WebSocket(url);
  const pending = new Map();
  let next = 1;
  ws.addEventListener("message", (m) => {
    const msg = JSON.parse(m.data);
    if (msg.id && pending.has(msg.id)) {
      const { resolve: ok, reject } = pending.get(msg.id);
      pending.delete(msg.id);
      msg.error ? reject(new Error(msg.error.message)) : ok(msg.result);
    }
  });
  return {
    ready: new Promise((ok) => ws.addEventListener("open", ok, { once: true })),
    send(method, params = {}, sessionId) {
      const id = next++;
      return new Promise((ok, reject) => {
        pending.set(id, { resolve: ok, reject });
        ws.send(JSON.stringify({ id, method, params, sessionId }));
      });
    },
    close: () => ws.close(),
  };
}

async function main() {
  const profile = `/tmp/fireflo-og-${process.pid}`;
  const chrome = spawn(CHROME, [
    "--headless=new",
    `--remote-debugging-port=${PORT}`,
    `--user-data-dir=${profile}`,
    `--window-size=${WIDTH},${HEIGHT}`,
    "--hide-scrollbars",
    "--disable-gpu",
    "--no-first-run",
  ]);
  chrome.on("error", (e) => {
    console.error(`Could not start ${CHROME}: ${e.message}`);
    process.exit(1);
  });

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

  const html = card(readFileSync(MARK, "utf8"));
  //a data: URL rather than a temp file, so nothing is left on disk to go stale
  await cdp.send(
    "Page.navigate",
    { url: `data:text/html;base64,${Buffer.from(html).toString("base64")}` },
    sessionId
  );
  await sleep(1200);

  //clip rather than captureBeyondViewport: the card is a fixed 1200x630 and every platform crops
  //to that ratio. A full-page shot would include whatever the body height rounded to
  const { data } = await cdp.send(
    "Page.captureScreenshot",
    { format: "png", clip: { x: 0, y: 0, width: WIDTH, height: HEIGHT, scale: 1 } },
    sessionId
  );
  mkdirSync(dirname(OUT), { recursive: true });
  writeFileSync(OUT, Buffer.from(data, "base64"));
  console.log(`wrote ${OUT} (${WIDTH}x${HEIGHT})`);

  cdp.close();
  chrome.kill();
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
