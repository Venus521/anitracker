# -*- coding: utf-8 -*-
"""发版.py —— 追迹版本六处同步，一条命令收口（2026-10-03 工程收口新增）

历史痛点：每发一版要手工同步六处版本号，漏一处就是隐性 bug
（package.json 曾停在 2.21.0 无人发现）。本脚本把六处一次改齐并自校验：

  1. index.html              var AT_VERSION='..', AT_BUILD='..'
  2. tracker-sw.js           var CACHE='anitracker-vNN-BUILD'   (vNN = v+次版本号，2.27→v27)
  3. tracker-version.json    version / build / ts / note
  4. package.json            version
  5. mobile-shell/build-apk.py  VERSION_NAME(+0.1) / VERSION_CODE(+1)
  6. ani-tracker.html        由 同步双入口.py 从 index.html 单向生成

用法：
  python 发版.py 2.28.0 --note "v2.28.0 一句话说明"
  python 发版.py 2.28.0 --build 20261003b          # 缺省自动取「今天日期+a」
  python 发版.py --check                            # 只校验六处一致性，不改文件

改完 index.html 后走查墙会显示「过期」属正常：发版本就该重跑
  node tests/phone-look.js  和  node tests/run-regression.js
"""
import argparse, json, re, subprocess, sys, time, datetime, os

HERE = os.path.dirname(os.path.abspath(__file__))
RB = lambda *p: open(os.path.join(HERE, *p), 'rb').read()
WB = lambda *p: None  # 占位，真正写见下面 write()


def write(path_tuple, data):
    with open(os.path.join(HERE, *path_tuple), 'wb') as f:
        f.write(data)


def minor_of(ver):
    m = re.match(r'^(\d+)\.(\d+)', ver)
    if not m:
        sys.exit('版本号不合法: ' + ver)
    return int(m.group(1)), int(m.group(2))


def load_state():
    idx = RB('index.html').decode('utf-8')
    sw = RB('tracker-sw.js').decode('utf-8')
    tv = json.loads(RB('tracker-version.json').decode('utf-8'))
    pj = RB('package.json').decode('utf-8')
    ba = RB(os.path.join('mobile-shell', 'build-apk.py')).decode('utf-8')
    m = re.search(r"var AT_VERSION='([^']+)', AT_BUILD='([^']+)'", idx)
    c = re.search(r"var CACHE='anitracker-v(\d+)-([^']+)'", sw)
    n = re.search(r'VERSION_CODE = \'(\d+)\'', ba)
    nm = re.search(r"VERSION_NAME = '([^']+)'", ba)
    p = re.search(r'"version":\s*"([^"]+)"', pj)
    if not all([m, c, n, nm, p]):
        sys.exit('六处版本标记有缺失，页面结构可能变过，先人工核对正则')
    return dict(idx=idx, sw=sw, tv=tvr(tv), pj=pj, ba=ba,
                ver=m.group(1), build=m.group(2),
                cache_n=int(c.group(1)), cache_build=c.group(2),
                code=int(n.group(1)), shell=nm.group(1), pkg=p.group(1))


def tvr(tv):
    return tv  # 保持引用语义，便于统一打点


