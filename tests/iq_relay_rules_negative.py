# -*- coding: utf-8 -*-
"""v2.49.0 负测：爱奇艺中转「读全了没有」这条判据真的会咬人吗
为什么要有它：R5~R8 是我刚补的（旧写法 data = r.read(600000) 把热片的搜索 JSON
截成半截 ⇒ json.loads 必炸 ⇒ 端点 502 ⇒ 雍正王朝/名侦探柯南/夏目友人帐 全挂）。
判据如果不咬，就只是一句注释。所以这里把真身改坏三档，各档写死「该红哪几条」，
并留一份什么都没改的副本必须全绿（对照组）——否则分不清是判据在咬还是量具坏了。
用法：python -X utf8 tests/iq_relay_rules_negative.py"""
import io
import os
import subprocess
import sys
import tempfile

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.dirname(HERE)
GATE = os.path.join(HERE, "iq_relay_rules_check.py")
REAL = io.open(os.path.join(ROOT, "服务器-空闲自退.py"), encoding="utf-8").read()

ok = 0
bad = []


def reds(src, tag):
    """把这份递进闸门（AT_SRV），返回红掉的判据 ID 集合"""
    fp = os.path.join(tempfile.gettempdir(), "at_neg_srv_" + tag + ".py")
    io.open(fp, "w", encoding="utf-8", newline="").write(src)
    env = dict(os.environ)
    env["AT_SRV"] = fp
    p = subprocess.run([sys.executable, "-X", "utf8", GATE], capture_output=True,
                       cwd=ROOT, env=env)
    out = p.stdout.decode("utf-8", "replace")
    ids = set(l.split(" ")[1] for l in out.split(chr(10)) if l.startswith("FAIL "))
    if p.returncode == 0 and not ids and "==== iq-relay-rules" not in out:
        raise RuntimeError("闸门没跑到判决行（rc=0 却无汇总）：" + out[-200:])
    if "crash" in out.lower() or "Traceback" in out:
        raise RuntimeError("闸门自己崩了（量具坏了，红是假的）：" + out[-300:])
    return ids


def check(cid, desc, cond, extra=""):
    global ok
    if cond:
        ok += 1
        print("PASS " + cid + " " + desc)
    else:
        bad.append(cid + " " + desc + ("  :: " + str(extra) if extra else ""))
        print("FAIL " + cid + " " + desc + ("  :: " + str(extra) if extra else ""))


# ---------- 对照组：什么都没改的那份副本，必须全绿，且与真身同结论 ----------
base = REAL.replace("def read_all(", "def read_all(")
try:
    r0 = reds(base, "ctrl")
except Exception as e:
    print("CRASH " + str(e)[:300])
    sys.exit(1)
check("C1", "对照：原样副本全绿（判据不会自己咬）", len(r0) == 0, sorted(r0))
rreal = reds(REAL, "real")
check("C2", "对照：副本 == 真身（同一条判决，不是副本特殊）", r0 == rreal, sorted(r0) + sorted(rreal))

# ---------- M1：把 read_all 退回「一次固定字节数的 read」——当年那个 bug ----------
M1 = REAL.replace("    chunks = []", "    return r.read(600000), False" + chr(10) + "    chunks = []", 1)
check("M1a", "M1 改到了判决位（read_all 里真的换成了定长 read）", M1 != REAL and "    return r.read(600000), False" in M1)
r1 = reds(M1, "m1")
check("M1", "M1 该红且只该红这两条：R5 读不全 / R6 截断不再可查", r1 == set(["R5", "R6"]), sorted(r1))

# ---------- M2：端点绕过 read_all，自己 r.read(600000) ----------
M2 = REAL.replace("data, cut = read_all(r, 8000000)", "data = r.read(600000)", 1)
check("M2a", "M2 改到了判决位（_iq_relay 真的绕开了 read_all）", M2 != REAL)
r2 = reds(M2, "m2")
check("M2", "M2 该红且只该红这一条：R7 端点里不许出现定长 read", r2 == set(["R7"]), sorted(r2))

# ---------- M3：读全了但不查 cut（把截断当成功递出去） ----------
M3 = REAL.replace("        if cut:" + chr(10) + "            self.send_response(502); self.send_header('Content-Type', 'text/plain; charset=utf-8')" + chr(10) + "            self.end_headers(); self.wfile.write('iq response too big'.encode('utf-8')); return", "        if False:", 1)
check("M3a", "M3 改到了判决位（_iq_relay 的 cut 出口真的拆掉了）", M3 != REAL and "iq response too big" not in M3)
r3 = reds(M3, "m3")
check("M3", "M3 该红且只该红这一条：R8 cut 之后必须有 502 出口", r3 == set(["R8"]), sorted(r3))

print(chr(10) + "==== iq-relay-rules-negative: pass=" + str(ok) + " fail=" + str(len(bad)) + " ====")
for b in bad:
    print("  " + b)
sys.exit(1 if bad else 0)
