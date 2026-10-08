# -*- coding: utf-8 -*-
"""探测：豆瓣 rexxar 详情能否给出单集时长 / 集数 / 类型 / 封面。
用法：python _probe_dbinfo.py 剧名1 剧名2 ...
"""
import json, sys, time, urllib.parse, urllib.request, ssl

UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0 Safari/537.36'
CTX = ssl.create_default_context()
CTX.check_hostname = False
CTX.verify_mode = ssl.CERT_NONE


def get(url, ref, timeout=12):
    req = urllib.request.Request(url, headers={
        'User-Agent': UA, 'Referer': ref, 'Accept': 'application/json, text/plain, */*',
        'Accept-Language': 'zh-CN,zh;q=0.9'})
    try:
        with urllib.request.urlopen(req, timeout=timeout, context=CTX) as r:
            return r.status, r.read(), dict(r.headers)
    except urllib.error.HTTPError as e:
        return e.code, e.read(), {}
    except Exception as e:
        return 0, str(e).encode(), {}


def suggest(name):
    st, body, _ = get('https://movie.douban.com/j/subject_suggest?q=' + urllib.parse.quote(name),
                      'https://movie.douban.com/')
    if st != 200:
        return []
    try:
        return json.loads(body.decode('utf-8'))
    except Exception:
        return []


def pick(arr, name):
    if not arr:
        return None
    exact = [x for x in arr if x.get('title') == name]
    pool = exact or arr
    return pool[0]


def detail(sid, ref=None):
    ref = ref or ('https://m.douban.com/subject/%s/' % sid)
    for api in ('tv', 'movie'):
        st, body, hd = get('https://m.douban.com/rexxar/api/v2/%s/%s' % (api, sid), ref)
        if st == 200:
            try:
                return api, json.loads(body.decode('utf-8'))
            except Exception as e:
                return api, {'_err': str(e)}
    return None, {'_err': 'http %s' % st}


def main():
    names = sys.argv[1:] or ['大宋提刑官', '漫长的季节', '怪奇物语', '你的名字', '武林外传']
    for n in names:
        t0 = time.time()
        arr = suggest(n)
        hit = pick(arr, n)
        out = {'name': n, 'suggest_ok': bool(arr), 'n_res': len(arr)}
        if hit:
            out['id'] = hit.get('id')
            out['sug_title'] = hit.get('title')
            out['sug_ep'] = hit.get('episode')
            api, d = detail(hit['id'])
            out['api'] = api
            if d and not d.get('_err'):
                out.update({
                    'title': d.get('title'), 'type': d.get('type'), 'subtype': d.get('subtype'),
                    'durations': d.get('durations'), 'eps': d.get('episodes_count'),
                    'genres': d.get('genres'), 'card': d.get('card_subtitle'),
                    'cover': (d.get('cover_url') or '')[:90],
                })
            else:
                out['err'] = d.get('_err') if isinstance(d, dict) else str(d)
        out['ms'] = int((time.time() - t0) * 1000)
        print(json.dumps(out, ensure_ascii=False))
        time.sleep(1.1)


if __name__ == '__main__':
    main()
