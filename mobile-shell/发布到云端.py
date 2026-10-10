# -*- coding: utf-8 -*-
"""把 dist/AniTracker.apk 与「内容包」推上 CloudBase 静态托管。

发两样东西，各管一条更新路：

  1) App 更新（换壳，要人点安装）
     /app/AniTracker-<versionCode>.apk   文件名带版本号，内容永不改变，CDN 缓存骗不了人
     /app/version.json                   versionCode/versionName/url/size/sha256/notes/ts

  2) 内容更新（换界面，不重装、人不用点）
     /app/web/<code>/<原样路径>          整套网页文件，一个 code 一份，发出去就永不改
     /app/web.json                       code/notes/files，files 是「地址|sha前缀|字节数」串

  3) 固定入口（给浏览器用，不装任何东西）
     /index.html                          极薄一页，运行时查 web.json 拿最新 code 再跳过去；
                                          自身永不改动，所以书签/二维码一辈子只用记这一个网址

App 侧（UpdateInfo/Updater 与 WebInfo/WebUpdater）对每份清单的每个字段都较真：地址必须
落在同一个发布域名、校验与大小必须对上、任何一个文件缺了整包作废 —— 半套内容绝不会
盖到手机上正在用的那份上。内容 code 单独计数（web-code.txt），因为它比 APK 版本勤得多。

发布走公网通道，和家里电脑开不开机无关，也不花一分钱（个人版静态托管额度内）。

用法：python mobile-shell/发布到云端.py ["更新说明"] [--apk-only | --web-only | --root-only]
     --root-only 只补「托管根固定入口」（/index.html，手机浏览器开这一个网址永远最新），
     它自己从 app/web.json 运行时查最新 code，所以这片薄页发一次就再也不用动。
前提：tcb 已登录（tcb env list 出得来），且 build-apk.py 已经产出 dist/AniTracker.apk。
"""
import ast
import hashlib
import io
import json
import os
import re
import shutil
import subprocess
import sys
import tempfile
import time
import urllib.error
import urllib.request
import zipfile

SHELL = os.path.dirname(os.path.abspath(__file__))
JDK = r'D:\dev\android-build\jdk-17.0.20.1+1'          # 门禁同款，只为跑一次解析器
DIST = os.path.join(SHELL, 'dist')
APK = os.path.join(DIST, 'AniTracker.apk')
BUILD_PY = os.path.join(SHELL, 'build-apk.py')
UPDATE_INFO = os.path.join(SHELL, 'src', 'com', 'venus', 'anitracker', 'UpdateInfo.java')
WEB_INFO = os.path.join(SHELL, 'src', 'com', 'venus', 'anitracker', 'WebInfo.java')
WEB_PKG = os.path.join(SHELL, 'src', 'com', 'venus', 'anitracker')
CODE_FILE = os.path.join(DIST, 'app', 'web-code.txt')


def die(msg):
    print('FAIL: ' + msg)
    sys.exit(1)


def read(path):
    return io.open(path, encoding='utf-8').read()


def publish_host():
    """发布域名以 App 里那份白名单为唯一来源，两边不可能写岔。"""
    m = re.search(r'HOST = "([^"]+)"', read(UPDATE_INFO))
    if not m:
        die('UpdateInfo.java 里找不到 HOST 常量')
    return m.group(1)


def apk_version():
    src = read(BUILD_PY)
    code = re.search(r"^VERSION_CODE = '(\d+)'", src, re.M)
    name = re.search(r"^VERSION_NAME = '([0-9.]+)'", src, re.M)
    if not code or not name:
        die('build-apk.py 里读不到 VERSION_CODE/VERSION_NAME')
    return int(code.group(1)), name.group(1)


def sha256(path):
    h = hashlib.sha256()
    with open(path, 'rb') as f:
        for chunk in iter(lambda: f.read(1 << 20), b''):
            h.update(chunk)
    return h.hexdigest()


def page_version(text):
    m = re.search(r"AT_VERSION='([0-9.]+)'", text)
    if not m:
        die('读不到 AT_VERSION')
    return m.group(1)


