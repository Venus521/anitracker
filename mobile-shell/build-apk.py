"""构建 AniTracker 手机壳 APK —— 不走 Gradle/Android Studio，手工链路：
   aapt2 compile/link → javac → d8 → 注入 classes.dex → zipalign → apksigner。

源码留在项目里（中文路径），构建前整体复制到 ASCII 临时目录再编译：
cmd 的 GBK 码页与 aapt2/d8 对非 ASCII 路径都不稳（装工具链时已踩过一次）。

用法：python mobile-shell/build-apk.py
产物：mobile-shell/dist/AniTracker.apk
"""
import os
import shutil
import subprocess
import sys
import zipfile

ROOT = r'D:\dev\android-build'
JDK = os.path.join(ROOT, 'jdk-17.0.20.1+1')
BT = os.path.join(ROOT, r'sdk\build-tools\34.0.0')
ANDROID_JAR = os.path.join(ROOT, r'sdk\platforms\android-34\android.jar')

SRC = r'D:\项目\01_媒体娱乐\ani-tracker\mobile-shell'
WEB = os.path.dirname(SRC)            # 项目根：这份追迹要整个打进 APK
BUILD = r'D:\dev\at-shell-build'      # 纯 ASCII
DIST = os.path.join(SRC, 'dist')

MIN_API = '21'
# 壳版本必须**单调递增**：发布到云端.py 靠它判断「有没有新壳」，
# 而且它得跟着 APK 里真实的 versionCode 对得上。
# 2026-10-06 实测踩到的坑：dist 里的 APK 实际是 code 23 / v1.22（aapt2 dump badging 读出），
# 而这个文件还停在 20 / 1.19 —— 下次直接打包会把版本号**倒退**发出去，
# 手机上装到的就是「降级」，用户完全看不出问题。所以这里必须跟着 APK 实际值走。
VERSION_CODE = '49'
VERSION_NAME = '1.48'

# 打进 assets/web 的文件：index.html 引用的全部同源资源，缺一个就白屏/缺库
WEB_FILES = [
    'index.html',
    'cloudbase-sync.js',
    'tracker-filler-data.js',
    'tracker-sw.js',
    'tracker-version.json',
    'tracker-manifest.webmanifest',
    'ani-tracker-lib.json',
    'favicon.ico',
    'tracker-icon-512.png',
    'tracker-icon-maskable-512.png',
    'vendor/cloudbase.full.js',
]


def sync_assets():
    """把项目根那份追迹镜像到 mobile-shell/assets/web（多余的删掉，别留旧版本）。"""
    dst = os.path.join(SRC, 'assets', 'web')
    keep = set(WEB_FILES)
    if os.path.isdir(dst):
        for base, _, fs in os.walk(dst):
            for f in fs:
                rel = os.path.relpath(os.path.join(base, f), dst).replace('\\', '/')
                if rel not in keep:
                    os.remove(os.path.join(base, f))
    total = 0
    for rel in WEB_FILES:
        s = os.path.join(WEB, rel.replace('/', os.sep))
        d = os.path.join(dst, rel.replace('/', os.sep))
        if not os.path.exists(s):
            die('缺 Web 资源：' + s)
        if not os.path.isdir(os.path.dirname(d)):
            os.makedirs(os.path.dirname(d))
        if not (os.path.exists(d) and os.path.getmtime(d) >= os.path.getmtime(s)):
            shutil.copy2(s, d)
        total += os.path.getsize(d)
    print('  内置网页 %.2f MB（%d 个文件）' % (total / 1048576.0, len(WEB_FILES)))

# d8/apksigner 是批处理脚本，进去还要再调 java —— 必须把 JAVA_HOME 递下去
ENV = dict(os.environ)
ENV['JAVA_HOME'] = JDK
# 本机（沙箱）PATH 里有 System32\Wbem、System32\OpenSSH 这些**子目录**，
# 却缺 System32 本身，于是 cmd 批处理里的 chcp 找不到 → 凡走 .bat/.cmd 的工具
# （d8.bat / apksigner.bat / tcb.cmd）一律报「'chcp' 不是内部或外部命令」并退出 1。
# 把 System32 补到最前面即可，纯增量、不覆盖用户自己的设置。
for _p in (r'C:\Windows\System32', r'C:\Windows', r'C:\Windows\System32\Wbem'):
    if os.path.isdir(_p) and _p.lower() not in ENV.get('PATH', '').lower():
        ENV['PATH'] = _p + os.pathsep + ENV.get('PATH', '')
ENV['PATH'] = os.path.join(JDK, 'bin') + os.pathsep + ENV['PATH']


def die(msg):
    print('FAIL: ' + msg)
    sys.exit(1)


