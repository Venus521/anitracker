# -*- coding: utf-8 -*-
"""本机 /db-info 的判据（纯函数，离线可测；服务端只按这里的结果搬字节）。

为什么本机也要一条：2026-10-09 实测，云端函数从 loopback 来源回的是
  access-control-allow-origin: http://127.0.0.1:8089,*  （外加 allow-credentials: true）
两个值挤在同一个头里按规范非法，Chrome 判 CORS 直接拦 —— 于是**页面里**问时长
一条都回不来（现场走查 10 部 0 中），而 python 直问同一个端点 10 部 11 中。
封面没这毛病，是因为 doubanRelayCover 走的是本机 /cover-relay（同源）。
这条把时长也变成同源，判据与 cloud-functions/douban-relay-node/index.js 的
doubanInfo 逐条对齐，一个字都不松：名字全等、粒度哨、越界分钟数不冒充实测。
"""
import os
import re

_CK = chr(0x3000)
# 要剥的符号写成字面量或 chr()：这台机器上 heredoc 会把反斜杠转义吃掉一层，
# 正则里的 \s \- \] 变成裸转义就是静默错判；引号一律走 chr()，写进字面量会提前终止字符串。
_PUNCT = set(_CK + chr(0xb7) + chr(0x2022) + chr(0x2014) + chr(0x2026)
             + chr(0xff01) + chr(0xff1f) + chr(0xff1a) + chr(0xff0c) + chr(0x3001) + chr(0x3002)
             + chr(0x201c) + chr(0x201d) + chr(0xff08) + chr(0xff09)
             + chr(0x3010) + chr(0x3011) + chr(0x300a) + chr(0x300b)
             + chr(0x22) + chr(0x27) + chr(0x3000) + chr(32) + chr(9)
             + ':.-_,!?[]()<>' + chr(0x30fb))


def norm_name(s):
    """与云端 normName 同一条：空白/标点剥掉后小写，只认全等。"""
    out = []
    for ch in str(s or ""):
        if ch in _PUNCT or ch.isspace():
            continue
        out.append(ch)
    return "".join(out).lower()


def parse_dur_min(arr):
    """durations=['45分钟'] / ['1小时30分钟'] → 45 / 90；越界（<=0 或 >600）一律 0。
    与前端 durOf 那条 600 分钟线一致：脏数不许冒充实测。"""
    if not isinstance(arr, (list, tuple)) or not arr:
        return 0
    m = re.search(r'(?:(\d+)\s*小时)?\s*(\d+)\s*分钟', str(arr[0] or ''))
    if not m:
        return 0
    v = int(m.group(1) or 0) * 60 + int(m.group(2) or 0)
    return v if 0 < v <= 600 else 0


def clean_suggest(rows):
    """suggest 原始项 → 只留「有封面且带 id（详情接口的门票）」的那些，字段与云端同。"""
    if not isinstance(rows, (list, tuple)):
        return []
    out = []
    for x in rows:
        if not isinstance(x, dict):
            continue
        out.append({'title': str(x.get('title') or ''), 'cover': str(x.get('img') or ''),
                    'ep': str(x.get('episode') or ''), 'year': str(x.get('year') or ''),
                    'url': str(x.get('url') or ''), 'id': str(x.get('id') or '')})
    return [x for x in out if x['cover']]


def pick_suggest(rows, name):
    """第 0 级：只有标题**全等**且带 id 的那条才配拿 id（与云端 doubanInfo 第 0 级同）。"""
    want = norm_name(name)
    if not want:
        return None
    for x in rows or []:
        if norm_name(x.get('title')) == want and x.get('id'):
            return x
    return None


def pick_search(items, name):
    """第 1 级：rexxar 搜索的 target 里同样只认全等。"""
    want = norm_name(name)
    if not want:
        return None
    for it in items or []:
        t = (it or {}).get('target') or {}
        if norm_name(t.get('title')) == want and t.get('id'):
            return {'id': str(t.get('id')), 'title': str(t.get('title') or '')}
    return None


# 出站地址只有一个出口：域名与路径写死在下面的常量里，剧名一律编码在尾巴上。
# AT_DB_SUGGEST_BASE / AT_DB_RELAY_BASE 是给门禁用的「换头」开关。整套门禁一律不许真的
# 出网：2026-10-09 实测这台家宽出口 IP 被豆瓣挡在 subject_suggest 之外（回 403），服务端
# 于是给出 503，页面照 v2.46.2 那条设计立刻停下整轮封面补齐——那样红的是豆瓣的心情，
# 不是本页的逻辑。覆盖只认 http(s) 开头的整段前缀，其余值一律退回生产地址。
SUGGEST_BASE = 'https://movie.douban.com/j/subject_suggest'


def _base(env_name, prod_base):
    """换头不换路：覆盖只替换协议+域名+路径这一段，?q= 与编码照旧走下面的构造。"""
    v = str(os.environ.get(env_name) or '').strip()
    if v.startswith('http://') or v.startswith('https://'):
        return v.rstrip('/')
    return prod_base