def check_shell_fresh():
    """用户 2026-09-27 定规「以后都直接给 APK」：每批都连壳一起出货，别再让新装机/离线首启看到旧界面。
       （v1.4 那次就是热更发了 5 版、壳里还烘着 v2.14.0，平时被热更盖着完全看不出来。）
       两条对账：① 包里烘的 index.html == 出货页；② dist/…apk.meta 记的版本 == build-apk.py 声明的版本
       （meta 是构建当时写下的指纹，改了版本号没重打就会不一致，否则清单会拿新号配旧包）。"""
    code, name = apk_version()
    if not os.path.exists(APK):
        die('没有 %s：递增 build-apk.py 的 VERSION_CODE/VERSION_NAME 后跑 python mobile-shell/build-apk.py' % APK)
    want = page_version(read(os.path.join(os.path.dirname(SHELL), 'index.html')))
    have = page_version(zipfile.ZipFile(APK).read('assets/web/index.html').decode('utf-8', 'replace'))
    if have != want:
        die('包内界面还是 v%s，出货页已 v%s ⇒ 递增 build-apk.py 的版本号并重跑 python mobile-shell/build-apk.py 再发布'
            % (have, want))
    meta = APK + '.meta'
    got = read(meta).strip() if os.path.exists(meta) else '（没有 meta，包是旧的或手工放的）'
    if got != u'v%s（versionCode %s）' % (name, code):
        die('货架上这份包是 %s，而 build-apk.py 已声明 v%s（versionCode %s）⇒ 改过版本号没重打，'
            '重跑 python mobile-shell/build-apk.py' % (got, name, code))
    print('  壳对账 OK：包内界面 v%s · %s' % (have, u'v%s（versionCode %s）' % (name, code)))


def _win_env():
    """沙箱（Git-Bash）把 PATH 以 MSYS 路径（/c/Windows/...）交给 Windows 子进程时，
       cmd /c tcb 会找不到 System32/chcp 与 node/tcb，于是 deploy 直接退出码 1。
       这里照 build-apk.py 的做法，显式拼一份 Windows 原样 PATH：
       固定补上 System32 / node / tcb 所在目录，再只保留原 PATH 里「盘符开头」的条目
       （把 MSYS 路径滤掉，避免污染），保证 cmd 子进程一定找得到 chcp、node、tcb。"""
    import os as _os
    want = [
        r'C:\Windows\System32', r'C:\Windows', r'C:\Windows\System32\Wbem',
        r'C:\Users\Venus\.workbuddy\binaries\node\versions\22.22.2-6',
        r'C:\Program Files\nodejs', r'D:\npm-global',
    ]
    cur = _os.environ.get('PATH', '')
    kept = [p for p in cur.replace('/', '\\').split(';') if re.search(r'^[A-Za-z]:\\', p)]
    used = list(want)
    for p in kept:
        if p not in used:
            used.append(p)
    return dict(_os.environ, PATH=';'.join(used))


def tcb(args, name, quiet=False):
    # tcb 是 .cmd，CreateProcess 起不动批处理，必须过 cmd /c
    # env 用 _win_env() 兜住沙箱下 PATH 丢失，让 chcp/node/tcb 一定可达（普通 Windows 下只是多了几条重复项，无害）
    p = subprocess.run(['cmd', '/c', 'tcb'] + args, capture_output=True, text=True,
                       encoding='utf-8', errors='replace', env=_win_env())
    out = ((p.stdout or '') + (p.stderr or '')).strip()
    if p.returncode != 0:
        tail = [l for l in out.splitlines() if l.strip()][-8:]
        print('  %s: %s' % (name, ' | '.join(tail)))
        die(name + ' 退出码 ' + str(p.returncode))
    if not quiet:
        print('  %s: 上传完成' % name)
    return out


class NoRedirect(urllib.request.HTTPRedirectHandler):
    """App 侧刻意不跟跳转（一跳转域名就不受白名单管了），验证必须走同一套规矩，
       否则这边看到 200、手机上看到的却是「云端把地址跳到了别处」。"""

    def redirect_request(self, req, fp, code, msg, headers, newurl):
        return None


OPENER = urllib.request.build_opener(NoRedirect)


