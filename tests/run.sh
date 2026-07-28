#!/usr/bin/env bash
# Runs the test suite against the real app in headless Chrome.
#   ./tests/run.sh            # test over http://
#   ./tests/run.sh file       # test the file:// path instead
#
# Builds a throwaway copy of the app with tests.js appended, so the tests always
# exercise the real index.html rather than a stale duplicate of it.
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
MODE="${1:-http}"
BUILD="$(mktemp -d)"
trap 'rm -rf "$BUILD"' EXIT

CHROME="${CHROME:-$(command -v google-chrome || command -v chromium || command -v chromium-browser)}"
if [ -z "$CHROME" ]; then echo "No Chrome/Chromium found; set CHROME=/path/to/chrome" >&2; exit 1; fi

cp "$ROOT"/index.html "$ROOT"/styles.css "$ROOT"/fonts.css \
   "$ROOT"/store.js "$ROOT"/model.js "$ROOT"/render.js "$ROOT"/interact.js "$ROOT"/ui.js \
   "$ROOT"/tests/tests.js "$BUILD/"

# A real font file for the "upload your own font" test, taken from fonts.css.
python3 - "$BUILD" <<'PY'
import pathlib, re, sys
b = pathlib.Path(sys.argv[1])
blob = re.search(r'base64,([A-Za-z0-9+/=]+)\)', (b / 'fonts.css').read_text()).group(1)
(b / 'testfont.js').write_text(f'const TEST_FONT_DATAURL = "data:font/woff2;base64,{blob}";\n')
html = (b / 'index.html').read_text().replace(
    '<script src="ui.js"></script>',
    '<script src="ui.js"></script>\n<script src="testfont.js"></script>\n<script src="tests.js"></script>')
(b / 'index.html').write_text(html)
PY

if [ "$MODE" = "file" ]; then
  URL="file://$BUILD/index.html"
else
  PORT=$(python3 -c 'import socket;s=socket.socket();s.bind(("",0));print(s.getsockname()[1]);s.close()')
  (cd "$BUILD" && python3 -m http.server "$PORT" >/dev/null 2>&1) &
  SERVER=$!
  trap 'kill $SERVER 2>/dev/null; rm -rf "$BUILD"' EXIT
  sleep 1
  URL="http://localhost:$PORT/index.html"
fi

echo "Running tests: $URL"
"$CHROME" --headless=new --no-sandbox --disable-gpu --virtual-time-budget=40000 \
  --window-size=1280,900 --dump-dom "$URL" 2>/dev/null | python3 "$ROOT/tests/report.py"
