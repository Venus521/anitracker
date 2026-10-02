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

    # ---- v2.14.0j 同源中转：CloudBase 网关按来源白名单拦跨域（HTTP 网关「跨域设置」是付费能力）。
    #      手机经内网 IP 打开时，前端把网关请求改写到 /cb-relay，这里带白名单内 Origin 转发，
    #      浏览器视角全程同源，天然没有跨域。只放行 CloudBase 官方域名，杜绝开放代理。----
    _ALLOW_HOSTS = ('.tcloudbasegateway.com', '.cloudbase.net', '.tcloudbase.com')

    def _relay_target(self):
        from urllib.parse import urlparse, parse_qs
        q = parse_qs(urlparse(self.path).query)
        t = (q.get('t') or [''])[0]
        u = urlparse(t)
        if u.scheme not in ('http', 'https'):
            return None
        if not any(u.hostname == h.lstrip('.') or (u.hostname or '').endswith(h) for h in self._ALLOW_HOSTS):
            return None
        return t

    def _relay(self, method):
        import urllib.request, urllib.error
        from http.client import HTTPException
        target = self._relay_target()
        if not target:
            self.send_response(400); self.end_headers(); self.wfile.write(b'bad target'); return
        ln = int(self.headers.get('Content-Length') or 0)
        body = self.rfile.read(ln) if ln else None
        req = urllib.request.Request(target, data=body, method=method)
        for k in ('Content-Type', 'Authorization', 'X-No-Ajax', 'Accept'):
            v = self.headers.get(k)
            if v:
                req.add_header(k, v)
        req.add_header('Origin', 'http://127.0.0.1:%d' % a.port)
        req.add_header('User-Agent', 'Mozilla/5.0')
        try:
            with urllib.request.urlopen(req, timeout=25) as r:
                data = r.read()
                self.send_response(r.status)
                for k, v in r.headers.items():
                    if k.lower() in ('content-type', 'access-control-allow-origin'):
                        self.send_header(k, v)
                self.end_headers(); self.wfile.write(data)
        except urllib.error.HTTPError as e:
            data = e.read()
            self.send_response(e.code)
            for k, v in e.headers.items():
                if k.lower() in ('content-type', 'access-control-allow-origin'):
                    self.send_header(k, v)
            self.end_headers(); self.wfile.write(data)
        except (urllib.error.URLError, HTTPException, OSError) as e:
            self.send_response(502); self.end_headers()
            self.wfile.write(('relay fail: %s' % e).encode('utf-8'))

    # ---- v2.26.0 封面中转：豆瓣在浏览器端彻底走不通（rexxar 搜索要 Referer 否则 400、
    #      图床 imgN.doubanio.com 防盗链 418），所以由本机服务同源中转。前端仅在「本地/局域网模式」
    #      （页面由本服务托管）时调用 /cover-relay，拿到的是 image 字节，绕开两层拦截，且可离线存为 dataURL。
    #      只接受 ?q= 剧名，不接任意 URL，无开放代理风险。----
    def _cover_relay(self):
        import urllib.request, urllib.error, json, time
        from urllib.parse import urlparse, parse_qs
        q = parse_qs(urlparse(self.path).query)
        name = (q.get('q') or [''])[0].strip()
        if not name:
            self.send_response(400); self.send_header('Content-Type', 'text/plain; charset=utf-8'); self.end_headers()
            self.wfile.write('need q'.encode('utf-8')); return
        ua = 'Mozilla/5.0 (iPhone; CPU iPhone OS 15_0 like Mac OS X) AppleWebKit/605.1.15'
        ref = 'https://m.douban.com/'
        # 豆瓣 rexxar 偶发 403 need_login（限流/登录墙），重试一次平滑瞬断
        def _get(url, binary=False):
            for _ in range(2):
                try:
                    req = urllib.request.Request(url, headers={'User-Agent': ua, 'Referer': ref, 'Accept': 'application/json'})
                    with urllib.request.urlopen(req, timeout=12) as r:
                        return True, r.status, (r.read() if binary else r.read().decode('utf-8', 'replace')), r.headers.get('Content-Type') or 'image/jpeg'
                except Exception:
                    time.sleep(1.2)
            return False, 0, None, None
        ok, _, body, _ = _get('https://m.douban.com/rexxar/api/v2/search?q=%s&type=tv&loc_id=108288' % urllib.parse.quote(name))
        if not ok:
            self.send_response(502); self.send_header('Content-Type', 'text/plain; charset=utf-8'); self.end_headers()
            self.wfile.write('douban search fail'.encode('utf-8')); return
        try:
            sd = json.loads(body)
        except Exception:
            self.send_response(502); self.send_header('Content-Type', 'text/plain; charset=utf-8'); self.end_headers()
            self.wfile.write('douban json fail'.encode('utf-8')); return
        its = ((sd.get('subjects') or {}).get('items') or [])
        cover = None
        for it in its[:5]:
            t = it.get('target') or {}
            c = t.get('cover_url') or t.get('cover')
            if c:
                cover = c; break
        if not cover:
            self.send_response(404); self.send_header('Content-Type', 'text/plain; charset=utf-8'); self.end_headers()
            self.wfile.write('no cover'.encode('utf-8')); return
        ok, _, data, ctype = _get(cover, binary=True)
        if not ok:
            self.send_response(502); self.send_header('Content-Type', 'text/plain; charset=utf-8'); self.end_headers()
            self.wfile.write('douban img fail'.encode('utf-8')); return
        self.send_response(200)
        self.send_header('Content-Type', ctype)
        self.send_header('Cache-Control', 'public, max-age=86400')
        self.end_headers(); self.wfile.write(data)

    def do_GET(self):
        last[0] = time.time()
        if self.path.startswith('/cb-relay'):
            self._relay('GET'); return
        if self.path.startswith('/cover-relay'):
            self._cover_relay(); return
        super().do_GET()

    def do_POST(self):
        last[0] = time.time()
        if self.path.startswith('/cb-relay'):
            self._relay('POST'); return
        self.send_response(405); self.end_headers()

    def do_PUT(self):
        last[0] = time.time()
        if self.path.startswith('/cb-relay'):
            self._relay('PUT'); return
        self.send_response(405); self.end_headers()

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
