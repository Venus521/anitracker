# -*- coding: utf-8 -*-
"""
豆瓣封面同源中转云函数（CloudBase / Tencent SCF Python3.9）

为什么需要它：浏览器端无法直接抓豆瓣——rexxar 搜索要 Referer（真实 fetch 被 400 拦），
图床 imgN.doubanio.com 反盗链（418）。本函数在云端带移动端 UA+Referer 抓 rexxar 搜索、
再直抓签名原图字节，同源返回（绕开 400/418），前端转 dataURL 离线存。

仅接 ?q= 剧名，不接任意 URL，无开放代理风险。
"""
import json
import base64
import time
import ssl
import urllib.request
import urllib.error
import urllib.parse

UA = 'Mozilla/5.0 (iPhone; CPU iPhone OS 15_0 like Mac OS X) AppleWebKit/605.1.15'
REF = 'https://m.douban.com/'

_CTX = None


def _ctx():
    global _CTX
    if _CTX is None:
        c = ssl.create_default_context()
        c.check_hostname = False
        c.verify_mode = ssl.CERT_NONE
        _CTX = c
    return _CTX


def _fetch(url, headers, timeout=12):
    req = urllib.request.Request(url, headers=headers)
    with urllib.request.urlopen(req, timeout=timeout, context=_ctx()) as r:
        return r.read(), (r.headers.get('Content-Type') or 'image/jpeg')


def _douban_cover_bytes(name):
    """返回 (bytes, content_type)。豆瓣偶发 403 登录墙，搜索做一次重试平滑瞬断。"""
    surl = 'https://m.douban.com/rexxar/api/v2/search?q=%s&type=tv&loc_id=108288' % urllib.parse.quote(name)
    sh = {'User-Agent': UA, 'Referer': REF, 'Accept': 'application/json'}
    body = None
    last_err = None
    for _ in range(2):
        try:
            body, _ = _fetch(surl, sh)
            break
        except Exception as e:  # 偶发 403 need_login
            last_err = e
            time.sleep(0.7)
    if body is None:
        raise last_err or RuntimeError('douban search failed')
    try:
        sd = json.loads(body.decode('utf-8', 'replace'))
    except Exception:
        raise RuntimeError('bad search json')
    items = ((sd.get('subjects') or {}).get('items') or [])
    cover = None
    for it in items[:5]:
        t = it.get('target') or {}
        c = t.get('cover_url') or t.get('cover')
        if c:
            cover = c
            break
    if not cover:
        raise RuntimeError('no cover found for %s' % name)
    data, ctype = _fetch(cover, {'User-Agent': UA, 'Referer': REF})
    return data, ctype


def _cors_headers(extra=None):
    h = {'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Methods': 'GET,OPTIONS'}
    if extra:
        h.update(extra)
    return h


def main(event, context):
    event = event or {}
    if event.get('httpMethod') == 'OPTIONS':
        return {'statusCode': 204, 'headers': _cors_headers(), 'body': '', 'isBase64Encoded': False}

    # 取 q：queryString（dict 或字符串）优先，其次 body（JSON）
    name = ''
    qs = event.get('queryString') or {}
    if isinstance(qs, dict):
        name = qs.get('q') or ''
    elif isinstance(qs, str):
        name = urllib.parse.parse_qs(qs).get('q', [''])[0]
    if not name and event.get('body'):
        try:
            b = event['body']
            if isinstance(b, str):
                b = json.loads(b)
            if isinstance(b, dict):
                name = b.get('q') or ''
        except Exception:
            pass
    name = (name or '').strip()

    if not name:
        return {'statusCode': 400, 'headers': _cors_headers({'Content-Type': 'application/json; charset=utf-8'}),
                'body': json.dumps({'error': 'need q'}), 'isBase64Encoded': False}

    try:
        data, ctype = _douban_cover_bytes(name)
    except Exception as e:
        return {'statusCode': 502, 'headers': _cors_headers({'Content-Type': 'application/json; charset=utf-8'}),
                'body': json.dumps({'error': 'douban fail: %s' % e}), 'isBase64Encoded': False}

    return {
        'statusCode': 200,
        'headers': _cors_headers({'Content-Type': ctype, 'Cache-Control': 'public, max-age=86400'}),
        'body': base64.b64encode(data).decode('ascii'),
        'isBase64Encoded': True,
    }
