// Frames raw app screenshots (docs/marketing/shots/*.png) onto a branded
// backdrop with a floating window-chrome treatment. NOT a test. Produces
// docs/marketing/framed/*.png for the README + landing page hero imagery.
//
// Run after capture.spec.ts:  npx playwright test frame.spec.ts
import { test } from "@playwright/test";
import { readFileSync, mkdirSync } from "node:fs";
import { resolve } from "node:path";

const SHOTS = resolve("docs/marketing/shots");
const OUT = resolve("docs/marketing/framed");
mkdirSync(OUT, { recursive: true });

// Each shot -> a gradient backdrop pairing (brand blue / violet / green tints).
const FRAMES: { name: string; grad: [string, string]; title: string }[] = [
  { name: "projects", grad: ["#1b2a4a", "#0c1220"], title: "GitHub Tasks — Projects" },
  { name: "issues", grad: ["#241b4a", "#0c1220"], title: "GitHub Tasks — Issues" },
  { name: "inbox", grad: ["#0f3326", "#0c1220"], title: "GitHub Tasks — Inbox" },
  { name: "inbox-filter", grad: ["#0f3326", "#0c1220"], title: "GitHub Tasks — Inbox" },
  { name: "projects-status-filter", grad: ["#1b2a4a", "#0c1220"], title: "GitHub Tasks" },
  { name: "new-issue", grad: ["#2a1b4a", "#0c1220"], title: "GitHub Tasks — New issue" },
  { name: "settings", grad: ["#22304a", "#0c1220"], title: "GitHub Tasks — Settings" },
];

function framedHtml(dataUri: string, grad: [string, string], title: string): string {
  return `<!doctype html><html><head><meta charset="utf-8"><style>
  * { margin: 0; box-sizing: border-box; }
  html, body { width: 100%; height: 100%; }
  .stage {
    width: 1000px; padding: 48px 56px;
    background:
      radial-gradient(1100px 560px at 30% -12%, ${grad[0]}, transparent 60%),
      radial-gradient(820px 460px at 112% 118%, ${grad[0]}, transparent 55%),
      linear-gradient(160deg, ${grad[1]}, #06080f);
    display: flex; align-items: center; justify-content: center;
    font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
  }
  .window {
    border-radius: 16px; overflow: hidden;
    box-shadow: 0 44px 100px rgba(0,0,0,0.6), 0 10px 28px rgba(0,0,0,0.45),
                0 0 0 1px rgba(255,255,255,0.08);
    background: #0d1117;
  }
  .titlebar {
    height: 40px; display: flex; align-items: center; gap: 9px;
    padding: 0 16px; background: #161b22;
    border-bottom: 1px solid rgba(255,255,255,0.06);
  }
  .dot { width: 13px; height: 13px; border-radius: 50%; }
  .r { background: #ff5f57; } .y { background: #febc2e; } .g { background: #28c840; }
  .tb-title {
    flex: 1; text-align: center; color: #9aa4b2; font-size: 13.5px; font-weight: 500;
    margin-right: 55px; /* balance the 3 dots on the left */
  }
  /* App renders larger so its text is legible at the sizes shown on the site. */
  img { display: block; width: 780px; height: auto; }
  </style></head><body>
  <div class="stage">
    <div class="window">
      <div class="titlebar">
        <span class="dot r"></span><span class="dot y"></span><span class="dot g"></span>
        <span class="tb-title">${title}</span>
      </div>
      <img src="${dataUri}" />
    </div>
  </div></body></html>`;
}

test.use({ viewport: { width: 1000, height: 1100 }, deviceScaleFactor: 2 });

test("frame all shots", async ({ page }) => {
  for (const f of FRAMES) {
    const png = readFileSync(`${SHOTS}/${f.name}.png`);
    const dataUri = `data:image/png;base64,${png.toString("base64")}`;
    await page.setContent(framedHtml(dataUri, f.grad, f.title), {
      waitUntil: "load",
    });
    const stage = page.locator(".stage");
    await stage.screenshot({ path: `${OUT}/${f.name}.png` });
  }
});
