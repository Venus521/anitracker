# -*- coding: utf-8 -*-
"""v2.49.0 门禁：爱奇艺中转的白名单判据（纯本地，毫秒级，不联网）
为什么单列一份：/iq-img 是「你把地址给我、我去抓」的端点。它一旦能抓任意地址，
本机 8089 就成了开放代理——邻居扫到端口就能借道。判据只有一条域名正则，
所以必须把「放行的」和「冒充的」两头都钉住：后缀伪装（iqiyipic.com.evil.com）、
userinfo 混淆（http://a@iqiyipic.com/）、路径回溯（../../）都要挡住。
用法：python -X utf8 tests/iq_relay_rules_check.py"""
import io
import os
import sys

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
sys.path.insert(0, ROOT)
import iq_relay_rules as IQ  # noqa: E402

ok = 0
bad = []


def check(cid, desc, cond, extra=""):
    global ok
    if cond:
        ok += 1
        print("PASS " + cid + " " + desc)
    else:
        bad.append(cid + " " + desc + ("  :: " + extra if extra else ""))
        print("FAIL " + cid + " " + desc + ("  :: " + extra if extra else ""))


ALLOW = [
    "http://pic0.iqiyipic.com/image/20240321/a3/19/a_50008670_m_601_m15.jpg",
    "https://pic6.iqiyipic.com/image/20200916/69/a7/a_100238938_m_601_m6.jpg",
    "http://m.iqiyipic.com/u2/image/20240306/29/e4/pv_7730973630005600_d_601.jpg",
]
DENY = [
    "",
    "evil.com/a.jpg",
    "http://evil.com/iqiyipic.com/a.jpg",
    "http://iqiyipic.com.evil.com/a.jpg",
    "http://a@iqiyipic.com/b.jpg",
    "http://iqiyipic.com@evil.com/b.jpg",
    "https://x.iqiyipic.com.evil.com/a.jpg",
    "../../etc/passwd",
    "file:///C:/Windows/win.ini",
    "javascript:alert(1)",
    "http://pic0.iqiyipic.com/../../etc/passwd",
]
for u in ALLOW:
    check("A" + str(ALLOW.index(u) + 1), "放行真实图床：" + u[:56], IQ.pic_url_ok(u) is True, repr(u))
for u in DENY:
    check("D" + str(DENY.index(u) + 1), "拦下：" + (u or "(空串)")[:56], IQ.pic_url_ok(u) is False, repr(u))

# 搜索地址：只允许剧名进 query，且必须 urlencode（防 ?/& 注入改结构）
u = IQ.search_url("爱情宝典 第2季")
check("U1", "剧名做 percent-encode（不把空格/&塞进 URL）", " " not in u and "%" in u, u)
u2 = IQ.search_url("x?a=1&b=2")
check("U2", "剧名里带 ?&= 也只当数据、不改端点结构", u2.count("?") == 1 and "a=1" not in u2, u2)
import urllib.parse as _up
seg = _up.unquote_plus(IQ.search_url("剧" * 300).split("key=")[1].split("&")[0])
check("U3", "超长剧名截到 80 字以内（防把整段简介当查询递出去）；实测编码前 80 字",
      len(seg) == 80 and seg == '剧' * 80, str(len(seg)))

# 允许负测把「改坏的那份」递进来判（AT_SRV），默认测真身
srv = io.open(os.environ.get("AT_SRV") or os.path.join(ROOT, "服务器-空闲自退.py"), encoding="utf-8").read()
check("R1", "服务端确实引用了这份规则（判据不落第二处）", "iq_relay_rules" in srv)
check("R2", "/iq-img 走 pic_url_ok 闸门（不过就 403，不抓）", "pic_url_ok" in srv)
IQRELAY = srv[srv.find("def _iq_relay"):srv.find("def _iq_img")]
check("R3", "/iq-relay 这一段里只取 q 参数、地址一律由 search_url 生成（没有 url 参数这条路；注意判据只看这一节，别的中转本来就接 url）",
      "IQ.search_url(name)" in IQRELAY and ("get(" + chr(39) + "q" + chr(39) + ")") in IQRELAY and
      ("get(" + chr(39) + "url" + chr(39) + ")") not in IQRELAY)
check("R4", "图片响应限 image/ 且不小于 1000 字节（防把错误页当封面存进库）",
      "image/" in srv and "1000" in srv)


# ---- R5~R7：2026-10-09 实测的截断坑 ----
#      旧写法 data = r.read(600000) 只看「有没有超时」，不看「读全了没有」：
#      爱奇艺搜索 JSON 动辄 0.8~1.1 MB（本机实测 雍正王朝 776KB / 名侦探柯南 986KB / 夏目友人帐 1.13MB），
#      截在半路 json.loads 必炸 ⇒ 端点 502 ⇒ 越热的片越必挂。判据要量「读到的字节数」，不是「请求成功」。
import re as _re
HELP = srv[srv.find("def read_all("):srv.find("class H(SimpleHTTPRequestHandler)")]
_ns = {}
exec(HELP, _ns)
read_all = _ns["read_all"]

class _Fake:
    def __init__(self, blob):
        self._b = io.BytesIO(blob)

    def read(self, n=-1):
        return self._b.read(n)

big = b'{"x":"' + b"A" * 1100000 + b'"}'
got, cut = read_all(_Fake(big), 8000000)
check("R5", "1.1MB 的搜索 JSON 一次读到底（热片不再被截成坏 JSON）",
      len(got) == len(big) and cut is False, str(len(got)) + "/" + str(len(big)))
got2, cut2 = read_all(_Fake(b"Z" * 100000), 50000)
check("R6", "超过上限时 cut=True 明确可查（截断不许静默递给页面）",
      cut2 is True and len(got2) == 50000, str(len(got2)) + " " + str(cut2))
IMG = srv[srv.find("def _iq_img"):srv.find("def do_GET")]
check("R7", "两个爱奇艺端点都只经 read_all 读体，不再出现固定字节数的 r.read(N)",
      "read_all(r," in IQRELAY and "read_all(r," in IMG and not _re.search(r"r\.read\(\d", IQRELAY + IMG),
      "IQ=" + str("read_all(r," in IQRELAY) + " IMG=" + str("read_all(r," in IMG))
check("R8", "cut 之后有 502 出口（宁可不给封面，也不把半截 JSON 当成功递给页面）",
      IQRELAY.count("if cut:") == 1 and IMG.count("if cut:") == 1,
      str(IQRELAY.count("if cut:")) + "/" + str(IMG.count("if cut:")))

print(chr(10) + "==== iq-relay-rules: pass=" + str(ok) + " fail=" + str(len(bad)) + " ====")
for b in bad:
    print("  " + b)
sys.exit(1 if bad else 0)
