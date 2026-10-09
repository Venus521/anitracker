# -*- coding: utf-8 -*-
"""一次性工具：串行跑 运行回归测试.bat 里登记的每一条门禁（cmd 咬不住 CJK 文件名，
所以直接读 bat 自己解析命令行，跑的就是登记那份真身），逐条记 rc 与耗时。
耗时集体暴跌 = 门禁根本没跑到判决行，先怀疑量具。用完即删。"""
import io
import os
import subprocess
import sys
import time

HERE = os.path.dirname(os.path.abspath(__file__))
BAT = os.path.join(HERE, "运行回归测试.bat")
CR = chr(13)
NL = chr(10)

txt = io.open(BAT, encoding="utf-8").read().replace(CR, "")
cmds = []
for line in txt.split(NL):
    l = line.strip()
    if l.startswith("node ") or l.startswith("python "):
        cmds.append(l)
print("从 bat 解析出 %d 条门禁命令" % len(cmds))

bad = []
ART = os.path.join(HERE, "tests", "_artifacts")
for c in cmds:
    parts = c.split(" ")
    if parts[0] == "node":
        argv = ["node"] + parts[1:]
    else:
        argv = [sys.executable] + parts[1:]
    t0 = time.time()
    p = subprocess.run(argv, cwd=HERE, capture_output=True)
    dt = time.time() - t0
    name = parts[-1]
    so = p.stdout.decode("utf-8", "replace")
    se = p.stderr.decode("utf-8", "replace")
    tail = so.strip().split(NL)[-1:] or [""]
    print("%-6s %-46s rc=%d  %.1fs  %s" % ("OK" if p.returncode == 0 else "RED", name,
                                           p.returncode, dt, tail[0][:110]))
    # 红的那条必须把 FAIL 行与全文留下：只留末行 = 事后连是哪条判据红了都读不出来
    try:
        os.makedirs(ART, exist_ok=True)
        base = os.path.basename(name).replace(".js", "").replace(".py", "")
        with io.open(os.path.join(ART, "_gate_" + base + ".log"), "w", encoding="utf-8", newline=NL) as f:
            f.write("$ " + c + NL + "rc=" + str(p.returncode) + NL + NL + so)
            if se:
                f.write(NL + "--- stderr ---" + NL + se)
    except OSError:
        pass
    if p.returncode != 0:
        hit = [ln for ln in so.split(NL) if "FAIL" in ln or "RED" in ln][:12]
        bad.append(name + " rc=" + str(p.returncode) + " | " +
                   (" ;; ".join(x.strip()[:120] for x in hit) if hit else (se[-300:] or so[-300:])))
    if dt < 1.0 and "negative" not in name and "_syntax" not in name:
        print("   WARN 耗时 <1s，可能没跑到判决行：" + name)

print("")
print("==== 串行门禁 GATES_EXIT=%d 共 %d 条，红 %d 条 ====" % (1 if bad else 0, len(cmds), len(bad)))
for b in bad:
    print("  - " + b)
sys.exit(1 if bad else 0)