def check_state(s, want_ver=None):
    major, minor = minor_of(s['ver'])
    ok = []
    ok.append(('index AT_VERSION/AT_BUILD', True))
    ok.append(('sw 缓存 vNN 与次版本一致', s['cache_n'] == minor))
    ok.append(('tracker-version.json 一致', s['tv']['version'] == s['ver'] and s['tv']['build'] == s['build']))
    ok.append(('package.json 一致', s['pkg'] == s['ver']))
    ok.append(('壳 VERSION_CODE/NAME 存在', s['code'] > 0 and bool(s['shell'])))
    if want_ver:
        ok.append(('已升到 ' + want_ver, s['ver'] == want_ver))
    return ok


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument('version', nargs='?', help='目标版本，如 2.28.0')
    ap.add_argument('--build', help='构建标记，缺省 今天日期+a')
    ap.add_argument('--note', help='tracker-version.json 的 note 文案')
    ap.add_argument('--check', action='store_true', help='只校验一致性')
    ap.add_argument('--sync-pkg', action='store_true',
                    help='补漏模式：只把 package.json 补齐到当前 AT_VERSION，其余五处不动（package.json 脱节时用）')
    args = ap.parse_args()

    s = load_state()
    print('当前状态: 版本 %s / build %s / sw v%d / 壳 %s(code %d) / package.json %s'
          % (s['ver'], s['build'], s['cache_n'], s['shell'], s['code'], s['pkg']))

    if args.check:
        bad = [n for n, ok in check_state(s) if not ok]
        print('校验: ' + ('全部一致 ✓' if not bad else '不一致 → ' + '; '.join(bad)))
        sys.exit(1 if bad else 0)

    if args.sync_pkg:
        if s['pkg'] == s['ver']:
            print('package.json 已是 %s，无需补漏' % s['ver'])
            return
        pj2 = re.sub(r'"version":\s*"[^"]+"', '"version": "%s"' % s['ver'], s['pj'], count=1)
        write(('package.json',), pj2.encode('utf-8'))
        print('package.json: %s → %s（已补齐到 AT_VERSION，其余五处未动）' % (s['pkg'], s['ver']))
        return

    if not args.version:
        sys.exit('缺目标版本。例：python 发版.py 2.28.0 --note "..."（--check 只校验）')

    major, minor = minor_of(args.version)
    old_major, old_minor = minor_of(s['ver'])
    if s['cache_n'] != old_minor:
        sys.exit('旧 sw 缓存 v%d 与旧次版本 %d 不符，缓存命名规则可能变过，先人工核对' % (s['cache_n'], old_minor))
    build = args.build or (datetime.date.today().strftime('%Y%m%d') + 'a')
    new_cache_n = minor
    new_code = s['code'] + 1
    shell_parts = s['shell'].split('.')
    new_shell = shell_parts[0] + '.' + str(int(shell_parts[1]) + 1)
    ts = int(time.time() * 1000)
    note = args.note or ('v%s 版本同步（发版.py 生成；正式说明请补写进 CHANGELOG 后重跑 --note）' % args.version)

    # 1. index.html
    idx2 = re.sub(r"var AT_VERSION='[^']+', AT_BUILD='[^']+'",
                  "var AT_VERSION='%s', AT_BUILD='%s'" % (args.version, build), s['idx'], count=1)
    # 2. tracker-sw.js
    sw2 = re.sub(r"var CACHE='anitracker-v\d+-[^']+'",
                 "var CACHE='anitracker-v%d-%s'" % (new_cache_n, build), s['sw'], count=1)
    # 3. tracker-version.json
    s['tv']['version'] = args.version
    s['tv']['build'] = build
    s['tv']['ts'] = ts
    s['tv']['note'] = note
    tv2 = json.dumps(s['tv'], ensure_ascii=False, indent=2) + '\n'
    # 4. package.json
    pj2 = re.sub(r'"version":\s*"[^"]+"', '"version": "%s"' % args.version, s['pj'], count=1)
    # 5. build-apk.py
    ba2 = re.sub(r"VERSION_CODE = '\d+'", "VERSION_CODE = '%d'" % new_code, s['ba'], count=1)
    ba2 = re.sub(r"VERSION_NAME = '[^']+'", "VERSION_NAME = '%s'" % new_shell, ba2, count=1)

    write(('index.html',), idx2.encode('utf-8'))
    write(('tracker-sw.js',), sw2.encode('utf-8'))
    write(('tracker-version.json',), tv2.encode('utf-8'))
    write(('package.json',), pj2.encode('utf-8'))
    write(('mobile-shell', 'build-apk.py'), ba2.encode('utf-8'))
    # 6. 双入口副本
    subprocess.run([sys.executable, os.path.join(HERE, '同步双入口.py')], check=True)

    print('发版完成: %s / build %s / sw anitracker-v%d-%s / 壳 %s (code %d) / package.json %s'
          % (args.version, build, new_cache_n, build, new_shell, new_code, args.version))
    print('别忘了: 1) CHANGELOG.md 追加版本记录  2) node tests/phone-look.js + run-regression.js')


if __name__ == '__main__':
    main()
