# -*- coding: utf-8 -*-
"""爱奇艺封面中转的两条硬规矩，单独放一份是为了「能被测」：
   服务器脚本（服务器-空闲自退.py）在 import 时就要解析命令行参数，没法直接 import 进来量。

   /iq-relay 只把爱奇艺自己的搜索 JSON 原样递给页面 —— 认不认这条候选的判据全在页面里
   （和 TVMaze / 豆瓣同一把尺：归一化全等 + 类型同侧 + 必须有图），服务端不做判断。
   /iq-img 只许取爱奇艺自家图床的字节 —— 否则本机服务就成了开放代理，这条底线不让。
"""
import re
import urllib.parse

SEARCH_URL = 'https://search.video.iqiyi.com/o?if=html5&key=%s&positive=yes&sn=1'
UA = ('Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 '
      '(KHTML, like Gecko) Chrome/124.0 Safari/537.36')
REFERER = 'https://www.iqiyi.com/'

# 只认 <任意子域>.iqiyipic.com 或 iqiyipic.com 本身；带 @ 的一律拒（防 userinfo 伪装）
_PIC = re.compile(r'^https?://(?:[a-z0-9-]+\.)?iqiyipic\.com/[^\\<>"\s]+$')


def search_url(name):
    return SEARCH_URL % urllib.parse.quote(str(name or '').strip()[:80])


def pic_url_ok(u):
    u = str(u or '')
    if '@' in u or '..' in u:
        return False
    return bool(_PIC.match(u))