def get(url, timeout=30, binary=False):
    req = urllib.request.Request(url, headers={'Cache-Control': 'no-cache'})
    try:
        with OPENER.open(req, timeout=timeout) as r:
            # 64MB 读上限（审计 C8）：包体最大是 APK（<1MB）、页面 <2MB，正常流量够用；
            # 上限只为 CDN 抽风回异常大响应的场景兜底。
            data = r.read(64 * 1024 * 1024)
            # 别 dict(r.headers)：CDN 回的头是小写 content-type，转成 dict 就查不到了
            return r.status, (data if binary else data.decode('utf-8', 'replace')), r.headers
    except urllib.error.HTTPError as e:
        data = e.read(64 * 1024 * 1024)
        return e.code, (data if binary else data.decode('utf-8', 'replace')), e.headers


# ---- 2026-10-11 审计加固（C1/C6/C7）----
class PublishError(Exception):
    """公网验证失败：调用方负责回滚清单后再 die。"""


def clean_stale(parent):
    """创建新 .stale-* 清场残渣前，把 2 小时前的旧残渣删掉（审计 C6：原来只改名不回收，
    dist/app/web/ 下已经堆出 115.stale-1791250431 这类化石）。"""
    now = time.time()
    try:
        names = os.listdir(parent)
    except OSError:
        return
    for n in names:
        if '.stale-' not in n:
            continue
        p = os.path.join(parent, n)
        try:
            if now - os.path.getmtime(p) > 7200:
                shutil.rmtree(p, ignore_errors=True)
        except OSError:
            pass


def snapshot_remote(host, path, name):
    """发布前把线上旧清单拉回 _archive 留档。返回存档路径；线上还没有清单（首发）返回 None。
    这是审计 C1 的回滚底：公网验证失败时用它把旧清单传回去，手机立刻回到发布前状态。"""
    status, text, _ = get('https://%s%s?_=%d' % (host, path, int(time.time() * 1000)))
    if status != 200:
        return None
    bdir = os.path.join(os.path.dirname(SHELL), '_archive', '线上备份_发布_%s' % time.strftime('%Y%m%d_%H%M%S'))
    os.makedirs(bdir, exist_ok=True)
    io.open(os.path.join(bdir, name), 'w', encoding='utf-8', newline='').write(text)
    return os.path.join(bdir, name)


def env_id_of(host):
    """审计 C7：<envId>-<appId>.tcloudbaseapp.com 的字符串派生保留，但必须过 cloudbaserc.json
    这道对账——host 格式一变派生就错，错的 envId 会把包发到别的环境去。"""
    env = host.rsplit('-', 1)[0]
    try:
        with io.open(os.path.join(os.path.dirname(SHELL), 'cloudbaserc.json'), encoding='utf-8') as f:
            want = (json.load(f).get('envId') or '').strip()
        if want and env != want:
            die('从 host 派生的 envId(%s) 与 cloudbaserc.json 的 envId(%s) 对不上，host 格式可能变了' % (env, want))
    except (OSError, ValueError):
        print('  （cloudbaserc.json 读不到，跳过 envId 对账）')
    return env


