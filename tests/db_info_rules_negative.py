# -*- coding: utf-8 -*-
"""v2.50.0 负测：本机 /db-info 的判决与服务契约，判据真的会咬人吗
为什么要有它：这条端点替本机去问豆瓣，判决只要比云端松一寸（包含就算、越界分钟数收下、
id 不校验、rows=0 记成「这部没有」），错时长就会冒充实测被用户当成真值记账；
而「id 不校验」还有一条安全后果——那条端点立刻变成开放代理。
所以每条判据都改坏一次，各档写死「该红哪几条」，另留一份什么都没改的副本必须全绿，
并当场自证闸门读的是我递进去的那份（AT_RULES/AT_SRV），不是真身。
用法：python -X utf8 tests/db_info_rules_negative.py"""
import io
import json
import os
import subprocess
import sys
import tempfile

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.dirname(HERE)
GATE = os.path.join(HERE, "db_info_rules_check.py")
RULES_REAL = os.path.join(ROOT, "db_info_rules.py")
SRV_REAL = os.path.join(ROOT, "服务器-空闲自退.py")
R_SRC = io.open(RULES_REAL, encoding="utf-8").read()
S_SRC = io.open(SRV_REAL, encoding="utf-8").read()
BASE_REF = os.environ.get("AT_BASE_REF") or "851a6cc"
NL = chr(10)

ok = 0
bad = []


def check(cid, desc, cond, extra=""):
    global ok
    if cond:
        ok += 1
        print("PASS " + cid + " " + desc)
    else:
        bad.append(cid + " " + desc + ("  :: " + str(extra) if extra else ""))
        print("FAIL " + cid + " " + desc + ("  :: " + str(extra) if extra else ""))


def run_gate(rules_src, srv_src, tag):
    """把这两份递进闸门（AT_RULES/AT_SRV），返回（红掉的判据 ID 集合, 闸门报告）"""
    rp = os.path.join(tempfile.gettempdir(), "at_neg_rules_" + tag + ".py")
    sp = os.path.join(tempfile.gettempdir(), "at_neg_srv_" + tag + ".py")
    io.open(rp, "w", encoding="utf-8", newline="").write(rules_src)
    io.open(sp, "w", encoding="utf-8", newline="").write(srv_src)
    env = dict(os.environ)
    env["AT_RULES"] = rp
    env["AT_SRV"] = sp
    p = subprocess.run([sys.executable, "-X", "utf8", GATE], capture_output=True,
                       cwd=ROOT, env=env)
    out = p.stdout.decode("utf-8", "replace")
    errtxt = p.stderr.decode("utf-8", "replace")
    if errtxt.strip():
        raise RuntimeError("闸门吐了 stderr（多半是递进去的副本语法坏了）：" + errtxt[-400:])
    if "Traceback" in out or "crash" in out.lower():
        raise RuntimeError("闸门自己崩了（量具坏了，红是假的）：" + out[-400:])
    rep = json.loads(io.open(os.path.join(ROOT, "tests", "last-db-info-rules.json"),
                             encoding="utf-8").read())
    ids = set(l.split(" ")[1] for l in out.split(NL) if l.startswith("FAIL "))
    if "==== db-info-rules" not in out:
        raise RuntimeError("闸门没跑到判决行（无汇总行）：" + out[-400:])
    if rep["rules"] != rp or rep["srv"] != sp:
        raise RuntimeError("闸门读的不是我递进去的那份（换底本仍读旧底本）："
                           + str(rep["rules"]) + " / " + str(rep["srv"]))
    return ids, rep


def fn_span(src, fname):
    """函数体的行区间 [起, 止)，用于自证改动确实落在被切片的那个函数里"""
    lines = src.split(NL)
    a = -1
    for i, l in enumerate(lines):
        if l.startswith("def " + fname + "("):
            a = i
            break
    if a < 0:
        raise RuntimeError("找不到函数 " + fname)
    b = len(lines)
    for i in range(a + 1, len(lines)):
        if lines[i].startswith("def "):
            b = i
            break
    return a, b


