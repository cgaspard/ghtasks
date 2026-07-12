// Frames the app-only demo clip (docs/marketing/video/demo-app.mp4) inside the
// same window-chrome + branded backdrop used for the stills, and re-records it
// so the framed demo matches the framed screenshots. NOT a test.
//
// Run after demo.spec.ts:  npx playwright test frame-video.spec.ts
import { test } from "@playwright/test";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const APP_MP4 = resolve("docs/marketing/video/demo-app.mp4");
const OUT_DIR = "docs/marketing/video/framed";

test("frame the demo", async ({ browser }) => {
  test.setTimeout(120_000);
  const b64 = readFileSync(APP_MP4).toString("base64");
  const dataUri = `data:video/mp4;base64,${b64}`;

  const html = `<!doctype html><html><head><meta charset="utf-8"><style>
    * { margin: 0; box-sizing: border-box; }
    .stage {
      width: 1000px; height: 1300px; padding: 80px 100px;
      background:
        radial-gradient(1000px 520px at 28% -8%, #1b2a4a, transparent 60%),
        radial-gradient(760px 420px at 112% 118%, #0f3326, transparent 55%),
        linear-gradient(160deg, #0c1220, #06080f);
      display: flex; align-items: center; justify-content: center;
    }
    .window {
      border-radius: 14px; overflow: hidden;
      box-shadow: 0 40px 90px rgba(0,0,0,0.55), 0 8px 24px rgba(0,0,0,0.4),
                  0 0 0 1px rgba(255,255,255,0.06);
      background: #0d1117;
    }
    .titlebar {
      height: 34px; display: flex; align-items: center; gap: 8px;
      padding: 0 14px; background: #161b22;
      border-bottom: 1px solid rgba(255,255,255,0.05);
      font-family: -apple-system, sans-serif;
    }
    .dot { width: 12px; height: 12px; border-radius: 50%; }
    .r { background: #ff5f57; } .y { background: #febc2e; } .g { background: #28c840; }
    .tb-title { flex: 1; text-align: center; color: #8b949e; font-size: 12px; margin-right: 48px; }
    video { display: block; width: 460px; height: auto; }
  </style></head><body>
    <div class="stage">
      <div class="window">
        <div class="titlebar">
          <span class="dot r"></span><span class="dot y"></span><span class="dot g"></span>
          <span class="tb-title">GitHub Tasks</span>
        </div>
        <video id="v" src="${dataUri}" muted autoplay playsinline></video>
      </div>
    </div>
  </body></html>`;

  const context = await browser.newContext({
    viewport: { width: 1000, height: 1300 },
    deviceScaleFactor: 1,
    recordVideo: { dir: OUT_DIR, size: { width: 1000, height: 1300 } },
  });
  const page = await context.newPage();
  await page.setContent(html, { waitUntil: "load" });
  // Restart the video from 0 and wait for it to finish once.
  await page.evaluate(() => {
    const v = document.getElementById("v") as HTMLVideoElement;
    v.currentTime = 0;
    return v.play();
  });
  await page.waitForFunction(
    () => {
      const v = document.getElementById("v") as HTMLVideoElement;
      return v.currentTime >= v.duration - 0.1;
    },
    { timeout: 60_000 },
  );
  await context.close(); // flush framed video to disk
});