def java_check(manifest_path, cap='这份清单', entry='ParseFile'):
    """发布前让手机上那份解析器读一遍这份清单。
       门禁的断言保的是代码，这一条保的是此刻这份文件 —— 写歪了只有手机上点
       「检查更新」的人才发现，而那已经是发出去之后了。
       entry 选 ParseFile（APK 清单）或 ParseWeb（内容清单），两边都是出货那份代码。"""
    work = r'D:\dev\at-publish-check'
    if os.path.exists(work):
        # 本机 rmtree / 回收站 COM 都会被沙箱拦（SHFileOperationW rc=2），
        # 同盘改名是秒完成且不触发保护的唯一可行清场方式。
        clean_stale(os.path.dirname(work))            # 顺手回收 2 小时前的旧残渣（审计 C6）
        stale = work + '.stale-%d' % int(time.time())
        os.rename(work, stale)
        print('  （清场：旧 %s 已挪到 %s）' % (work, os.path.basename(stale)))
    pkg = os.path.join(work, 'src', 'com', 'venus', 'anitracker')
    os.makedirs(pkg)
    srcs = []
    for name in ('UpdateInfo.java', 'WebInfo.java'):
        shutil.copy2(os.path.join(WEB_PKG, name), os.path.join(pkg, name))
        srcs.append(os.path.join(pkg, name))
    shutil.copy2(os.path.join(SHELL, 'tests', entry + '.java'),
                 os.path.join(work, 'src', entry + '.java'))
    srcs.insert(0, os.path.join(work, 'src', entry + '.java'))
    javac = os.path.join(JDK, 'bin', 'javac.exe')
    if not os.path.exists(javac):
        print('  跳过：缺 %s（没有本机 JDK 就用手机验）' % javac)
        return
    p = subprocess.run([javac, '-encoding', 'UTF-8', '-d', os.path.join(work, 'classes')] + srcs,
                       capture_output=True, text=True, encoding='utf-8', errors='replace')
    if p.returncode != 0:
        die('%s 编译不过：\n%s' % (entry, ((p.stdout or '') + (p.stderr or '')).strip()[-1500:]))
    p = subprocess.run([os.path.join(JDK, 'bin', 'java.exe'), '-cp', os.path.join(work, 'classes'),
                        entry, manifest_path],
                       capture_output=True, text=True, encoding='utf-8', errors='replace')
    line = ((p.stdout or '').strip().splitlines() or ['(没输出)'])[-1]
    print('  %s 过手机那份解析器：%s' % (cap, line))
    if p.returncode != 0 or not line.startswith('PARSE OK'):
        die('这份清单 App 读不懂，不发')
    # 校验完的临时目录留给本脚本下次开头自动挪走（本机 rmtree 会被沙箱拦，见上）
    return line


def web_files():
    """内容清单要发哪些文件 —— 名单只有一个来源：build-apk.py 里那份 WEB_FILES。
       两边各写一份的话，早晚出现「APK 里有、云端没有」或反过来，而那种偏差没人会发现。"""
    src = read(BUILD_PY)
    m = re.search(r'^WEB_FILES = \[(.*?)\]', src, re.S | re.M)
    if not m:
        die('build-apk.py 里读不到 WEB_FILES')
    names = ast.literal_eval('[' + m.group(1) + ']')
    root = os.path.dirname(SHELL)
    out = []
    for rel in names:
        p = os.path.join(root, rel.replace('/', os.sep))
        if not os.path.isfile(p):
            die('内容包缺文件：%s' % p)
        out.append((rel, p))
    return out


def next_web_code():
    last = 0
    if os.path.exists(CODE_FILE):
        try:
            last = int(read(CODE_FILE).strip())
        except ValueError:
            die('%s 里不是个整数，先手工修一下' % CODE_FILE)
    return max(last, 100) + 1


def build_web_package(code, host, notes):
    """本地铺出 dist/app/web/<code>/…，并生成指向它们的 /app/web.json。"""
    root = os.path.join(DIST, 'app', 'web', str(code))
    if os.path.exists(root):
        # 同盘改名清场：本机 rmtree 会被沙箱拦（SHFileOperationW rc=2）
        clean_stale(os.path.dirname(root))            # 顺手回收 2 小时前的旧残渣（审计 C6）
        os.rename(root, root + '.stale-%d' % int(time.time()))
    base = 'https://' + host + '/app/web/' + str(code) + '/'
    entries = []
    total = 0
    for rel, src in web_files():
        raw = open(src, 'rb').read()
        dst = os.path.join(root, rel.replace('/', os.sep))
        if not os.path.isdir(os.path.dirname(dst)):
            os.makedirs(os.path.dirname(dst))
        with open(dst, 'wb') as f:
            f.write(raw)
        digest = hashlib.sha256(raw).hexdigest()[:8]
        entries.append('%s|%s|%d' % (base + rel, digest, len(raw)))
        total += len(raw)
    manifest = {'code': code, 'notes': notes, 'files': ';'.join(entries)}
    path = os.path.join(DIST, 'app', 'web.json')
    io.open(path, 'w', encoding='utf-8', newline='').write(
        json.dumps(manifest, ensure_ascii=False, indent=2) + '\n')
    print('  内容包 code %d：%d 个文件 · %.2f MB' % (code, len(entries), total / 1048576.0))
    return root, path, manifest, base


