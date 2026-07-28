#!/usr/bin/env python3
"""Read a dumped DOM on stdin and print the test results it contains.

Exits 0 only if the page finished with every check passing.
"""
import html
import re
import sys

dom = sys.stdin.read()
title = re.search(r'<title>([^<]*)</title>', dom)
body = re.search(r'<pre id="results">(.*?)</pre>', dom, re.S)

if not body:
    print('No results — the suite did not finish. Run with a larger '
          '--virtual-time-budget, or check the browser console.')
    sys.exit(1)

print(html.unescape(body.group(1)))
sys.exit(0 if title and 'TESTS-PASSED' in title.group(1) else 1)
