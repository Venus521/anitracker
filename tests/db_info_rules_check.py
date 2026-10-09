# -*- coding: utf-8 -*-
"""v2.50.0 门禁：本机 /db-info 的判据（纯本地，毫秒级，一律不联网）
为什么单列：这条端点把「豆瓣详情页」搬到同源来答，为的是绕开实测到的那堵 CORS 墙
（CloudBase 网关对 loopback 来源回 access-control-allow-origin: <echo>,* 非法多值，
Chrome 直接拦 ⇒ 页面里 10 部 0 部拿到时长）。它一开口就要替本机去问豆瓣，
所以两头都得钉住：
  ① 判决一头——名字全等、越界分钟数、粒度、字段集，必须与云端 doubanInfo 逐条同，
     差一条就是「本机比云端松」，错时长会冒充实测被用户当成真值记账；
  ② 安全一头——只接 ?q= 剧名，URL 全部由 rules 现拼，id 只认数字；
     这条端点一旦能接任意 URL，本机 8099/8089 就是开放代理。
用法：python -X utf8 tests/db_info_rules_check.py"""
import io
import json
import os
import re
import sys

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
sys.path.insert(0, ROOT)
# AT_RULES：负测把改坏的副本递进来（不递就用真身）。递进来的那份必须真的被 import，
# 否则下面每一条红都是假的——这个坑（换底本仍读旧底本）记过十三次了。
RULES = os.environ.get("AT_RULES") or os.path.join(ROOT, "db_info_rules.py")
import importlib.util  # noqa: E402
_spec = importlib.util.spec_from_file_location("db_info_rules_under_test", RULES)
DB = importlib.util.module_from_spec(_spec)
_spec.loader.exec_module(DB)

SRV = os.environ.get("AT_SRV") or os.path.join(ROOT, "服务器-空闲自退.py")
srv = io.open(SRV, encoding="utf-8").read()

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

print("--- ① 判决：与云端 doubanInfo 逐条同 ---")
check("D01", "suggest 的 URL 只有一个出口：movie.douban.com/j/subject_suggest?q=（钉死域名与路径）",
      DB.suggest_url("爱情宝典") ==
      "https://movie.douban.com/j/subject_suggest?q=%E7%88%B1%E6%83%85%E5%AE%9D%E5%85%B8",
      DB.suggest_url("爱情宝典"))
check("D02", "剧名要编码：带 & / ? / 空格的剧名不许把查询串拆开（The Office → %20，a&b → %26）",
      DB.suggest_url("The Office").endswith("The%20Office") and
      DB.suggest_url("a&b=c").endswith("a%26b%3Dc"), DB.suggest_url("a&b=c"))
check("D03", "详情只认 5~9 位纯数字 id：../、带问号、字母串一律空列表（端点绝不变任意 URL 代理）",
      len(DB.detail_urls("3619080")) == 2 and DB.detail_urls("../x") == [] and
      DB.detail_urls("1?redo=1") == [] and DB.detail_urls("") == [] and
      all(u.startswith("https://m.douban.com/rexxar/api/v2/") for u in DB.detail_urls("123456")),
      str(DB.detail_urls("../x")))
check("D04", "norm_name 与云端 normName 同一把尺：空白/·/：/（）/《》/引号 都剥，/ 与 & 不剥（本机不许比云端松）",
      DB.norm_name(" 爱 情·宝 典 ") == DB.norm_name("爱情宝典") and
      DB.norm_name("庆余年 第一季") != DB.norm_name("庆余年") and
      DB.norm_name("a/b&c") == "a/b&c", repr(DB.norm_name("a/b&c")))
check("D05", "分钟数：45分钟→45，1小时30分钟→90；越界(700)与空与坏型一律 0（脏数不冒充实测）",
      DB.parse_dur_min(["45分钟"]) == 45 and DB.parse_dur_min(["1小时30分钟"]) == 90 and
      DB.parse_dur_min(["700分钟"]) == 0 and DB.parse_dur_min([]) == 0 and
      DB.parse_dur_min(None) == 0 and DB.parse_dur_min(["45"]) == 0, str(DB.parse_dur_min(["45"])))
check("D06", "联想条目只留带封面的（与云端同：没图的那条拿不到详情门票也不许出）",
      len(DB.clean_suggest([{"title": "甲", "img": "", "id": "1"}, {"title": "甲", "img": "u", "id": "2"}])) == 1 and
      DB.clean_suggest([{"title": "甲", "img": "u"}])[0]["id"] == "",
      str(DB.clean_suggest([{"title": "甲", "img": ""}])))
check("D07", "第 0 级只认全等：《庆余年 第一季》不许顶替《庆余年》（把某一季的数写进整部=凭空造错账）",
      DB.pick_suggest(DB.clean_suggest([{"title": "庆余年 第一季", "img": "u", "id": "25853071"}]), "庆余年") is None and
      DB.pick_suggest(DB.clean_suggest([{"title": "琅琊榜之风起长林", "img": "u", "id": "9"},
                                        {"title": "琅琊榜", "img": "u", "id": "25754848"}]), "琅琊榜")["id"] == "25754848")