def sub_line(src, needle, body, tag, fname=None):
    lines = src.split(NL)
    hits = [i for i, l in enumerate(lines) if needle in l]
    if len(hits) != 1:
        raise RuntimeError(tag + " 锚点不唯一（命中 " + str(len(hits)) + " 处）：" + needle)
    i = hits[0]
    if fname:
        a, b = fn_span(src, fname)
        if not (a <= i < b):
            raise RuntimeError(tag + " 改动没落在 " + fname + " 里（行 " + str(i)
                               + " 不在 " + str((a, b)) + "）")
    indent = lines[i][:len(lines[i]) - len(lines[i].lstrip())]
    out = list(lines)
    out[i] = indent + body
    res = NL.join(out)
    if res == src:
        raise RuntimeError(tag + " 改了个寂寞（新旧同文）")
    return res, i


def ins_before(src, needle, body, tag=""):
    lines = src.split(NL)
    hits = [i for i, l in enumerate(lines) if needle in l]
    if len(hits) != 1:
        raise RuntimeError(tag + " 锚点不唯一（命中 " + str(len(hits)) + " 处）：" + needle)
    i = hits[0]
    indent = lines[i][:len(lines[i]) - len(lines[i].lstrip())]
    out = lines[:i] + [indent + body] + lines[i:]
    return NL.join(out), i


def drop_line(src, needle, tag, fname=None):
    lines = src.split(NL)
    hits = [i for i, l in enumerate(lines) if needle in l]
    if len(hits) != 1:
        raise RuntimeError(tag + " 锚点不唯一（命中 " + str(len(hits)) + " 处）：" + needle)
    i = hits[0]
    if fname:
        a, b = fn_span(src, fname)
        if not (a <= i < b):
            raise RuntimeError(tag + " 删的行不在 " + fname + " 里")
    return NL.join(lines[:i] + lines[i + 1:]), i


try:
    r0, rep0 = run_gate(R_SRC, S_SRC, "ctrl")
except Exception as e:
    print("CRASH " + str(e)[:400])
    sys.exit(1)

check("C1", "对照：两份原样副本全绿（判据不会自己咬）", len(r0) == 0, sorted(r0))
check("C2", "对照自证：闸门读的是我递进去的副本（AT_RULES/AT_SRV 真的生效）",
      rep0["rules"].endswith("at_neg_rules_ctrl.py") and
      rep0["srv"].endswith("at_neg_srv_ctrl.py"), str(rep0))
p = subprocess.run([sys.executable, "-X", "utf8", GATE], capture_output=True, cwd=ROOT,
                   env={k: v for k, v in os.environ.items() if k not in ("AT_RULES", "AT_SRV")})
out = p.stdout.decode("utf-8", "replace")
rreal = set(l.split(" ")[1] for l in out.split(NL) if l.startswith("FAIL "))
check("C3", "对照：副本 == 真身（同一条判决，不是副本特殊）", r0 == rreal,
      sorted(r0) + sorted(rreal))

# ---------- 判决一头：把 rules 逐条改松，看 D 组咬不咬 ----------
MUT = [
    ("R1", "第 0 级改成「包含就算」", "pick_suggest",
     lambda s: sub_line(s, "if norm_name(x.get(", "if want in norm_name(x.get('title')) and x.get('id'):",
                        "R1", "pick_suggest"),
     set(["D07"]), "庆余年 第一季 顶替 庆余年"),
    ("R2", "第 1 级改成「包含就算」", "pick_search",
     lambda s: sub_line(s, "if norm_name(t.get(", "if want in norm_name(t.get('title')) and t.get('id'):",
                        "R2", "pick_search"),
     set(["D08"]), "怪奇物语 第五季 顶替 怪奇物语"),
    ("R3", "详情标题不再核对", "build_info",
     lambda s: sub_line(s, "if norm_name(dt) != norm_name(name):", "if False:",
                        "R3", "build_info"),
     set(["D09"]), "张冠李戴也出数"),
    ("R4", "分钟数不再设上限", "parse_dur_min",
     lambda s: sub_line(s, "return v if 0 < v <= 600 else 0", "return v if v > 0 else 0",
                        "R4", "parse_dur_min"),
     set(["D05"]), "700 分钟这类脏数冒充实测"),
    ("R5", "联想条目不再要求带封面", "clean_suggest",
     lambda s: sub_line(s, "return [x for x in out if x", "return out",
                        "R5", "clean_suggest"),
     set(["D06"]), "无图条目也放进门票"),
    ("R6", "详情 id 不再校验（这条最危险）", "detail_urls",
     lambda s: sub_line(s, "if not re.match(", "if False:", "R6", "detail_urls"),
     set(["D03"]), "任意串拼进 URL=开放代理"),
    ("R7", "genres 不再截", "build_info",
     lambda s: sub_line(s, "'genres': [str(g) for g in genres][:8]",
                        "'genres': [str(g) for g in genres] if isinstance(genres, (list, tuple)) else [],",
                        "R7", "build_info"),
     set(["D11"]), "整串塞给页面"),
    ("R8", "少递一个字段（year）", "build_info",
     lambda s: drop_line(s, "'year': str(detail.get(", "R8", "build_info"),
     set(["D10"]), "页面 applyDbInfo 认的九键缺一条"),
    ("R9", "剧名不再编码", "suggest_url",
     lambda s: sub_line(s, "q=' + quote(", "return 'https://movie.douban.com/j/subject_suggest?q='"
                        " + str(name or '').strip()", "R9", "suggest_url"),
     set(["D01", "D02"]), "带空格/&/?的剧名把查询串拆开"),
]

