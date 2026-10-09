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


def detail_urls(sid):
    """一个 id 可能是剧也可能是电影：两条路问过来。id 只认数字，别把用户输入拼进 URL。"""
    s = str(sid or '')
    if not re.match(r'^[0-9]{5,9}$', s):
        return []
    return ['https://m.douban.com/rexxar/api/v2/tv/' + s,
            'https://m.douban.com/rexxar/api/v2/movie/' + s]


def suggest_url(name):
    from urllib.parse import quote
    return 'https://movie.douban.com/j/subject_suggest?q=' + quote(str(name or '').strip())


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