check("D08", "第 1 级（rexxar 搜索）同样只认全等，且取的是 target.title",
      DB.pick_search([{"target": {"title": "怪奇物语 第五季", "id": 700}}], "怪奇物语") is None and
      DB.pick_search([{"target": {"title": "怪奇物语", "id": 700}}], "怪奇物语")["id"] == "700")
check("D09", "build_info 三态齐全：全等+详情=出数；title 对不上/无 detail/无 picked 各自回原因且不出数",
      DB.build_info("爱情宝典", {"id": "3619080"}, {"title": "别的剧"})[0] is None and
      DB.build_info("爱情宝典", {"id": "3619080"}, None)[1] == "no detail for 爱情宝典" and
      DB.build_info("爱情宝典", None, {"title": "x"})[1].startswith("no subject") and
      DB.build_info("爱情宝典", {"id": "1"}, {"title": "爱情宝典", "durations": ["50分钟"]})[0]["dur"] == 50)
check("D10", "字段集与云端 val 完全同（页面 applyDbInfo 认的就是这几个键，少一个键就静默不落）",
      set(DB.build_info("甲", {"id": "1"}, {"title": "甲", "type": "tv"})[0].keys()) ==
      {"found", "title", "id", "type", "dur", "eps", "genres", "year", "cover"},
      str(sorted(DB.build_info("甲", {"id": "1"}, {"title": "甲"})[0].keys())))
check("D11", "genres 截前 8 条（递给页面的串要短，页面只按它判「动画/电视剧」这一格）",
      DB.build_info("甲", {"id": "1"}, {"title": "甲", "genres": ["g%d" % i for i in range(20)]})[0]["genres"] ==
      ["g0", "g1", "g2", "g3", "g4", "g5", "g6", "g7"])

print("--- ② 服务端契约（读源码文本，不起服务、不联网）---")
# 底本可能整段都没有 _db_info（负测的基线档就是旧版服务）。整段缺失时 S02~S10
# 的 seg.index() 会把闸门自己打死——那是量具坏了、红是假的；改成显式全红。
_srv_missing = ("def _db_info(self):" not in srv) or ("def do_GET(self):" not in srv)
if _srv_missing:
    seg = ""
    check("S00", "服务端里有 _db_info 整段（整段缺失=这份服务答不了 /db-info，契约无从判起）", False)
else:
    seg0 = srv.index("def _db_info(self):")
    seg = srv[seg0:srv.index("def do_GET(self):")]
    check("S00", "服务端里有 _db_info 整段", True)
check("S01", "路由挂上了：do_GET 里 /db-info 走 _db_info（没挂上=页面那发永远 404）",
      (not _srv_missing) and
      re.search(r"startswith\('/db-info'\):\s*\n\s*self\._db_info\(\)", srv) is not None)
check("S02", "只读 ?q=：整段里取参数的出处只有 parse_qs(...).get('q')，没有第二个入口",
      (not _srv_missing) and
      seg.count("parse_qs(urlparse(self.path).query)") == 1 and
      ".get('q')" in seg and ".get('url')" not in seg, str(seg.count(".get(")))
check("S03", "递给 urllib 的 URL 全部来自 db_info_rules：构造 Request 的地方只有一处，且包的是 _get 的入参",
      (not _srv_missing) and
      seg.count("DB.suggest_url(") == 1 and seg.count("DB.detail_urls(") == 1 and
      seg.count("urllib.request.Request(") == 1 and "urlopen" in seg)
check("S04", "空 q 直接 400，不发任何外呼（不然这条端点就成了打豆瓣的按钮）",
      (not _srv_missing) and
      seg.index('need q') < seg.index("DB.suggest_url"))
check("S05", "限流(403)走 503 且带 limited+coolMs：页面靠它记冷却，绝不能当成「这部没有」",
      (not _srv_missing) and
      "_fail(503, '403 need_login (suggest)', {'limited': True, 'coolMs': 45000})" in seg)
check("S06", "503 那条不写 _DB_NEG（限流写负缓存=一次 45 秒把这部晾 10 分钟，v2.46.2 的同一条锁）",
      (not _srv_missing) and
      re.search(r"_fail\(503[^\n]*\)\s*\n\s*return", seg) is not None and
      seg.split("_fail(503")[0].rsplit("if err == 'http 403'", 1)[-1].count("_DB_NEG[name] =") == 0)
check("S07", "联想一条都没有(rows=0)算 502 软限流，不写负缓存；有联想但全等落空才 404 记负缓存",
      (not _srv_missing) and
      "_fail(502, 'suggest empty (soft limit)')" in seg and
      seg.index("if not rows:") < seg.index("_DB_NEG[name] ="), "分档顺序不对")
check("S08", "成功与缓存命中两条都回 application/json（页面 r.json() 要用，回 text/plain 会静默丢真值）",
      (not _srv_missing) and
      seg.count("'application/json; charset=utf-8'") >= 4)