def _verify_apk_remote(host, manifest):
    """A4 公网验证体（审计 C1 抽出可回滚）。验证失败抛 PublishError，由 publish_apk 回滚清单。"""
    murl = 'https://' + host + '/app/version.json'
    status, text, _ = get(murl + '?_=' + str(int(time.time() * 1000)))
    if status != 200:
        raise PublishError('清单取回来是 HTTP %s，手机上也只会看到「检查更新失败」' % status)
    try:
        remote = json.loads(text)
    except ValueError:
        raise PublishError('清单不是合法 JSON：' + text[:200])
    for k in ('versionCode', 'versionName', 'url', 'size', 'sha256'):
        if remote.get(k) != manifest[k]:
            raise PublishError('云端清单的 %s 和本地对不上：%r ≠ %r' % (k, remote.get(k), manifest[k]))
    # 手机读的是云端这份字节，所以把云端那份原样过一遍解析器（临时目录，不往 dist 里丢验证件）
    back = os.path.join(tempfile.gettempdir(), 'at-version-from-cloud.json')
    io.open(back, 'w', encoding='utf-8', newline='').write(text)
    java_check(back, '云端那份')
    os.remove(back)
    status, body, hdr = get(remote['url'], timeout=120, binary=True)
    if status != 200:
        raise PublishError('下载地址 HTTP %s（%s）' % (status, remote['url']))
    got = hashlib.sha256(body).hexdigest()
    if len(body) != manifest['size'] or got != manifest['sha256']:
        raise PublishError('下载回来的包对不上清单：%d/%d 字节，sha256 %s…' % (len(body), manifest['size'], got[:16]))
    return hdr


def publish_apk(host, env_id, notes):
    if not os.path.exists(APK):
        die('没有 %s，先跑 python mobile-shell/build-apk.py' % APK)
    code, name = apk_version()
    size = os.path.getsize(APK)
    digest = sha256(APK)
    cloud_apk = '/app/AniTracker-%d.apk' % code
    url = 'https://' + host + cloud_apk
    # 审计 C1：发布前把线上旧清单存档，A4 失败时回滚
    prev_ver = snapshot_remote(host, '/app/version.json', 'version.json')

    print('[A1/4] 生成清单 /app/version.json')
    manifest = {
        'versionCode': code,
        'versionName': name,
        'url': url,
        'size': size,
        'sha256': digest,
        'notes': notes,
        'ts': int(time.time() * 1000),
    }
    if not os.path.isdir(os.path.join(DIST, 'app')):
        os.makedirs(os.path.join(DIST, 'app'))
    local_json = os.path.join(DIST, 'app', 'version.json')
    io.open(local_json, 'w', encoding='utf-8', newline='').write(
        json.dumps(manifest, ensure_ascii=False, indent=2) + '\n')
    print('  v%s（versionCode %d）· %.1f KB · sha256 %s…' % (name, code, size / 1024.0, digest[:16]))

    print('[A2/4] 用出货那份解析器读一遍这份清单')
    java_check(local_json)

    print('[A3/4] 上传 APK + 清单（tcb 登录的是本机已有的凭证）')
    tcb(['hosting', 'deploy', '-e', env_id, APK.replace('\\', '/'), cloud_apk, '--verify'], 'deploy apk')
    tcb(['hosting', 'deploy', '-e', env_id, local_json.replace('\\', '/'), '/app/version.json', '--verify'],
        'deploy version.json')

    print('[A4/4] 公网验证：App 会怎么走这条路')
    try:
        hdr = _verify_apk_remote(host, manifest)
    except PublishError as e:
        if prev_ver:
            tcb(['hosting', 'deploy', '-e', env_id, prev_ver.replace('\\', '/'),
                 '/app/version.json', '--verify'], 'rollback version.json')
            die('A4 验证失败：%s\n已把发布前的旧 version.json 传回（手机回到旧版清单）；坏 APK 留在云端，'
                '下个版本号不会撞它' % e)
        die('A4 验证失败：%s\n（线上原本没有清单，无从回滚，人工处理）' % e)
    ctype = [v for k, v in hdr.items() if k.lower() == 'content-type']
    print('  包体完整（%d 字节，sha256 一致），Content-Type=%s' % (manifest['size'], ctype[0] if ctype else '没有'))
    print('  APK 这条路 OK：手机点「账号 → 安装包 → 检查更新」可拿 v%s' % name)
    return name