for cid, desc, fn, mk, expect, why in MUT:
    try:
        src2, _li = mk(R_SRC)
    except Exception as e:
        check(cid + "a", cid + " 改到了判决位（" + fn + " 内、锚点唯一）", False, str(e)[:160])
        check(cid, cid + " 该红且只该红：" + " ".join(sorted(expect)), False, "改坏了就没跑闸门")
        continue
    check(cid + "a", cid + " 改到了判决位（" + fn + " 内、锚点唯一、真的改了文）", src2 != R_SRC)
    try:
        ids, _ = run_gate(src2, S_SRC, cid.lower())
    except Exception as e:
        check(cid, cid + " 跑通了闸门", False, str(e)[:200])
        continue
    check(cid, cid + " 该红且只该红这几条：" + " ".join(sorted(expect)) + "（" + why + "）",
          ids == expect, "实际红 " + " ".join(sorted(ids)))

# ---------- 契约一头：改坏服务端副本 ----------
S_MUT = [
    ("SR1", "路由没挂上（页面那发永远 404）",
     lambda s: sub_line(s, "self._db_info(); return", "self.send_error(404); return", "SR1"),
     set(["S01"])),
    ("SR2", "rows=0 也写负缓存（一次限流判成这部永远没有）",
     lambda s: ins_before(s, "if not rows:", "_DB_NEG[name] = time.time()  # noqa"),
     set(["S07"])),
    ("SR3", "503 限流那条也写负缓存（45 秒冷却被拧成 10 分钟死账）",
     lambda s: ins_before(s, "_fail(503, '403 need_login (suggest)'",
                          "_DB_NEG[name] = time.time()  # noqa"),
     set(["S06", "S07"])),
]

for cid, desc, mk, expect in S_MUT:
    try:
        src2, _li = mk(S_SRC)
    except Exception as e:
        check(cid + "a", cid + " 改到了判决位（锚点唯一）", False, str(e)[:160])
        check(cid, cid + " 该红且只该红：" + " ".join(sorted(expect)), False, "改坏了就没跑闸门")
        continue
    check(cid + "a", cid + " 改到了判决位（锚点唯一、真的改了文）", src2 != S_SRC)
    try:
        ids, _ = run_gate(R_SRC, src2, cid.lower())
    except Exception as e:
        check(cid, cid + " 跑通了闸门", False, str(e)[:200])
        continue
    check(cid, cid + " " + desc + " —— 该红且只该红：" + " ".join(sorted(expect)),
          ids == expect, "实际红 " + " ".join(sorted(ids)))