check("S09", "缓存三件套齐：进程内 INFO/NEG + 锁，且 NEG 只 10 分钟、INFO 上限 300（服务一停就清零，不把旧结论钉死）",
      (not _srv_missing) and
      "_DB_LOCK = threading.Lock()" in srv and "_DB_INFO_MAX = 300" in srv and
      "_DB_NEG_TTL = 10 * 60.0" in srv and "_DB_INFO_TTL = 7 * 24 * 3600.0" in srv)
check("S10", "detail 两路(tv/movie)都问、坏 JSON 与 404 换下一路，但不嵌套重试（外呼次数有上界）",
      (not _srv_missing) and
      seg.count("for du in DB.detail_urls(") == 1 and seg.count("for _ in range(") == 0)

print("--- ③ 与云端那份函数的字段/门槛对齐（读源码文本）---")
cld = io.open(os.path.join(ROOT, "cloud-functions", "douban-relay-node", "index.js"), encoding="utf-8").read()
ci = cld.index("async function doubanInfo(")
cj = cld.index("function pickSuggestCover(")
region = cld[ci:cj]
for key in ["found:", "title:", "id:", "type:", "dur:", "eps:", "genres:", "year:", "cover:"]:
    if key not in region:
        check("P01", "云端 val 里有 " + key, False, "云端 region 变了，页面读法要重对")
        break
else:
    check("P01", "云端 val 的九个键都在（本机 build_info 的字段集与它逐一对上，见 D10）", True)
check("P02", "云端也是「只认全等」：normName(d.title)!==normName(name) 就 negSet 抛出（本机不许更松）",
      "normName(d.title) !== normName(name)" in region)
check("P03", "云端的分钟数上限同为 600（越界不冒充实测），本机 parse_dur_min 那条线一致",
      "v > 0 && v <= 600" in cld)
check("P04", "云端负缓存也是 10 分钟：NEG_TTL = 10 * 60 * 1000（本机同值，两头不会一边醒着一边锁死）",
      "const NEG_TTL = 10 * 60 * 1000;" in cld)

print("--- ④ 封面这条腿：有豆瓣 id 就别再撞被限流的搜索（v2.50.0）---")
# 现场证据：按名搜索那条腿本机实测 333 次里 330 次 502，我爱我家/编辑部的故事 连着两轮封面全死在它上面；
# 而 rexxar/api/v2/tv/<id> 直问两部都 200（57KB/72KB 图字节）。id 来自 /db-info 的全等闸，不是放宽身份。
_cv_missing = "def _cover_relay(self):" not in srv
if _cv_missing:
    cv = ""
    check("C00", "服务端里有 _cover_relay 整段", False)
else:
    _c0 = srv.index("def _cover_relay(self):")
    _c1 = srv.index("def _iq_relay(self):") if "def _iq_relay(self):" in srv else len(srv)
    cv = srv[_c0:_c1]
    check("C00", "服务端里有 _cover_relay 整段", True)
check("C01", "封面只认 5~9 位数字 id（复用 DB.detail_urls 那把尺），取参仍是 q.get('id')（不校验=任意 URL 代理）",
      (not _cv_missing) and
      cv.count("for du in DB.detail_urls(sid):") == 1 and
      "sid = (q.get('id') or [''])[0].strip()" in cv and ".get('url')" not in cv)
check("C02", "图字节只从 doubanio 域取：域名小写取 hostname 后必须等于 doubanio.com 或以 .doubanio.com 结尾",
      (not _cv_missing) and
      "(urlparse(curl).hostname or '').lower()" in cv and
      "host.endswith('.doubanio.com')" in cv and "host == 'doubanio.com'" in cv)
check("C03", "id 腿排在搜索腿之前，且搜索腿没被拆掉（问不到照旧回落，不比原来少一条路）",
      (not _cv_missing) and
      cv.count("DB.detail_urls(sid)") == 1 and "rexxar/api/v2/search" in cv and
      cv.index("DB.detail_urls(sid)") < cv.index("rexxar/api/v2/search"))
check("C04", "外呼次数有上界：整段里平滑重试的 for _ in range( 只有一处（id 腿不叠第二层重试）",
      (not _cv_missing) and cv.count("for _ in range(") == 1)
check("C05", "封面这条腿一律不写负缓存（拿不到图不许把这部钉死 10 分钟，那是限流不是结论）",
      (not _cv_missing) and "_DB_NEG" not in cv)

print("==== db-info-rules pass=" + str(ok) + " fail=" + str(len(bad)) + " ====")
for b in bad:
    print("  - " + b)
io.open(os.path.join(ROOT, "tests", "last-db-info-rules.json"), "w", encoding="utf-8").write(
    json.dumps({"srv": SRV, "rules": RULES, "pass": ok, "fail": len(bad), "failures": bad}, ensure_ascii=False, indent=1))
sys.exit(1 if bad else 0)
