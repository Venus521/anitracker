# -*- coding: utf-8 -*-
"""双入口同步：index.html 是唯一源，ani-tracker.html 是同步副本。
每次修改 index.html 后必须运行本脚本；tests/run-regression.js 会校验字节一致。"""
import hashlib, os
HERE = os.path.dirname(os.path.abspath(__file__))
src = os.path.join(HERE, "index.html")
dst = os.path.join(HERE, "ani-tracker.html")
data = open(src, "rb").read()
open(dst, "wb").write(data)
h = lambda p: hashlib.sha256(open(p, "rb").read()).hexdigest()[:16]
print("synced:", h(src), h(dst), "MATCH" if h(src) == h(dst) else "MISMATCH")