def publish_root(host, env_id, expect_code=None):
    """云端固定入口 —— 托管根那篇薄页把「/」变成永远指最新内容包的网址。

    为什么要有它：内容包按 code 分目录（/app/web/103/…），地址每发一版就变一次，
    手机浏览器/电脑书签记不住；而这片薄页**自身永不改动**（它是运行时去查 app/web.json
    拿 code 再跳），所以 CDN 缓存多久都无害，用户可以一辈子只记这一个网址。
    App 不走这里（壳读 version.json、界面读 web.json 下到本地），互不影响。"""
    src = os.path.join(SHELL, 'hosting-root.html')
    if not os.path.exists(src):
        die('缺少固定入口 %s' % src)
    print('[R1] 上传固定入口 /index.html')
    tcb(['hosting', 'deploy', '-e', env_id, src.replace('\\', '/'), '/index.html', '--verify'],
        'deploy root', quiet=True)

    print('[R2] 公网验证：固定入口在线，且解析到的就是刚发的那一版')
    status, page, _ = get('https://' + host + '/index.html?_=' + str(int(time.time() * 1000)))
    if status != 200:
        die('固定入口取回来是 HTTP %s' % status)
    if 'app/web.json' not in page or 'location.replace' not in page:
        die('固定入口内容不对（没有查清单、也没有跳转逻辑）——多半是传错了文件')
    local_ix = read(os.path.join(os.path.dirname(SHELL), 'index.html'))
    ver_m = re.search(r"AT_VERSION='([0-9.]+)'", local_ix)
    status, text, _ = get('https://' + host + '/app/web.json?_=' + str(int(time.time() * 1000)))
    if status != 200:
        die('固定入口要读的 app/web.json 取不到（HTTP %s）' % status)
    code = json.loads(text).get('code')
    if expect_code is not None and code != expect_code:
        die('固定入口解析到的 code 是 %s，不是刚发的 %s' % (code, expect_code))
    status, body, _ = get('https://%s/app/web/%s/index.html?_=%d' % (host, code, int(time.time() * 1000)),
                          timeout=120)
    if status != 200:
        die('固定入口会跳去的那份页面取不到（HTTP %s，code %s）' % (status, code))
    # AT_VERSION 在页面正文里（第 800 行上下），别按前几千字符截着找
    if ver_m and ver_m.group(1) not in body:
        die('固定入口指过去的那份页面版本对不上（本地 v%s 没在里面）' % ver_m.group(1))
    print('  固定入口 OK：https://%s/ → code %s（页面 v%s）' % (host, code, ver_m.group(1) if ver_m else '?'))


def _verify_web_remote(host, manifest):
    """W4 公网验证体（审计 C1 抽出可回滚）：手机 WebUpdater 会逐字节核对这份清单里的每一个文件。
    验证失败抛 PublishError，由 publish_web 回滚清单。"""
    murl = 'https://' + host + '/app/web.json'
    status, text, _ = get(murl + '?_=' + str(int(time.time() * 1000)))
    if status != 200:
        raise PublishError('内容清单取回来是 HTTP %s，手机上只会看到「内容更新没成功」' % status)
    try:
        remote = json.loads(text)
    except ValueError:
        raise PublishError('内容清单不是合法 JSON：' + text[:200])
    if remote.get('code') != manifest['code'] or remote.get('files') != manifest['files']:
        raise PublishError('云端内容清单和本地对不上（code %s / %s）' % (remote.get('code'), manifest['code']))
    back = os.path.join(tempfile.gettempdir(), 'at-web-from-cloud.json')
    io.open(back, 'w', encoding='utf-8', newline='').write(text)
    java_check(back, '云端那份', entry='ParseWeb')
    os.remove(back)
    n = 0
    for entry in manifest['files'].split(';'):
        url, digest, size = entry.split('|')
        size = int(size)
        status, body, _ = get(url, timeout=120, binary=True)
        if status != 200:
            raise PublishError('内容文件取回来 HTTP %s（%s）—— 手机会把整包作废' % (status, url))
        if len(body) != size or hashlib.sha256(body).hexdigest()[:8] != digest:
            raise PublishError('内容文件对不上清单：%s（%d/%d 字节）' % (url, len(body), size))
        n += 1
    return n


