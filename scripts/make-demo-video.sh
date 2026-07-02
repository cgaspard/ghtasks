#!/usr/bin/env bash
# Regenerates the marketing demo video (docs/marketing/video/demo.mp4 + .gif).
#
# Pipeline:
#   1. demo.spec.ts        — record the app walkthrough (docs/marketing/video/raw/*.webm)
#   2. ffmpeg              — transcode raw webm -> app-only mp4
#   3. frame-video.spec.ts — re-record the mp4 inside window chrome + backdrop
#   4. ffmpeg              — final framed mp4 + palette-optimized gif
#
# Requires: ffmpeg on PATH. Run from the repo root:  npm run capture:video
set -euo pipefail
cd "$(dirname "$0")/.."

VID=docs/marketing/video
command -v ffmpeg >/dev/null || { echo "ffmpeg not found on PATH"; exit 1; }

echo "==> [1/4] Recording app walkthrough"
rm -rf "$VID/raw" "$VID/framed" "$VID/demo-app.mp4"
npx playwright test demo.spec.ts

RAW=$(ls "$VID"/raw/*.webm | head -1)
echo "==> [2/4] Transcoding app-only clip"
ffmpeg -y -i "$RAW" -movflags +faststart -pix_fmt yuv420p -crf 22 -an "$VID/demo-app.mp4"

echo "==> [3/4] Framing the clip in window chrome"
npx playwright test frame-video.spec.ts
FRAMED=$(ls "$VID"/framed/*.webm | head -1)

echo "==> [4/4] Producing final mp4 + gif"
ffmpeg -y -i "$FRAMED" -movflags +faststart -pix_fmt yuv420p -vf "scale=1000:-2" -crf 23 -an "$VID/demo.mp4"
PAL=$(mktemp -t ghtasks-pal-XXXX).png
ffmpeg -y -i "$FRAMED" -vf "fps=10,scale=520:-1:flags=lanczos,palettegen=max_colors=64:stats_mode=diff" "$PAL"
ffmpeg -y -i "$FRAMED" -i "$PAL" -lavfi "fps=10,scale=520:-1:flags=lanczos[x];[x][1:v]paletteuse=dither=none:new=1" "$VID/demo.gif"
rm -f "$PAL"

# Clean intermediates (kept out of git via .gitignore anyway).
rm -rf "$VID/raw" "$VID/framed" "$VID/demo-app.mp4"
echo "==> Done: $VID/demo.mp4  +  $VID/demo.gif"
ls -la "$VID"/demo.mp4 "$VID"/demo.gif
