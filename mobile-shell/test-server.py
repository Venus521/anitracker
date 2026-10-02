"""桌面真跑 LocalServer —— 白屏那次就是因为「绑了端口却没人 accept」，
   这种错光看代码容易漏，直接把 APK 里那份 Java 在电脑上跑起来发请求才看得见。

   LocalServer 只依赖 Context 的 getAssets()/外置目录，所以几个 stub 就够，
   测的是**出货用的同一份源码**。顺带在同一套源码上跑另两件事：
   UpdateInfo / WebInfo / WebUpdater（App 内更新的清单解析、下载白名单与内容包落盘，
   纯 JDK 所以照样原样跑），以及手机侧全部 .java 对着 android.jar 的编译（只编不跑）。
   用法：python mobile-shell/test-server.py
"""
import http.server
import io
import json
import os
import re
import shutil
import socket
import subprocess
import sys
import threading
import time
import urllib.error
import urllib.request
from urllib.parse import urlparse

JDK = r'D:\dev\android-build\jdk-17.0.20.1+1'
ANDROID_JAR = r'D:\dev\android-build\sdk\platforms\android-34\android.jar'
SHELL = os.path.dirname(os.path.abspath(__file__))        # mobile-shell
SRC = os.path.join(SHELL, 'tests')                        # stub 与桌面入口在这
SHELL_PKG = os.path.join(SHELL, 'src', 'com', 'venus', 'anitracker')
PROJ = os.path.dirname(SHELL)                             # ani-tracker
WORK = r'D:\dev\at-server-test'                           # 纯 ASCII，中文路径会让工具链发疯

RESULTS = []
# 断言条数不写死：从 UpdateMain 源码里数 check("U..") / check("W..")，加一条就自动跟上，
# 但一条 CASE 没跑出来仍然算失败 —— 漏跑比少跑更难看。
CASE_SRC = os.path.join(SRC, 'UpdateMain.java')


def check(name, ok, extra=''):
    RESULTS.append((name, bool(ok)))
    print('  %s %s%s' % ('OK  ' if ok else 'FAIL', name, ('  ' + extra) if extra else ''))


def java_case_names():
    """数一遍 UpdateMain 里声明的 CASE 名（U*/W*），作为「该跑几条」的依据。"""
    with io.open(CASE_SRC, encoding='utf-8') as f:
        return set(re.findall(r'check\("([UW]\d+[a-z]?)\s', f.read()))


def sh(cmd, name):
    p = subprocess.run(cmd, capture_output=True, text=True, encoding='utf-8', errors='replace')
    if p.returncode != 0:
        print(((p.stdout or '') + (p.stderr or '')).strip()[-2500:])
        print('FAIL: ' + name)
        sys.exit(1)
    return (p.stdout or '')


def get(base, path, method='GET', timeout=8):
    req = urllib.request.Request(base + path, method=method)
    try:
        with urllib.request.urlopen(req, timeout=timeout) as r:
            return r.status, r.read(), dict(r.headers)
    except urllib.error.HTTPError as e:
        return e.code, e.read(), dict(e.headers)


def wait_ready(proc):
    """JVM 会把 Picked up JAVA_TOOL_OPTIONS 提示和我们的 READY 挤在同一行，按关键字切。"""
    buf = ''
    for _ in range(20):
        chunk = proc.stdout.readline()
        if not chunk:
            break
        buf += chunk
        if 'READY' in buf:
            return buf.split('READY', 1)[1].split()[0].strip()
    sys.exit('FAIL: 没起来 —— ' + repr(buf))


def origin(page_url):
    """pageUrl() 带 /index.html，请求要的是 origin，直接拿它当前缀会拼出 /index.html/xxx 全 404。"""
    u = urlparse(page_url)
    return '%s://%s:%d' % (u.scheme, u.hostname, u.port)