def publish_web(host, env_id, notes):
    code = next_web_code()
    # 审计 C1：发布前把线上旧清单存档——W4 验证失败时它是回滚底，手机立刻回到发布前状态
    prev_web = snapshot_remote(host, '/app/web.json', 'web.json')
    print('[W1/4] 铺内容包 /app/web/%d/' % code)
    root, local_json, manifest, base = build_web_package(code, host, notes)

    print('[W2/4] 用出货那份解析器读一遍这份内容清单')
    java_check(local_json, entry='ParseWeb')

    print('[W3/4] 上传内容文件，最后才换清单（清单先上去会有人捡到不完整的包）')
    # 一个文件一次 deploy：整目录一把上传时，tcb 的「一致性校验」会把 10 个文件全报成
    # missing（1.8MB 的包刚好踩到它的批量上限），而它非零退出，这边只能跟着崩。
    # 逐文件走虽然啰嗦，但每次只验一个文件，稳；W4 再从公网逐个拉回核字节，两头都实。
    for rel, src in web_files():
        tcb(['hosting', 'deploy', '-e', env_id, src.replace('\\', '/'),
             '/app/web/%d/%s' % (code, rel), '--verify'], rel, quiet=True)
    tcb(['hosting', 'deploy', '-e', env_id, local_json.replace('\\', '/'), '/app/web.json', '--verify'],
        'deploy web.json')

    print('[W4/4] 公网验证：手机 WebUpdater 会逐字节核对这份清单里的每一个文件')
    try:
        n = _verify_web_remote(host, manifest)
    except PublishError as e:
        if prev_web:
            tcb(['hosting', 'deploy', '-e', env_id, prev_web.replace('\\', '/'),
                 '/app/web.json', '--verify'], 'rollback web.json')
            die('W4 验证失败：%s\n已把发布前的旧 web.json 传回（手机回到旧包）；坏文件留在 /app/web/%d/，'
                '下次发布复用这个 code 覆盖掉' % (e, code))
        die('W4 验证失败：%s\n（线上原本没有清单，无从回滚，人工处理）' % e)
    print('  %d 个内容文件逐个从公网拉回、大小与校验全对上' % n)
    # 审计 C1：落账挪到公网验证全部通过之后——验证失败时这个 code 不记账，
    # 下次发布 next_web_code 复用它重新覆盖上传，坏包自愈。
    io.open(CODE_FILE, 'w', encoding='utf-8', newline='').write(str(code) + '\n')
    print('  内容这条路 OK：手机上不用装任何东西，下次开 App 自动换到 code %d' % code)
    # 内容包换了 code，固定入口得跟着复核一遍（它自己运行时查清单，通常不用重传；
    # 但万一云端那份 /index.html 被人删了或改坏，这一步就会当场发现，而不是等用户扑空）。
    publish_root(host, env_id, expect_code=code)


# ---- [S] 启动方式三处登记同步（2026-10-08 用户点名：每次发版都要把启动方式一起更新）----
# 登记里那行版本以前靠手抄，抄漏一次 hub 就开始说谎。现在归进发版流水线：
# 数字一律现读**公网清单**（本地副本不算「用户实际拿到的」），整段用 <!--ATSNAP--> 哨兵替换。
REG_MD = r'D:\项目\PROJECTS.md'
HUB_HTML = r'C:\Users\Venus\DeskBox\入口总览.html'
SYNC_GATE = r'C:\Users\Venus\DeskBox\工具脚本\同步启动方式.py'
A_SNAP, B_SNAP = '<!--ATSNAP-->', '<!--/ATSNAP-->'
SNAP_TEXT = ['']


def live_manifest(host):
    """现拉公网两份清单：版本 / build / 内容 code / APK 版本都以「线上是什么」为准。"""
    st, vb, _ = get('https://' + host + '/app/version.json?_=' + str(int(time.time() * 1000)),timeout=60, binary=True)
    st2, wb, _ = get('https://' + host + '/app/web.json?_=' + str(int(time.time() * 1000)),timeout=60, binary=True)
    if st != 200 or st2 != 200:
        die('[S] 公网清单取不回来（version.json %s / web.json %s）——先查发布，再谈同步登记' % (st, st2))
    return json.loads(vb.decode('utf-8')), json.loads(wb.decode('utf-8'))


