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

# v2.50.0 /db-info 的缓存账（进程内，服务一停就清零——重启后重新问，不把旧结论钉死）
_DB_LOCK = threading.Lock()
_DB_INFO = {}
_DB_INFO_MAX = 300
_DB_INFO_TTL = 7 * 24 * 3600.0
_DB_NEG = {}
_DB_NEG_TTL = 10 * 60.0


def read_all(r, cap):
    # 分块读到 EOF：一次 r.read(N) 会在第 N 字节处截断，截断的 JSON 必然解析失败。
    # 2026-10-09 本机实测：爱奇艺搜索 JSON 动辄 0.8~1.1 MB（雍正王朝 776KB、
    # 名侦探柯南 986KB、夏目友人帐 1.1MB），旧的 r.read(600000) 把这些热片全截成坏 JSON。
    chunks = []
    got = 0
    while got < cap:
        b = r.read(min(65536, cap - got))
        if not b:
            break
        chunks.append(b)
        got += len(b)
    return b''.join(chunks), got >= cap


class H(SimpleHTTPRequestHandler):
    def __init__(self, *ar, **kw):
        super().__init__(*ar, directory=a.dir, **kw)

    def end_headers(self):
        # 本地开发服务器：内容常改，禁止浏览器启发式缓存（旧页面会让同步等功能"修不好"）
        self.send_header('Cache-Control', 'no-cache')
        # 防点击劫持：X-Frame-Options 只认响应头（写在 meta 里等于空转，见 index.html 的
        # v2.29.2 注释第2 条）。CSP 的 frame-ancestors 同样是响应头指令，托管平台那边配不了，
        # 所以用这个老但通用的头兜住—— 本机服务器加它零成本，且确实生效。
        # 同源页面自己套 iframe 不受影响（SAMEORIGIN 允许同源嵌套）。
        self.send_header('X-Frame-Options', 'SAMEORIGIN')
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
        # v2.50.0：有豆瓣 id 就先按 id 问详情拿封面。按名搜索那条腿官方已限流（本机实测 333 次里 330 次 502，
        #      我爱我家/编辑部的故事 连着两轮都撞在这条腿上）；id 是 /db-info 那条「标题全等」闸给的，
        #      用它问详情不是放宽身份，是少绕一次搜索。字节仍只从 doubanio 白名单域取，问不到就退回原来的搜索腿。
        sid = (q.get('id') or [''])[0].strip()
        import db_info_rules as DB
        for du in DB.detail_urls(sid):
            try:
                _rq = urllib.request.Request(du, headers={'User-Agent': ua, 'Referer': ref,
                                              'Accept': 'application/json'})
                with urllib.request.urlopen(_rq, timeout=12) as _rr:
                    det = json.loads(_rr.read(1200000).decode('utf-8', 'replace'))
            except Exception:
                continue
            curl = str(det.get('cover_url') or '')
            host = (urlparse(curl).hostname or '').lower()
            if not (host == 'doubanio.com' or host.endswith('.doubanio.com')):
                continue
            ok, _, data, ctype = _get(curl, binary=True)
            if not ok:
                break
            log('cover-by-id %s id=%s' % (name[:40], sid))
            self.send_response(200)
            self.send_header('Content-Type', ctype)
            self.send_header('Cache-Control', 'public, max-age=86400')
            self.end_headers(); self.wfile.write(data)
            return
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

    # ---- v2.49.0 中文剧这一环：爱奇艺匿名搜索的中转（判据在页面，服务端只搬字节）----
    #      为什么要有它：豆瓣 rexxar 搜索已被官方锁成 403 need_login（2026-10-09 本机实测，
    #      333 次 q= 里 330 次 502 就是这个），中文剧从此在链上一条源都没有；
    #      爱奇艺的搜索接口匿名可通、带海报与集数，但浏览器直连没有 CORS，只能本机同源中转。
    def _iq_relay(self):
        import json, urllib.error, urllib.request
        from urllib.parse import parse_qs, urlparse
        import iq_relay_rules as IQ
        name = (parse_qs(urlparse(self.path).query).get('q') or [''])[0].strip()
        if not name:
            self.send_response(400); self.send_header('Content-Type', 'text/plain; charset=utf-8')
            self.end_headers(); self.wfile.write('need q'.encode('utf-8')); return
        try:
            req = urllib.request.Request(IQ.search_url(name), headers={'User-Agent': IQ.UA, 'Referer': IQ.REFERER})
            with urllib.request.urlopen(req, timeout=10) as r:
                data, cut = read_all(r, 8000000)
        except Exception as e:
            log('iq-relay fail %s: %s' % (name[:40], e))
            self.send_response(502); self.send_header('Content-Type', 'text/plain; charset=utf-8')
            self.end_headers(); self.wfile.write(('iq search fail: %s' % type(e).__name__).encode('utf-8')); return
        if cut:
            self.send_response(502); self.send_header('Content-Type', 'text/plain; charset=utf-8')
            self.end_headers(); self.wfile.write('iq response too big'.encode('utf-8')); return
        try:
            json.loads(data.decode('utf-8', 'replace'))     # 不是 JSON 就别递给页面（爱奇艺偶尔回 HTML 错误页）
        except Exception:
            self.send_response(502); self.send_header('Content-Type', 'text/plain; charset=utf-8')
            self.end_headers(); self.wfile.write('iq json fail'.encode('utf-8')); return
        self.send_response(200)
        self.send_header('Content-Type', 'application/json; charset=utf-8')
        self.send_header('Cache-Control', 'public, max-age=600')
        self.end_headers(); self.wfile.write(data)

    def _iq_img(self):
        import urllib.error, urllib.request
        from urllib.parse import parse_qs, urlparse
        import iq_relay_rules as IQ
        u = (parse_qs(urlparse(self.path).query).get('url') or [''])[0]
        if not IQ.pic_url_ok(u):
            # 白名单外一律 403：这条端点绝不能变成任意 URL 的代理
            self.send_response(403); self.send_header('Content-Type', 'text/plain; charset=utf-8')
            self.end_headers(); self.wfile.write('url not allowed'.encode('utf-8')); return
        try:
            req = urllib.request.Request(u, headers={'User-Agent': IQ.UA, 'Referer': IQ.REFERER})
            with urllib.request.urlopen(req, timeout=12) as r:
                data, cut = read_all(r, 6000000)
                ctype = r.headers.get('Content-Type') or 'image/jpeg'
        except Exception as e:
            self.send_response(502); self.send_header('Content-Type', 'text/plain; charset=utf-8')
            self.end_headers(); self.wfile.write(('iq img fail: %s' % type(e).__name__).encode('utf-8')); return
        if cut:
            self.send_response(502); self.send_header('Content-Type', 'text/plain; charset=utf-8')
            self.end_headers(); self.wfile.write('iq img too big'.encode('utf-8')); return
        if ctype.startswith('image/') is False or len(data) < 1000:
            self.send_response(502); self.send_header('Content-Type', 'text/plain; charset=utf-8')
            self.end_headers(); self.wfile.write('iq img not image'.encode('utf-8')); return
        self.send_response(200)
        self.send_header('Content-Type', ctype)
        self.send_header('Cache-Control', 'public, max-age=86400')
        self.end_headers(); self.wfile.write(data)

    # ---- v2.50.0 时长同源中转：/db-info?q=剧名 → 豆瓣详情里的单集分钟数 + 格式信号 ----
    #      为什么本机也要一条（2026-10-09 实测）：页面里 dbInfo 只问云端函数，而 CloudBase 网关
    #      对 loopback 来源回的响应头是 access-control-allow-origin: http://127.0.0.1:8089,*
    #      （还带 allow-credentials: true）—— 一个头里塞两个值按规范非法，Chrome 判 CORS 直接拦。
    #      封面没这毛病，正是因为 doubanRelayCover 走本机 /cover-relay（同源）。
    #      v2.50.1 再加一跳：本机这条腿只问豆瓣，而这台机器（家宽出口 IP）被豆瓣挡在
    #      subject_suggest 之外——现场日志 19 点档 117 问全部 rows=0，一次都没联想出来；
    #      同一分钟云端函数答得出 爱情宝典 50 分 / 康熙王朝 45 分。被 CORS 拦的是浏览器，
    #      不是服务器，所以由这里替页面去问云端（判决仍在 rules 里再核一遍，见 from_relay）。
    #      规矩：只接受 ?q= 剧名，URL 一律由 db_info_rules 现拼（豆瓣两条 + 云端一条），绝不接任意 URL。
    def _db_info(self):
        import json, threading, urllib.error, urllib.request
        from urllib.parse import parse_qs, urlparse
        import db_info_rules as DB

        name = (parse_qs(urlparse(self.path).query).get('q') or [''])[0].strip()
        if not name:
            self.send_response(400); self.send_header('Content-Type', 'application/json; charset=utf-8')
            self.end_headers(); self.wfile.write('{"error":"need q"}'.encode('utf-8')); return

        # 缓存与负缓存：命中直接回，避免把豆瓣的匿名额度烧在反复问同一部片上。
        # 分档五态（v2.50.1 收到一处判）：'ok' 出数 / 'limited' 被限流 / 'empty' 联想空（软限流）
        # / 'err' 压根没答上 / 'neg' 确认没有 —— 五态里只有 'neg' 许写 10 分钟负缓存：
        # 限流绝不是「没有」（v2.46.2 那条锁在这里同样成立），兜底那一跳失败更不是。
        now = time.time()
        with _DB_LOCK:
            hit = _DB_INFO.get(name)
            if hit and now - hit[0] < _DB_INFO_TTL:
                payload = json.dumps(hit[1], ensure_ascii=False).encode('utf-8')
                self.send_response(200); self.send_header('Content-Type', 'application/json; charset=utf-8')
                self.send_header('Cache-Control', 'public, max-age=600')
                self.end_headers(); self.wfile.write(payload); return
            neg = _DB_NEG.get(name)
            if neg and now - neg < _DB_NEG_TTL:
                self.send_response(404); self.send_header('Content-Type', 'application/json; charset=utf-8')
                self.end_headers(); self.wfile.write(b'{"found":false,"reason":"known miss (local)"}'); return

        ua = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0 Safari/537.36'
        ref = 'https://movie.douban.com/'
        local_dl = now + 6.0      # 豆瓣这一跳的上限（原来给到 14s：页面那只 AbortController 只等 9s，白跑）
        relay_dl = now + 13.0     # 加上兜底那一跳的总上限；页面给本机这条端点 16s，留 3s 富余

        def _get(url, referer, until):
            try:
                left = until - time.time()
                if left <= 0.5:
                    return None, 'budget'
                h = {'User-Agent': ua, 'Accept': 'application/json, text/plain, */*'}
                if referer:
                    h['Referer'] = referer
                req = urllib.request.Request(url, headers=h)
                with urllib.request.urlopen(req, timeout=min(12.0, left)) as r:
                    data, cut = read_all(r, 2000000)
                if cut:
                    return None, 'too big'
                return data, None
            except urllib.error.HTTPError as e:
                return None, ('http %s' % e.code)
            except Exception as e:
                return None, type(e).__name__

        def _fail(code, reason, extra=None):
            # extra 走 dict：字符串拼字面量时 b'' 会把整条 404 炸成 TypeError（本机实测）
            body = {'found': False, 'reason': str(reason)}
            if extra:
                body.update(extra)
            payload = json.dumps(body, ensure_ascii=False).encode('utf-8')
            self.send_response(code)
            self.send_header('Content-Type', 'application/json; charset=utf-8')
            self.end_headers()
            self.wfile.write(payload)

        def _local():
            """第一跳：本机直问豆瓣。回（info|None, 档位, 原因），档位见上面那段注。"""
            raw, err = _get(DB.suggest_url(name), ref, local_dl)
            if err == 'http 403':
                return None, 'limited', '403 need_login (suggest)'
            if err:
                log('db-info suggest fail %s: %s' % (name[:40], err))
                return None, 'err', 'suggest ' + str(err)
            try:
                rows = DB.clean_suggest(json.loads(raw.decode('utf-8', 'replace')))
            except Exception:
                return None, 'err', 'suggest json fail'
            picked = DB.pick_suggest(rows, name)
            if not picked:
                log('db-info no subject %s rows=%d sug=%s'
                    % (name[:40], len(rows), '/'.join([x['title'] for x in rows[:3]])))
                if not rows:
                    # 一条联想都没有 = 豆瓣在敷衍这台机器（软限流），不是「这片没有时长」。
                    # 2026-10-09 实测：北平无战事/大明王朝1566 几分钟前才各带回 45/42 分。
                    return None, 'empty', 'suggest empty (soft limit)'
                return None, 'neg', 'no subject for ' + name
            detail = None
            for du in DB.detail_urls(picked['id']):
                draw, derr = _get(du, 'https://m.douban.com/', local_dl)
                if derr:
                    continue
                try:
                    j = json.loads(draw.decode('utf-8', 'replace'))
                except Exception:
                    continue
                if j and (j.get('id') or j.get('title')):
                    detail = j
                    break
            if not detail:
                log('db-info no detail %s id=%s' % (name[:40], picked['id']))
                return None, 'neg', 'no detail for ' + name
            info, reason = DB.build_info(name, picked, detail)
            if not info:
                log('db-info rejected %s: %s' % (name[:40], reason))
                return None, 'neg', reason
            return info, 'ok', ''

        def _relay():
            """第二跳：服务器替页面问云端（服务端之间没有 CORS 那一关）。
            判决不在这里：DB.from_relay 会拿本机同一把尺再核一遍全等/id/分钟数，
            云端那一档坏掉也松不了本机这一层——所以这一跳只搬字节，不改口径。"""
            raw, err = _get(DB.relay_url(name), '', relay_dl)
            if err:
                log('db-info relay fail %s: %s' % (name[:40], err))
                return None, 'bad', 'relay ' + str(err)
            try:
                j = json.loads(raw.decode('utf-8', 'replace'))
            except Exception:
                log('db-info relay json fail %s' % name[:40])
                return None, 'bad', 'relay json fail'
            info, kind, reason = DB.from_relay(j, name)
            log('db-info relay %s %s dur=%s %s'
                % (kind, name[:40], (info or {}).get('dur', ''), str(reason)[:60]))
            return info, kind, reason

        info, kind, reason = _local()
        if kind != 'ok':
            rinfo, rkind, rreason = _relay()
            if rkind == 'ok':
                info, kind, reason = rinfo, 'ok', ''
            elif rkind == 'limited':
                info, kind, reason = None, 'limited', rreason
            elif rkind == 'neg':
                info, kind, reason = None, 'neg', rreason
            # rkind == 'bad'（云端不通/坏 JSON）：沿用本机那一档。兜底这一跳自己失败，
            # 永远不构成「这部剧没有时长」的结论——那笔账只能由确认没有的那一头来记。
        if kind == 'ok':
            with _DB_LOCK:
                _DB_INFO[name] = (time.time(), info)
                if len(_DB_INFO) > _DB_INFO_MAX:
                    _DB_INFO.pop(next(iter(_DB_INFO)), None)
                _DB_NEG.pop(name, None)
            log('db-info ok %s dur=%s eps=%s type=%s' % (name[:40], info['dur'], info['eps'], info['type']))
            payload = json.dumps(info, ensure_ascii=False).encode('utf-8')
            self.send_response(200); self.send_header('Content-Type', 'application/json; charset=utf-8')
            self.send_header('Cache-Control', 'public, max-age=600')
            self.end_headers(); self.wfile.write(payload); return
        if kind == 'limited':
            # 限流：503 + coolMs，页面那条 dbCoolNote 会记账，且两侧都不落负缓存
            log('db-info limited %s' % name[:40])
            _fail(503, '403 need_login (suggest)', {'limited': True, 'coolMs': 45000})
            return
        if kind == 'neg':
            with _DB_LOCK:
                _DB_NEG[name] = time.time()
            _fail(404, reason)
            return
        if kind == 'empty':
            # 两跳都没联想出来 = 这台机器正在被豆瓣敷衍，回 502 让页面稍后再问（不写负账）
            log('db-info soft limit %s (relay 也没答上)' % name[:40])
            _fail(502, 'suggest empty (soft limit)')
            return
        _fail(502, reason)

    def do_GET(self):
        last[0] = time.time()
        if self.path.startswith('/cb-relay'):
            self._relay('GET'); return
        if self.path.startswith('/cover-relay'):
            self._cover_relay(); return
        if self.path.startswith('/iq-relay'):
            self._iq_relay(); return
        if self.path.startswith('/iq-img'):
            self._iq_img(); return
        if self.path.startswith('/db-info'):
            self._db_info(); return
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
