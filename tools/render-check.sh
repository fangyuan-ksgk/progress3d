#!/usr/bin/env bash
# render-check.sh — prove the Three.js/WebGL scenes actually DRAW (not just compile)
# by rendering them in headless Chromium, the same engine Obsidian (Electron) runs on,
# with software WebGL (SwiftShader). Screenshots land in tools/render-proof/.
#
# This is the verification the smoke test can't do: Node has no GPU, but Chromium does.
# If these screenshots show the glowing node map, the identical pipeline renders in Obsidian.
set -euo pipefail

CHROME="/Applications/Google Chrome.app/Contents/MacOS/Google Chrome"
if [ ! -x "$CHROME" ]; then
  echo "Google Chrome not found at: $CHROME"
  echo "Install Chrome (or edit CHROME in this script to another Chromium browser)."
  exit 1
fi

DIR="$(cd "$(dirname "$0")" && pwd)"
DEMOS="$DIR/../demos"
OUT="$DIR/render-proof"
PORT="${PORT:-8731}"
mkdir -p "$OUT"

if ! curl -s -o /dev/null "http://localhost:$PORT/5-notes.html"; then
  echo "starting demo server on :$PORT…"
  ( cd "$DEMOS" && python3 -m http.server "$PORT" >/tmp/p3d-render-srv.log 2>&1 & )
  sleep 1
fi

shot() {
  "$CHROME" --headless=new --hide-scrollbars \
    --use-gl=angle --use-angle=swiftshader --enable-unsafe-swiftshader \
    --window-size=1600,900 --virtual-time-budget=6000 \
    --screenshot="$OUT/$2" "http://localhost:$PORT/$1" >/dev/null 2>&1
  local bytes; bytes=$(wc -c < "$OUT/$2" | tr -d ' ')
  echo "  $2  ($bytes bytes)  $([ "$bytes" -gt 20000 ] && echo 'rendered ✓' || echo 'SUSPICIOUS — near-blank ✗')"
}

echo "rendering demo scenes in headless Chromium →"
shot 5-notes.html       map.png
shot 2-threejs-code.html vivid.png

# Render the REAL plugin view (plugin/src/view.ts) via an Obsidian shim — not a
# demo cousin. This bundles the actual view code and screenshots it.
echo "rendering the actual plugin view (view.ts) →"
PLUGIN="$DIR/../plugin"
if ( cd "$PLUGIN" && ./node_modules/.bin/esbuild ../tools/view-harness/harness.ts \
      --bundle --format=iife --platform=browser \
      --alias:obsidian=../tools/view-harness/obsidian-shim.ts \
      --outfile=../tools/view-harness/bundle.js >/dev/null 2>&1 ); then
  # baseline render + real synthetic gestures (drag/add/connect/delete) on the actual view
  for act in "" drag add connect delete; do
    name="plugin-view${act:+-$act}.png"
    url="file://$DIR/view-harness/index.html${act:+?act=$act}"
    "$CHROME" --headless=new --hide-scrollbars \
      --use-gl=angle --use-angle=swiftshader --enable-unsafe-swiftshader \
      --window-size=1600,900 --virtual-time-budget=6000 \
      --screenshot="$OUT/$name" "$url" >/dev/null 2>&1
    b=$(wc -c < "$OUT/$name" | tr -d ' ')
    echo "  $name  ($b bytes)  $([ "$b" -gt 20000 ] && echo 'rendered ✓' || echo 'SUSPICIOUS ✗')"
  done
else
  echo "  esbuild failed — run 'npm install' in plugin/ first"
fi

# Render the REAL plugin view with the bespoke animated `grpo` map active
# (GrpoScene inside ResearchMapView) — both the GRPO and Dr. GRPO passes.
echo "rendering the actual plugin view with the grpo animation (GrpoScene) →"
if ( cd "$PLUGIN" && ./node_modules/.bin/esbuild ../tools/view-harness/harness-grpo.ts \
      --bundle --format=iife --platform=browser \
      --alias:obsidian=../tools/view-harness/obsidian-shim.ts \
      --outfile=../tools/view-harness/bundle-grpo.js >/dev/null 2>&1 ); then
  for mode in grpo dr; do
    name="plugin-grpo-${mode}.png"
    "$CHROME" --headless=new --hide-scrollbars \
      --use-gl=angle --use-angle=swiftshader --enable-unsafe-swiftshader \
      --window-size=1600,900 --virtual-time-budget=24000 \
      --screenshot="$OUT/$name" "file://$DIR/view-harness/index-grpo.html?mode=$mode" >/dev/null 2>&1
    b=$(wc -c < "$OUT/$name" | tr -d ' ')
    echo "  $name  ($b bytes)  $([ "$b" -gt 20000 ] && echo 'rendered ✓' || echo 'SUSPICIOUS ✗')"
  done
else
  echo "  esbuild failed bundling harness-grpo.ts"
fi

echo "open $OUT/ to view."