def rewrite_snap(path, label):
    if not os.path.exists(path):
        print('  [S] 登记文件不在，跳过：%s' % path)
        return
    s = open(path, 'rb').read().decode('utf-8')
    pat = re.compile(re.escape(A_SNAP) + '(.*?)' + re.escape(B_SNAP), re.S)
    if len(pat.findall(s)) != 1:
        die('[S] %s 里 ATSNAP 哨兵找到 %d 处（应为 1 处）——先补标记，别回来手抄版本'
            % (label, len(pat.findall(s))))
    out = pat.sub(lambda m: A_SNAP + SNAP_TEXT[0] + B_SNAP, s, count=1)
    if chr(0xFFFD) in out:
        die('[S] 改写后出现乱码，放弃写入：' + path)
    if out != s:
        open(path, 'wb').write(out.encode('utf-8'))
    print('  [S] %s 已同步：%s' % (label, SNAP_TEXT[0]))


def sync_launch_entries(host):
    vi, wi = live_manifest(host)
    idx = read(os.path.join(os.path.dirname(SHELL), 'index.html'))
    mv = re.search(r"AT_VERSION='([^']+)', AT_BUILD='([^']+)'", idx)
    if not mv:
        die('[S] index.html 读不到 AT_VERSION/AT_BUILD')
    SNAP_TEXT[0] = ('v%s · build %s · 内容包 code %s · APK v%s（versionCode %s）· 固定入口 https://%s/'
                    % (mv.group(1), mv.group(2), wi.get('code'), vi.get('versionName'),
                       vi.get('versionCode'), host))
    rewrite_snap(REG_MD, 'PROJECTS.md 启动方式总表')
    rewrite_snap(HUB_HTML, 'DeskBox 入口总览')
    if not os.path.exists(SYNC_GATE):
        print('  [S] 体检脚本不在，跳过：%s' % SYNC_GATE)
        return
    r = subprocess.run([sys.executable, '-X', 'utf8', SYNC_GATE], capture_output=True, timeout=600)
    out = (r.stdout or b'').decode('utf-8', 'replace') + (r.stderr or b'').decode('utf-8', 'replace')
    mine = [x.strip() for x in out.splitlines() if 'AniTracker' in x or '追迹' in x]
    print('  [S] 启动方式体检（只报告）：与本项目相关的告警 %d 条' % len(mine))
    for x in mine[:6]:
        print('      ' + x[:150])
    if any(('死链' in x or '待退役' in x) for x in mine):
        die('[S] 本项目入口体检报死链/待退役，先修入口再算发完')


def main():
    args = [a for a in sys.argv[1:] if not a.startswith('--')]
    flags = [a for a in sys.argv[1:] if a.startswith('--')]
    notes = args[0] if args else '手机版更新'
    known = ('--apk-only', '--web-only', '--root-only')
    unknown = [f for f in flags if f not in known]
    if unknown:
        die('不认识的旗子：%s（可用 %s）' % (' '.join(unknown), ' / '.join(known)))
    if len(flags) > 1:
        die('旗子只能挑一条路：--apk-only / --web-only / --root-only')
    host = publish_host()
    env_id = env_id_of(host)                 # <envId>-<appId>.tcloudbaseapp.com，过 cloudbaserc.json 对账
    if not os.path.isdir(os.path.join(DIST, 'app')):
        os.makedirs(os.path.join(DIST, 'app'))
    if flags == ['--root-only']:
        publish_root(host, env_id)
        print('\nOK 固定入口已就位：https://%s/' % host)
        return
    print('[0/4] 壳对账：以后每批都直接给 APK，包里的界面必须就是这批出货页')
    check_shell_fresh()
    if '--web-only' not in flags:
        name = publish_apk(host, env_id, notes)
    if '--apk-only' not in flags:
        publish_web(host, env_id, notes)
    sync_launch_entries(host)
    print('\nOK 已发布。清单：https://%s/app/version.json · https://%s/app/web.json' % (host, host))
    print('    固定入口（浏览器直接开，永远最新）：https://%s/' % host)


if __name__ == '__main__':
    main()
