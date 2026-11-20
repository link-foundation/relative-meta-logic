#!/usr/bin/env python3
"""Keep cancellation inside the live cache owner so the wrapper can reclaim outputs."""
import os, pathlib, signal, subprocess, sys, time
root = pathlib.Path(__file__).resolve().parent
abort_file = root / 'ABORT_REQUESTED'
started = time.monotonic()
child = subprocess.Popen(sys.argv[1:], start_new_session=True)
stop = None

def request_stop(number, _frame):
    global stop
    stop = 'signal ' + str(number)

for number in (signal.SIGINT, signal.SIGTERM, signal.SIGHUP):
    signal.signal(number, request_stop)
try:
    while child.poll() is None:
        if abort_file.exists(): stop = 'requested abort file'
        if time.monotonic() - started > 2400: stop = '40 minute internal deadline'
        disk = os.statvfs(root)
        if disk.f_bavail * disk.f_frsize < 256 * 1024 * 1024: stop = '256 MiB disk reserve'
        if stop:
            print('Internal native abort: ' + stop, flush=True)
            os.killpg(child.pid, signal.SIGTERM)
            try: child.wait(timeout=10)
            except subprocess.TimeoutExpired:
                os.killpg(child.pid, signal.SIGKILL)
                child.wait()
            sys.exit(124)
        time.sleep(0.25)
    sys.exit(child.returncode)
finally:
    if child.poll() is None:
        os.killpg(child.pid, signal.SIGKILL)
        child.wait()
