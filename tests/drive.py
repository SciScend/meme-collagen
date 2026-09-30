#!/usr/bin/env python3
"""Open the test page in headless Chrome, wait for the suite to finish, print the DOM.

    drive.py CHROME URL PROFILE_DIR [TIMEOUT_SECONDS]

Talks to Chrome over the DevTools protocol on a pipe (--remote-debugging-pipe),
so it needs nothing beyond the standard library. It waits in real time until
the page title says TESTS-*, then prints the page for report.py to read.

This replaced --dump-dom with --virtual-time-budget. Virtual time only pauses
for network fetches, so while an IndexedDB write was on its way to disk it ran
ahead to the end of the budget and the DOM was dumped mid-suite. That is why the
autosave section failed most of the time on CI and now and then locally.
"""
import fcntl
import json
import os
import select
import subprocess
import sys
import time

chrome, url, profile = sys.argv[1:4]
timeout = float(sys.argv[4]) if len(sys.argv) > 4 else 120
deadline = time.monotonic() + timeout

# Chrome reads commands from fd 3 and writes replies to fd 4. The child's ends
# are first copied above fd 10 so that moving them onto 3 and 4 cannot clobber
# one with the other; the copies are close-on-exec, so only 3 and 4 survive.
cmd_r, cmd_w = os.pipe()
reply_r, reply_w = os.pipe()
child_r = fcntl.fcntl(cmd_r, fcntl.F_DUPFD_CLOEXEC, 10)
child_w = fcntl.fcntl(reply_w, fcntl.F_DUPFD_CLOEXEC, 10)


def wire_fds():
    os.dup2(child_r, 3)
    os.dup2(child_w, 4)


proc = subprocess.Popen(
    [chrome, '--headless=new', '--no-sandbox', '--disable-gpu', '--window-size=1280,900',
     f'--user-data-dir={profile}', '--remote-debugging-pipe', 'about:blank'],
    stdin=subprocess.DEVNULL, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL,
    preexec_fn=wire_fds, close_fds=False)
for fd in (cmd_r, reply_w, child_r, child_w):
    os.close(fd)

buf = b''
last_id = 0


def recv():
    """Next message from Chrome, or TimeoutError once the deadline has passed."""
    global buf
    while b'\0' not in buf:
        left = deadline - time.monotonic()
        if left <= 0 or not select.select([reply_r], [], [], left)[0]:
            raise TimeoutError
        chunk = os.read(reply_r, 1 << 16)
        if not chunk:
            raise RuntimeError('Chrome closed the DevTools pipe')
        buf += chunk
    msg, buf = buf.split(b'\0', 1)
    return json.loads(msg)


def send(method, params=None, session=None):
    """Send one command and return its result, skipping events on the way."""
    global last_id
    last_id += 1
    msg = {'id': last_id, 'method': method, 'params': params or {}}
    if session:
        msg['sessionId'] = session
    os.write(cmd_w, json.dumps(msg).encode() + b'\0')
    while True:
        reply = recv()
        if reply.get('id') == last_id:
            if 'error' in reply:
                raise RuntimeError(f"{method}: {reply['error'].get('message')}")
            return reply['result']


def evaluate(session, expression):
    result = send('Runtime.evaluate', {'expression': expression, 'returnByValue': True}, session)
    return result.get('result', {}).get('value') or ''


dom = ''
session = None
try:
    # The window opened for about:blank carries --window-size, so reuse it.
    page = None
    while page is None:
        targets = send('Target.getTargets')['targetInfos']
        page = next((t for t in targets if t['type'] == 'page'), None)
        if page is None:
            if time.monotonic() >= deadline:
                raise TimeoutError
            time.sleep(0.1)
    session = send('Target.attachToTarget', {'targetId': page['targetId'], 'flatten': True})['sessionId']
    send('Page.navigate', {'url': url}, session)

    while True:
        try:
            if evaluate(session, 'document.title').startswith('TESTS-'):
                break
        except RuntimeError:
            pass  # no execution context while the page is still loading
        if time.monotonic() >= deadline:
            raise TimeoutError
        time.sleep(0.2)
except TimeoutError:
    print(f'Timed out after {timeout:.0f}s waiting for the suite to finish.', file=sys.stderr)
    deadline = time.monotonic() + 10  # enough to fetch what the page got through
finally:
    if session:
        try:
            dom = evaluate(session, 'document.documentElement.outerHTML')
        except (RuntimeError, TimeoutError):
            pass
    # Close Chrome properly: killing it leaves child processes writing into the
    # profile directory while run.sh is trying to delete it.
    try:
        send('Browser.close')
    except (RuntimeError, TimeoutError, OSError):
        pass
    try:
        proc.wait(timeout=10)
    except subprocess.TimeoutExpired:
        proc.kill()
        proc.wait()

sys.stdout.write(dom)