def main():
    print('[1/8] 准备 ASCII 工作区')
    if os.path.exists(WORK):
        shutil.rmtree(WORK)
    os.makedirs(os.path.join(WORK, 'src'))
    for rel in ('stubs', 'ServerMain.java', 'UpdateMain.java', 'ParseFile.java'):
        s = os.path.join(SRC, rel)
        d = os.path.join(WORK, 'src', rel)
        (shutil.copytree if os.path.isdir(s) else shutil.copy2)(s, d)
    # 被测源码包名要和目录一致
    pkg = os.path.join(WORK, 'src', 'com', 'venus', 'anitracker')
    os.makedirs(pkg)
    for name in ('LocalServer.java', 'UpdateInfo.java', 'WebInfo.java', 'WebUpdater.java',
                 'Net.java'):
        shutil.copy2(os.path.join(SHELL, 'src', 'com', 'venus', 'anitracker', name),
                     os.path.join(pkg, name))
    if not os.path.isdir(os.path.join(SHELL, 'assets', 'web')):
        print('FAIL: 先跑一次 build-apk.py 生成 assets/web')
        sys.exit(1)
    shutil.copytree(os.path.join(SHELL, 'assets'), os.path.join(WORK, 'assets'))

    print('[2/8] javac（桌面 JDK，stub 顶替 android 类）')
    # 这里用本机 JDK 默认的字节码档：真机上那份兼容性由 [4/8] 的 android.jar 编译把关，
    # 而测试入口要起本机假发布服（com.sun.net.httpserver），那套东西在 -source 1.8 下根本不让引。
    files = []
    for base, _, fs in os.walk(os.path.join(WORK, 'src')):
        files += [os.path.join(base, f) for f in fs if f.endswith('.java')]
    sh([os.path.join(JDK, 'bin', 'javac.exe'), '-encoding', 'UTF-8',
        '-d', os.path.join(WORK, 'classes')] + files, 'javac')

    # 云端两份清单（APK 包 / 内容包）的解析、白名单与落盘是「往手机里装什么」的最后一道闸，
    # 必须在电脑上把出货那几份 .java 原样跑一遍，别等到手机上才发现认不出清单。
    print('[3/8] UpdateInfo + WebInfo + WebUpdater（清单解析 / 地址白名单 / 内容包落盘）')
    declared = java_case_names()
    p = subprocess.run([os.path.join(JDK, 'bin', 'java.exe'), '-cp',
                        os.path.join(WORK, 'classes'), 'UpdateMain'],
                       capture_output=True, text=True, encoding='utf-8', errors='replace')
    ran = set()
    for line in (p.stdout or '').splitlines():
        # UpdateMain 报的是「U01 说明…」整句，声明表里只取开头那个编号，两边按编号对齐
        if line.startswith('CASE OK ') or line.startswith('CASE FAIL '):
            tag = line[8:].split(' ')[0]
            ran.add(tag)
            check(line[8:], line.startswith('CASE OK '))
    missing = sorted(declared - ran)
    check('U00 断言全部执行且进程正常退出',
          ran == declared and p.returncode == 0 and len(declared) > 0,
          '声明 %d 条 / 实跑 %d 条，退出码 %s%s' % (
              len(declared), len(ran), p.returncode,
              ('，漏跑：' + ' | '.join(missing)) if missing else ''))
    if not ran:
        print(((p.stderr or '')).strip()[-1500:])

    # 手机侧的类平时只有打包那一刻才被编译，而 build-apk 又要求整个链路跑完。
    # 这里单独对着 android.jar 编一遍（只编不跑）：API 名字记错、少个 import，
    # 在电脑上就该撞响，而不是等装到手机上才发现壳起不来。
    print('[4/8] 手机侧源码对 android.jar 编译（只编不跑）')
    if os.path.exists(ANDROID_JAR):
        asrc = os.path.join(WORK, 'android-src', 'com', 'venus', 'anitracker')
        os.makedirs(asrc)
        java = []
        for f in sorted(os.listdir(SHELL_PKG)):
            if f.endswith('.java'):
                d = os.path.join(asrc, f)
                shutil.copy2(os.path.join(SHELL_PKG, f), d)
                java.append(d)
        sh([os.path.join(JDK, 'bin', 'javac.exe'), '-source', '1.8', '-target', '1.8',
            '-encoding', 'UTF-8', '-bootclasspath', ANDROID_JAR, '-classpath', ANDROID_JAR,
            '-d', os.path.join(WORK, 'classes-android')] + java, 'javac（android.jar）')
        check('A01 壳里全部 %d 个源文件对着 android.jar 编得过' % len(java), True)
    else:
        print('  跳过：缺 ' + ANDROID_JAR + '（先跑 D:\\dev\\android-build\\install-sdk.py）')

    # 上游假服务器：只有一个 assets 里没有的 probe.txt，用来证明「代理真的转发了」
    print('[5/8] 起假上游 + 造一份热更内容目录')
    updir = os.path.join(WORK, 'upstream')
    os.makedirs(updir)
    with open(os.path.join(updir, 'probe.txt'), 'w') as f:
        f.write('FROM-UPSTREAM')
    # 热更层：长得和 WebUpdater 落下来的那个 code 目录一模一样（含 vendor/ 子目录）
    overlay = os.path.join(WORK, 'content', '77')
    os.makedirs(os.path.join(overlay, 'vendor'))
    with io.open(os.path.join(overlay, 'index.html'), 'w', encoding='utf-8') as f:
        f.write('<html>AT_VERSION OVERLAY-CONTENT-77</html>')
    with io.open(os.path.join(overlay, 'only-in-overlay.js'), 'w', encoding='utf-8') as f:
        f.write('OVERLAY-ONLY')
    with io.open(os.path.join(overlay, 'vendor', 'cloudbase.full.js'), 'w', encoding='utf-8') as f:
        f.write('OVERLAY-SDK')
    with socket.socket() as sk:
        sk.bind(('127.0.0.1', 0))
        upport = sk.getsockname()[1]
    srv = http.server.ThreadingHTTPServer(('127.0.0.1', upport),
                                          lambda *a: http.server.SimpleHTTPRequestHandler(*a, directory=updir))
    threading.Thread(target=srv.serve_forever, daemon=True).start()

    print('[6/8] 跑被测服务器（只有 APK 内置那份）+ 发请求')
    # 电脑端 8089 通常已被占用 → 顺带验证「首选端口被占就往后退」
    proc = subprocess.Popen(
        [os.path.join(JDK, 'bin', 'java.exe'), '-cp', os.path.join(WORK, 'classes'),
         'ServerMain', os.path.join(WORK, 'assets'), 'http://127.0.0.1:%d' % upport],
        stdout=subprocess.PIPE, stderr=subprocess.STDOUT, text=True, encoding='utf-8')
    ready = wait_ready(proc)
    print('  ' + ready)
    base = origin(ready)
    port = int(urlparse(base).port)
    check('S01 端口落在候选段内（8089 被电脑端占着就自动后退）',
          port in (8089, 8090, 8091, 8092, 8093, 8094, 8095), 'port=%d' % port)

    code, body, hdr = get(base, '/index.html')
    check('S02 GET /index.html 出得来（白屏那次就是卡在这）',
          code == 200 and b'AT_VERSION' in body, '%s %dB' % (code, len(body)))
    check('S03 Content-Type 是 text/html 且带 charset',
          'text/html' in hdr.get('Content-Type', '') and 'utf-8' in hdr.get('Content-Type', '').lower(),
          hdr.get('Content-Type', ''))
    code, body2, _ = get(base, '/')
    check('S04 根路径 / 落到 index.html', code == 200 and body2 == body)
    code, body3, _ = get(base, '/tracker-version.json?_=1790000000000')
    try:
        ver = json.loads(body3.decode('utf-8')).get('version')
    except Exception:
        ver = None
    check('S05 带 query 也能取到，且是合法 JSON', code == 200 and bool(ver), str(ver))
    code, body4, _ = get(base, '/vendor/cloudbase.full.js')
    real = os.path.getsize(os.path.join(WORK, 'assets', 'web', 'vendor', 'cloudbase.full.js'))
    check('S06 子目录大文件完整（SDK 840KB）', code == 200 and len(body4) == real,
          '%d/%d' % (len(body4), real))
    code, body5, _ = get(base, '/nope-does-not-exist.js')
    check('S07 不存在的文件回 404 而不是崩', code == 404, str(code))
    code, _, _ = get(base, '/../%2e%2e/windows/win.ini')
    check('S08 路径穿越（含 %2e 编码）一律不放行', code in (400, 404), str(code))
    code, body6, _ = get(base, '/index.html', method='HEAD')
    check('S09 HEAD 只回头不回头（协议正确）', code == 200 and body6 == b'', str(code))

    code, bodyA, _ = get(base, '/probe.txt')
    check('S10 上游在线：assets 里没有的文件是从电脑那边代理来的',
          code == 200 and bodyA == b'FROM-UPSTREAM', str(code))
    code, bodyB, _ = get(base, '/index.html')
    check('S11 上游没有 index.html → 往下退一层取副本，不跟着 404',
          code == 200 and b'AT_VERSION' in bodyB, str(code))

    codes = []

    def one(i):
        codes.append(get(base, '/vendor/cloudbase.full.js')[0])

    ts = [threading.Thread(target=one, args=(i,)) for i in range(8)]
    for t in ts:
        t.start()
    for t in ts:
        t.join()
    check('S12 8 个并发请求全 200（SW 预缓存会一次打十几个）',
          len(codes) == 8 and all(c == 200 for c in codes), str(codes))

    proc.terminate()
    proc.wait(timeout=10)
    srv.shutdown()

    # 热更层上场：电脑不在（上游死地址），手机只有「APK 内置」+「云端热更」两份
    print('[7/8] 挂上热更内容目录，验证三层取页的优先级')
    proc = subprocess.Popen(
        [os.path.join(JDK, 'bin', 'java.exe'), '-cp', os.path.join(WORK, 'classes'),
         'ServerMain', os.path.join(WORK, 'assets'), 'http://127.0.0.1:1',
         overlay, os.path.join(WORK, 'content')],
        stdout=subprocess.PIPE, stderr=subprocess.STDOUT, text=True, encoding='utf-8')
    base3 = origin(wait_ready(proc))
    code, bodyE, _ = get(base3, '/index.html', timeout=15)
    check('S16 上游不在时，页面取的是热更层那份而不是 APK 内置的旧版',
          code == 200 and b'OVERLAY-CONTENT-77' in bodyE, str(code))
    code, bodyF, _ = get(base3, '/only-in-overlay.js')
    check('S17 热更层独有的文件也发得出来（新版加了文件不用重装）',
          code == 200 and bodyF == b'OVERLAY-ONLY', str(code))
    code, bodyG, _ = get(base3, '/vendor/cloudbase.full.js')
    check('S18 子目录一样走热更层（vendor/ 不在顶层也覆盖得到）',
          code == 200 and bodyG == b'OVERLAY-SDK', str(code))
    code, bodyH, _ = get(base3, '/tracker-version.json')
    real_v = open(os.path.join(WORK, 'assets', 'web', 'tracker-version.json'), 'rb').read()
    check('S19 热更层缺的文件自动退回 APK 内置（少发一个文件也不会白屏）',
          code == 200 and bodyH == real_v, str(code))
    proc.terminate()
    proc.wait(timeout=10)

    print('[8/8] 上游指向死地址且不挂热更层，验证内置副本独立可用')
    proc = subprocess.Popen(
        [os.path.join(JDK, 'bin', 'java.exe'), '-cp', os.path.join(WORK, 'classes'),
         'ServerMain', os.path.join(WORK, 'assets'), 'http://127.0.0.1:1'],
        stdout=subprocess.PIPE, stderr=subprocess.STDOUT, text=True, encoding='utf-8')
    base2 = origin(wait_ready(proc))
    t0 = time.time()
    code, bodyC, _ = get(base2, '/index.html', timeout=15)
    dt = time.time() - t0
    check('S13 电脑不在，内置那份照样出页面', code == 200 and b'AT_VERSION' in bodyC, str(code))
    check('S14 上游挂了只慢一次，没拖到秒级', dt < 3.0, '%.2fs' % dt)
    t0 = time.time()
    code, bodyD, _ = get(base2, '/tracker-version.json', timeout=15)
    check('S15 第二个请求不再白等上游（整页已放弃上游）',
          code == 200 and (time.time() - t0) < 0.5, '%.2fs' % (time.time() - t0))
    proc.terminate()
    proc.wait(timeout=10)

    bad = [n for n, ok in RESULTS if not ok]
    print('\n%d/%d 通过' % (len(RESULTS) - len(bad), len(RESULTS)))
    if bad:
        print('未通过：' + ' | '.join(bad))
        sys.exit(1)
    shutil.rmtree(WORK, ignore_errors=True)


if __name__ == '__main__':
    main()
