import argparse
import os
import sys
import threading
import time
from http.server import ThreadingHTTPServer, SimpleHTTPRequestHandler

# 按需起服的静态服务器：空闲超过 --idle 秒自动退出，平时不留后台进程。
ap = argparse.ArgumentParser()
ap.add_argument('--port', type=int, required=True)
ap.add_argument('--dir', required=True)
ap.add_argument('--host', default='127.0.0.1')
ap.add_argument('--idle', type=int, default=900)
ap.add_argument('--log', default='')
a = ap.parse_args()

try:
    logf = open(a.log, 'ab') if a.log else None
except OSError:
    logf = None

def log(msg):
    if not logf:
        return
    try:
        logf.write(('[%s] %s\n' % (time.strftime('%m-%d %H:%M:%S'), msg)).encode('utf-8'))
        logf.flush()
    except OSError:
        pass

def app_version():
    try:
        import json
        with open(os.path.join(a.dir, 'tracker-version.json'), 'r', encoding='utf-8') as f:
            return json.load(f).get('version', '?')
    except Exception:
        return '?'

last = [time.time()]

class H(SimpleHTTPRequestHandler):
    def __init__(self, *ar, **kw):
        super().__init__(*ar, directory=a.dir, **kw)

    def end_headers(self):
        # 本地开发服务器：内容常改，禁止浏览器启发式缓存（旧页面会让同步等功能"修不好"）
        self.send_header('Cache-Control', 'no-cache')
        super().end_headers()

    def do_GET(self):
        last[0] = time.time()
        super().do_GET()

    def do_HEAD(self):
        last[0] = time.time()
        super().do_HEAD()

    def log_message(self, fmt, *args):
        log('%s %s' % (self.address_string(), fmt % args))

# 单实例保护（v2.4.3）：端口已有服务在响应则直接退出，避免多实例并存
def _already_serving():
    import socket as _sock
    probe = _sock.socket(_sock.AF_INET, _sock.SOCK_STREAM)
    probe.settimeout(1.2)
    host = a.host if a.host and a.host != '0.0.0.0' else '127.0.0.1'
    try:
        probe.connect((host, a.port))
        return True
    except OSError:
        return False
    finally:
        probe.close()

if _already_serving():
    log('port %d already in use (another instance or app), exit' % a.port)
    sys.exit(0)

try:
    srv = ThreadingHTTPServer((a.host, a.port), H)
except OSError as e:
    log('port %d unavailable: %s' % (a.port, e))
    sys.exit(0)

def watchdog():
    while True:
        time.sleep(60)
        idle = time.time() - last[0]
        if idle > a.idle:
            log('idle %.0fs > %ds, exiting' % (idle, a.idle))
            os._exit(0)

threading.Thread(target=watchdog, daemon=True).start()
log('serving %s on %s:%d, idle-exit after %ds (app v%s)' % (a.dir, a.host, a.port, a.idle, app_version()))
srv.serve_forever()