# ---------- 封面这条腿（v2.50.0 新增）：改坏 id 腿，看 C 组咬不咬 ----------
C_MUT = [
    ("NC1", "id 腿不走数字闸（自己按 sid 拼 URL=任意 URL 代理）",
     lambda s: sub_line(s, "for du in DB.detail_urls(sid):",
                        "for du in ['https://m.douban.com/rexxar/api/v2/tv/' + sid]:", "NC1"),
     set(["C01", "C03"])),
    ("NC2", "doubanio 白名单拆掉（详情里给什么域名就抓什么域）",
     lambda s: sub_line(s, "if not (host == ", "if False:", "NC2"),
     set(["C02"])),
    ("NC3", "封面拿不到就写负缓存（一次限流把这部钉死 10 分钟）",
     lambda s: ins_before(s, "ok, _, data, ctype = _get(curl, binary=True)",
                          "_DB_NEG[name] = time.time()  # noqa"),
     set(["C05"])),
]

for cid, desc, mk, expect in C_MUT:
    try:
        src2, _li = mk(S_SRC)
    except Exception as e:
        check(cid + "a", cid + " 改到了判决位（锚点唯一）", False, str(e)[:160])
        check(cid, cid + " 该红且只该红：" + " ".join(sorted(expect)), False, "改坏了就没跑闸门")
        continue
    check(cid + "a", cid + " 改到了判决位（锚点唯一、真的改了文）", src2 != S_SRC)
    try:
        ids, _ = run_gate(R_SRC, src2, cid.lower())
    except Exception as e:
        check(cid, cid + " 跑通了闸门", False, str(e)[:200])
        continue
    check(cid, cid + " " + desc + " —— 该红且只该红：" + " ".join(sorted(expect)),
          ids == expect, "实际红 " + " ".join(sorted(ids)))

# ---------- 基线：改之前的服务副本（没有 /db-info），必须干净地全红而不是把闸门打死 ----------
bp = subprocess.run(["git", "-C", ROOT, "show", BASE_REF + ":" + "服务器-空闲自退.py"],
                    capture_output=True)
if bp.returncode != 0:
    check("B0", "基线副本取得到（git show " + BASE_REF + "）", False,
          bp.stderr.decode("utf-8", "replace")[:200])
else:
    B_SRC = bp.stdout.decode("utf-8", "replace")
    check("B0a", "基线自证：那份底本确实还没有 /db-info（红是真没有，不是量具坏）",
          "/db-info" not in B_SRC and "def do_GET(self):" in B_SRC)
    try:
        ids, _ = run_gate(R_SRC, B_SRC, "base")
        exp = set(["S00", "S01", "S02", "S03", "S04", "S05", "S06", "S07", "S08", "S09", "S10", "C01", "C02", "C03"])
        check("B0b", "基线：契约组整条红且不含崩（闸门认得出「整段都没有」，不把自己打死）",
              ids == exp, "实际红 " + " ".join(sorted(ids)))
        check("B0c", "基线：判决组（D/P）不受服务端影响，仍全绿",
              not any(x.startswith("D") or x.startswith("P") for x in ids))
    except Exception as e:
        check("B0b", "基线：闸门在旧底本上不崩", False, str(e)[:200])

# ---------- 收尾：报告文件恢复成「真身、无 env 覆盖」的结论，别停在副本上 ----------
pz = subprocess.run([sys.executable, "-X", "utf8", GATE], capture_output=True, cwd=ROOT,
                    env={k: v for k, v in os.environ.items() if k not in ("AT_RULES", "AT_SRV")})
outz = pz.stdout.decode("utf-8", "replace")
repz = json.loads(io.open(os.path.join(ROOT, "tests", "last-db-info-rules.json"),
                          encoding="utf-8").read())
idsz = set(l.split(" ")[1] for l in outz.split(NL) if l.startswith("FAIL "))
check("Z0", "收尾：真身复跑全绿，且报告指回真身（last-*.json 不被变异副本污染）",
      len(idsz) == 0 and repz["rules"] == RULES_REAL and repz["srv"] == SRV_REAL,
      sorted(idsz) + [str(repz.get("rules")), str(repz.get("srv"))])

print(NL + "==== db-info-rules-negative: pass=" + str(ok) + " fail=" + str(len(bad)) + " ====")
for b in bad:
    print("  - " + b)
io.open(os.path.join(ROOT, "tests", "last-db-info-rules-negative.json"), "w",
        encoding="utf-8").write(json.dumps(
    {"base": BASE_REF, "pass": ok, "fail": len(bad), "failures": bad},
    ensure_ascii=False, indent=1))
sys.exit(1 if bad else 0)