def sh(cmd, name):
    # d8/apksigner 是 .bat，CreateProcess 不能直接起批处理，必须过 cmd /c
    if cmd[0].lower().endswith('.bat'):
        cmd = ['cmd', '/c'] + cmd
    # 编码：cmd 的 bat 输出是 GBK/CP936，text=True 会默认按 UTF-8 解码 → UnicodeDecodeError
    # 直接把子进程打断，于是「d8 失败」只表现为一句看不懂的栈，真正原因被吞掉。
    # 这里用 errors='replace' 兜住：坏字节只影响日志可读性，不影响判断成败（看 returncode）。
    p = subprocess.run(cmd, capture_output=True, text=True, env=ENV,
                       encoding='gbk', errors='replace')
    out = ((p.stdout or '') + (p.stderr or '')).strip()
    if p.returncode != 0:
        print(out[-3000:])
        die(name + ' 退出码 ' + str(p.returncode))
    tail = [l for l in out.splitlines() if l.strip()][-3:] if out else []
    print('  %s: %s' % (name, ' | '.join(tail) if tail else 'ok'))


def main():
    if not os.path.exists(ANDROID_JAR):
        die('缺 android.jar，先跑 D:\\dev\\android-build\\install-sdk.py')

    print('[1/8] 同步网页资源进 assets/web（APK 自带一份，电脑关机也能用）')
    sync_assets()

    print('[2/8] 复制源码到 ASCII 构建目录 ' + BUILD)
    if os.path.exists(BUILD):
        # 同盘改名清场：本机 rmtree 会被沙箱拦（SHFileOperationW rc=2 / bulk-delete 阈值）
        import time as _t
        _stale = BUILD + '.stale-%d' % int(_t.time())
        os.rename(BUILD, _stale)
        print('  （清场：旧构建目录已挪到 ' + os.path.basename(_stale) + '）')
    os.makedirs(BUILD)
    for item in ('src', 'res', 'assets', 'AndroidManifest.xml'):
        s = os.path.join(SRC, item)
        d = os.path.join(BUILD, item)
        if os.path.isdir(s):
            shutil.copytree(s, d)
        else:
            shutil.copy2(s, d)
    out = os.path.join(BUILD, 'out')
    os.makedirs(out)

    aapt2 = os.path.join(BT, 'aapt2.exe')
    d8 = os.path.join(BT, 'd8.bat')
    zipalign = os.path.join(BT, 'zipalign.exe')
    apksigner = os.path.join(BT, 'apksigner.bat')
    javac = os.path.join(JDK, 'bin', 'javac.exe')
    keytool = os.path.join(JDK, 'bin', 'keytool.exe')

    print('[3/8] aapt2 compile res/')
    res_zip = os.path.join(out, 'res.zip')
    sh([aapt2, 'compile', '--dir', os.path.join(BUILD, 'res'), '-o', res_zip], 'aapt2 compile')

    print('[4/8] aapt2 link（生成 R.java + 未签名包骨架）')
    link_apk = os.path.join(out, 'link.apk')
    gen = os.path.join(out, 'gen')
    sh([aapt2, 'link', '-o', link_apk, '-I', ANDROID_JAR,
        '--manifest', os.path.join(BUILD, 'AndroidManifest.xml'),
        '-A', os.path.join(BUILD, 'assets'),
        '--min-sdk-version', MIN_API, '--target-sdk-version', '34',
        '--version-code', VERSION_CODE, '--version-name', VERSION_NAME,
        '--java', gen, res_zip], 'aapt2 link')

    print('[5/8] javac 编译 MainActivity + LocalServer + R')
    classes = os.path.join(out, 'classes')
    os.makedirs(classes)
    java_files = []
    for base, _, fs in os.walk(os.path.join(BUILD, 'src')):
        java_files += [os.path.join(base, f) for f in fs if f.endswith('.java')]
    for base, _, fs in os.walk(gen):
        java_files += [os.path.join(base, f) for f in fs if f.endswith('.java')]
    if not java_files:
        die('没找到 .java')
    sh([javac, '-source', '1.8', '-target', '1.8', '-encoding', 'UTF-8',
        '-bootclasspath', ANDROID_JAR, '-classpath', ANDROID_JAR,
        '-d', classes] + java_files, 'javac')

    print('[6/8] d8 转 dex')
    dexdir = os.path.join(out, 'dex')
    os.makedirs(dexdir)
    class_files = []
    for base, _, fs in os.walk(classes):
        class_files += [os.path.join(base, f) for f in fs if f.endswith('.class')]
    # 直接起java 跑 d8.jar，不走 d8.bat。
    # 为什么：bat 必须过 cmd /c，而 cmd 启动时会执行 chcp —— 这台机器的 PATH 里没有 chcp
    #（沙箱精简过），于是 d8.bat 一跑就报「'chcp' 不是内部或外部命令」并退出 1。
    # d8 真正的活儿就是 com.android.tools.r8.D8，绕开 bat 结果完全一致，还少一层编码坑。
    d8_jar = os.path.join(BT, 'lib', 'd8.jar')
    java_exe = os.path.join(JDK, 'bin', 'java.exe')
    d8_args = ['-cp', d8_jar, 'com.android.tools.r8.D8',
               '--min-api', MIN_API, '--lib', ANDROID_JAR, '--output', dexdir] + class_files
    sh([java_exe] + d8_args, 'd8')
    dex = os.path.join(dexdir, 'classes.dex')
    if not os.path.exists(dex):
        die('d8 没产出 classes.dex')

    print('[7/8] 注入 dex → zipalign → 签名')
    unsigned = os.path.join(out, 'unsigned.apk')
    with zipfile.ZipFile(link_apk, 'r') as zin, \
            zipfile.ZipFile(unsigned, 'w', zipfile.ZIP_DEFLATED) as zout:
        for it in zin.infolist():
            zout.writestr(it, zin.read(it.filename))
        zout.write(dex, 'classes.dex')
    aligned = os.path.join(out, 'aligned.apk')
    sh([zipalign, '-f', '4', unsigned, aligned], 'zipalign')

    # keystore 必须住在项目里：BUILD 每次构建整体清空，密钥跟着丢的话
    # 下次打包就换签名，手机装新版会被系统判「签名冲突」直接拒装。
    ksdir = os.path.join(SRC, 'keystore')
    if not os.path.exists(ksdir):
        os.makedirs(ksdir)
    ks = os.path.join(ksdir, 'debug.keystore')
    if not os.path.exists(ks):
        sh([keytool, '-genkeypair', '-v', '-keystore', ks, '-storepass', 'android',
            '-keypass', 'android', '-alias', 'anitracker', '-keyalg', 'RSA',
            '-keysize', '2048', '-validity', '10000',
            '-dname', 'CN=AniTracker,OU=Home,O=Home,L=Home,ST=Home,C=CN'], 'keytool')
    if not os.path.exists(DIST):
        os.makedirs(DIST)
    apk = os.path.join(DIST, 'AniTracker.apk')
    # 同 d8：直接起 java 跑 apksigner.jar，绕开 apksigner.bat（bat 里的 chcp 在本机不存在）
    apksigner_jar = os.path.join(BT, 'lib', 'apksigner.jar')
    java_exe2 = os.path.join(JDK, 'bin', 'java.exe')
    sh([java_exe2, '-cp', apksigner_jar, 'com.android.apksigner.ApkSignerTool',
        'sign', '--ks', ks, '--ks-pass', 'pass:android',
        '--key-pass', 'pass:android', '--out', apk, aligned], 'apksigner sign')

    print('[8/8] 校验产物')
    with zipfile.ZipFile(apk) as z:
        names = [n for n in z.namelist() if n.startswith('assets/web/')]
        if len(names) != len(WEB_FILES):
            die('assets 数量不对：%d / %d' % (len(names), len(WEB_FILES)))
        print('  内置网页资源 %d 个，合计 %.2f MB' % (
            len(names), sum(z.getinfo(n).file_size for n in names) / 1048576.0))
    # 同上：verify 也直接起 java，别过 bat
    p = subprocess.run([java_exe2, '-cp', apksigner_jar, 'com.android.apksigner.ApkSignerTool',
                        'verify', '--print-certs', apk],
                       capture_output=True, text=True, env=ENV,
                       encoding='utf-8', errors='replace')
    print(((p.stdout or '') + (p.stderr or '')).strip()[:600])
    if p.returncode != 0:
        die('apksigner verify 失败')
    b = subprocess.run([aapt2, 'dump', 'badging', apk], capture_output=True, text=True)
    pkg = ''
    for line in (b.stdout or '').splitlines():
        if line.startswith('package:'):
            pkg = line
        if line.startswith(('package:', 'application-label:', 'uses-permission:',
                            'launchable-activity:', 'sdkVersion:', 'targetSdkVersion:')):
            print('  ' + line)
    if ("versionCode='%s'" % VERSION_CODE) not in pkg:
        die('装上去没更新：包里实际版本不是 %s（%s）' % (VERSION_CODE, pkg.strip()))
    # 更新链路最容易「代码写了但没进包」：manifest 少了 provider 声明，下载好的包递不给安装器；
    # dex 少了类，点「检查更新」只会静默没反应。版本号那次已经踩过，这两条一起钉住。
    x = subprocess.run([aapt2, 'dump', 'xmltree', '--file', 'AndroidManifest.xml', apk],
                       capture_output=True, text=True)
    if 'UpdateProvider' not in (x.stdout or ''):
        die('APK 的 manifest 里没有 UpdateProvider，更新包递不进系统安装器')
    with zipfile.ZipFile(apk) as z:
        dex = z.read('classes.dex')
    CLASSES = ('MainActivity', 'LocalServer', 'UpdateInfo', 'UpdateProvider', 'Updater',
               'WebInfo', 'WebUpdater', 'Net')
    for cls in CLASSES:
        if cls.encode() not in dex:
            die('classes.dex 里没有 ' + cls + '，这份包的更新功能是空的')
    print('  更新链路到位：provider 已声明，%d 个类都在 dex 里' % len(CLASSES))
    # 启动方式里的「手机版 APK」入口要显示货架上这份是什么版本，别让人盲装
    with open(apk + '.meta', 'w', encoding='utf-8') as f:
        f.write(u'v%s（versionCode %s）' % (VERSION_NAME, VERSION_CODE))
    print('\nOK 产物: %s (%.1f MB)' % (apk, os.path.getsize(apk) / 1048576.0))


if __name__ == '__main__':
    main()