def detail_urls(sid):
    """一个 id 可能是剧也可能是电影：两条路问过来。id 只认数字，别把用户输入拼进 URL。"""
    s = str(sid or '')
    if not re.match(r'^[0-9]{5,9}$', s):
        return []
    return ['https://m.douban.com/rexxar/api/v2/tv/' + s,
            'https://m.douban.com/rexxar/api/v2/movie/' + s]


def suggest_url(name):
    from urllib.parse import quote
    return _base('AT_DB_SUGGEST_BASE', SUGGEST_BASE) + '?q=' + quote(str(name or '').strip())


def build_info(name, picked, detail):
    """判决收口：全等 + 粒度无关的字段搬运。对不上就回 (None, 原因)。"""
    if not picked or not picked.get('id'):
        return None, 'no subject for ' + str(name)
    if not detail:
        return None, 'no detail for ' + str(name)
    dt = detail.get('title') or ''
    if norm_name(dt) != norm_name(name):
        return None, 'title mismatch: ' + str(dt)
    genres = detail.get('genres')
    return ({'found': True, 'title': str(dt), 'id': str(picked.get('id')),
             'type': str(detail.get('type') or detail.get('subtype') or ''),
             'dur': parse_dur_min(detail.get('durations')),
             'eps': int(detail.get('episodes_count') or 0),
             'genres': [str(g) for g in genres][:8] if isinstance(genres, (list, tuple)) else [],
             'year': str(detail.get('year') or ''),
             'cover': str(detail.get('cover_url') or '')}, '')

# ---- v2.50.1：本机问不到时，由服务器替页面问云端这一跳（服务器之间没有 CORS 那一关） ----
# 为什么非加不可（2026-10-09 现场）：这台机器的 19 点档日志里，本机这条腿问豆瓣联想
#   117 次全部 rows=0（一次都没联想出来，含 19:44:21 的《爱情宝典》），
# 而同一分钟 python 直问云端函数：爱情宝典 found=true dur=50 / 我爱我家 20 / 康熙王朝 45。
# 这不是「这部剧没有时长」，是家宽出口 IP 被豆瓣挡在 subject_suggest 之外（软限流）；
# 能答的那一头只有非浏览器问得动——页面里问就被文件头注那堵 CORS 墙拦死。
# 所以这一跳补在服务端：URL 仍只有下面这一个出口，字节回来还要过 from_relay 再核一遍。
RELAY_BASE = 'https://cloud1-d7gsn5t0w6407b963.service.tcloudbase.com/douban-relay'


def relay_url(name):
    """云端 mode=info 的 URL：域名与路径钉死，只把剧名编码进去（与页面那条同一个端点）。"""
    from urllib.parse import quote
    return _base('AT_DB_RELAY_BASE', RELAY_BASE) + '?mode=info&q=' + quote(str(name or '').strip())


def id_ok(rid):
    """云端带回来的词条号过同一把尺：不是 5~9 位纯数字就当没给（别把它递给封面那条腿）。"""
    s = str(rid or '')
    return s if re.match('^[0-9]{5,9}$', s) else ''


def _num(v):
    try:
        return int(v)
    except (TypeError, ValueError):
        return 0


def from_relay(j, name):
    """云端 mode=info 的 JSON →（九键, 档位, 原因）。档位就四种，对应服务端那三档记账：
      'ok'      带回真值，九键与 build_info 完全同（页面 applyDbInfo 一个字不用改）
      'limited' 云端也在冷却/预算尽 —— 绝不是「这部没有」，不许写负缓存
      'neg'     云端确认没有（no subject / no detail / title mismatch / known miss）
      'bad'     云端压根没答上（不是 JSON、不是对象）
    本机再核一遍才收下：标题全等（不轻信云端）、id 只认数字、分钟数越界归 0。
    口径与 build_info、云端 doubanInfo 三方逐条同——本机这一层永远不会比两头松一寸。"""
    if not isinstance(j, dict):
        return None, 'bad', 'relay not an object'
    if not j.get('found'):
        if j.get('limited'):
            return None, 'limited', str(j.get('reason') or 'relay limited')
        return None, 'neg', str(j.get('reason') or 'relay miss')
    t = str(j.get('title') or '')
    if not t or norm_name(t) != norm_name(name):
        return None, 'neg', 'relay title mismatch: ' + t
    d = _num(j.get('dur'))
    g = j.get('genres')
    return ({'found': True, 'title': t, 'id': id_ok(j.get('id')),
             'type': str(j.get('type') or ''),
             'dur': d if 0 < d <= 600 else 0,
             'eps': _num(j.get('eps')),
             'genres': [str(x) for x in g][:8] if isinstance(g, (list, tuple)) else [],
             'year': str(j.get('year') or ''),
             'cover': str(j.get('cover') or '')}, 'ok', '')
