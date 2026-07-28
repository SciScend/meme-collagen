#!/usr/bin/env bash
# Regenerates the README screenshots from the real app, so they can never drift
# from what the tool actually looks like.
#
#   ./docs/screenshots.sh
#
# Builds a throwaway copy of the app with docs/demo.js appended (it fills the
# canvas with placeholder pictures and captions), then photographs three scenes
# in headless Chrome.
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
BUILD="$(mktemp -d)"
trap 'rm -rf "$BUILD"' EXIT

CHROME="${CHROME:-$(command -v google-chrome || command -v chromium || command -v chromium-browser)}"
if [ -z "$CHROME" ]; then echo "No Chrome/Chromium found; set CHROME=/path/to/chrome" >&2; exit 1; fi

cp "$ROOT"/index.html "$ROOT"/styles.css "$ROOT"/fonts.css \
   "$ROOT"/store.js "$ROOT"/model.js "$ROOT"/render.js "$ROOT"/interact.js "$ROOT"/ui.js \
   "$ROOT"/docs/demo.js "$BUILD/"

python3 - "$BUILD" <<'PY'
import pathlib, sys
p = pathlib.Path(sys.argv[1]) / 'index.html'
p.write_text(p.read_text().replace(
    '<script src="ui.js"></script>',
    '<script src="ui.js"></script>\n<script src="demo.js"></script>'))
PY

PORT=$(python3 -c 'import socket;s=socket.socket();s.bind(("",0));print(s.getsockname()[1]);s.close()')
(cd "$BUILD" && python3 -m http.server "$PORT" >/dev/null 2>&1) &
SERVER=$!
trap 'kill $SERVER 2>/dev/null; rm -rf "$BUILD"' EXIT
sleep 1

shoot() {  # scene, output file
  "$CHROME" --headless=new --no-sandbox --disable-gpu --hide-scrollbars \
    --virtual-time-budget=9000 --window-size=1330,900 \
    --screenshot="$ROOT/docs/$2" "http://localhost:$PORT/index.html?scene=$1" 2>/dev/null
  echo "docs/$2"
}

shoot collage screenshot.png
shoot crop    crop.png
shoot bubble  bubble.png
