# -*- coding: utf-8 -*-
"""手机版 APK 安装入口 —— DeskBox/启动方式/AniTracker 手机版APK.lnk 指到这里。

点一下把安装包文件塞进剪贴板：微信/QQ 打开「文件传输助手」按 Ctrl+V 发送，手机上点开即装。
这条路不碰浏览器，也就绕开了 CloudBase 测试域名那堵「页面访问提示」墙（用户 2026-09-27
「每次都这样太麻烦了」），也不要求电脑开机、手机连同一个 WiFi。
局域网地址和云端地址作为后备仍摊在窗口里，按需选用。
（2026-09-27 起 USB adb 直装不再是交付路，用户「我不要传到USB」，按钮已删。）

为什么不用 PowerShell 写这个入口：这台机器上 powershell 冷启动要 13~20 秒，
pythonw + tkinter 不到 2 秒；CIM 的 Get-NetTCPConnection 单是探个端口就 ~48 秒。

用法：pythonw 手机安装入口.py        弹窗（正常入口用法）
      python   手机安装入口.py --print   只把局域网地址打到标准输出，不起界面
"""
import json
import os
import socket
import subprocess
import sys
import time

SHELL = os.path.dirname(os.path.abspath(__file__))          # .../ani-tracker/mobile-shell
PROJ = os.path.dirname(SHELL)                                # .../ani-tracker
PORT = 8089
SERVER = PROJ + '/服务器-空闲自退.py'
LOG = PROJ + '/服务器日志.txt'
APK = SHELL + '/dist/AniTracker.apk'
META = APK + '.meta'
# 发布清单（python mobile-shell/发布到云端.py 生成）：有了它，装这一步也不依赖电脑
MANIFEST = SHELL + '/dist/app/version.json'
PYW = os.path.expanduser('~') + '/.workbuddy-ai/binaries/python/versions/3.13.12/pythonw.exe'
# 下载场景的空闲窗口给 1 小时：手机换设备、翻找浏览器、装完再回来点，都容易超过 15 分钟，
# 一旦服务自退，弹窗里那条地址就成了死链（2026-09-26 用户「访问不了」的真实原因）。
IDLE = '3600'
KEEPALIVE_MS = 120000          # 窗口开着就每 2 分钟摸一次服务器，保证它不会中途自退


def port_open(port=PORT):
    c = socket.socket()
    c.settimeout(0.6)
    try:
        return c.connect_ex(('127.0.0.1', port)) == 0
    finally:
        c.close()


def lan_ip():
    """UDP 只选路不出包：连一下公网地址，看系统挑了哪张网卡的 IP。"""
    for probe in ('1.1.1.1', '8.8.8.8', '192.168.1.1'):
        u = socket.socket(socket.AF_INET, socket.SOCK_DGRAM)
        try:
            u.connect((probe, 53))
            return u.getsockname()[0]
        except OSError:
            continue
        finally:
            u.close()
    return None


def ensure_server():
    """服务器没在跑就后台拉一个（脱离本进程，入口窗口关了它也照常空闲自退）。"""
    if port_open():
        return True
    py = PYW if os.path.exists(PYW) else sys.executable
    DETACHED = 0x00000008 | 0x00000200  # DETACHED_PROCESS | CREATE_NEW_PROCESS_GROUP
    subprocess.Popen([py, SERVER, '--port', str(PORT), '--host', '0.0.0.0',
                      '--dir', PROJ, '--idle', IDLE, '--log', LOG],
                     creationflags=DETACHED, close_fds=True,
                     stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
    for _ in range(20):
        time.sleep(1)
        if port_open():
            return True
    return False


def probe(url):
    """按手机将要使用的那个网卡地址真发一次 HEAD：既证明地址打得开，也顺带重置服务器的空闲计时。"""
    import urllib.request
    try:
        with urllib.request.urlopen(urllib.request.Request(url, method='HEAD'), timeout=6) as r:
            return True, r.status, int(r.headers.get('Content-Length') or 0)
    except Exception as e:
        return False, repr(e)[:90], 0


def apk_info():
    if not os.path.exists(APK):
        return None
    st = os.stat(APK)
    ver = ''
    if os.path.exists(META):
        with open(META, encoding='utf-8') as f:
            ver = f.read().strip()
    return {'ver': ver or '未记录版本', 'kb': st.st_size // 1024,
            'when': time.strftime('%Y-%m-%d %H:%M', time.localtime(st.st_mtime))}


def install_url():
    ip = lan_ip()
    if not ip:
        return None
    return 'http://%s:%d/mobile-shell/dist/AniTracker.apk' % (ip, PORT)


# ---- 把「文件本身」交出去：微信/QQ 里 Ctrl+V 就是发文件 ------------------------------------
# 为什么走这条而不是公网直链：CloudBase 测试域名那堵「页面访问提示」墙按**文档请求**拦，
# 每换一个地址都要重过一次（用户 2026-09-27「每次都这样太麻烦了」）。传文件不碰浏览器，
# 墙、WiFi、电脑开不开机三件事一起消失。
CF_HDROP = 15
GHND = 0x0042


def _clip_dlls():
    import ctypes
    from ctypes import wintypes
    k32 = ctypes.WinDLL('kernel32', use_last_error=True)
    u32 = ctypes.WinDLL('user32', use_last_error=True)
    s32 = ctypes.WinDLL('shell32', use_last_error=True)   # DragQueryFileW 在 shell32，不在 user32
    k32.GlobalAlloc.restype = ctypes.c_void_p
    k32.GlobalAlloc.argtypes = [wintypes.UINT, ctypes.c_size_t]
    k32.GlobalLock.restype = ctypes.c_void_p
    k32.GlobalLock.argtypes = [ctypes.c_void_p]
    k32.GlobalUnlock.argtypes = [ctypes.c_void_p]
    u32.SetClipboardData.restype = ctypes.c_void_p
    u32.SetClipboardData.argtypes = [wintypes.UINT, ctypes.c_void_p]
    u32.GetClipboardData.restype = ctypes.c_void_p
    u32.GetClipboardData.argtypes = [wintypes.UINT]
    u32.OpenClipboard.argtypes = [ctypes.c_void_p]
    u32.IsClipboardFormatAvailable.argtypes = [wintypes.UINT]
    s32.DragQueryFileW.restype = wintypes.UINT
    # 第 3 个参数要能塞进可写缓冲区：声明成 c_void_p，调用处传 byref(create_unicode_buffer(...))
    s32.DragQueryFileW.argtypes = [ctypes.c_void_p, wintypes.UINT,
                                   ctypes.c_void_p, wintypes.UINT]
    return ctypes, k32, u32, s32


def copy_files_to_clip(paths):
    """往剪贴板放一份 CF_HDROP（拖放/粘贴用的文件列表）。返回 True 即微信 Ctrl+V 能发出去。"""
    import struct
    ctypes, k32, u32, _ = _clip_dlls()
    data = struct.pack('<IiiII', 20, 0, 0, 0, 1)               # pFiles / pt / fNC / fWide=宽字符
    data += ('\0'.join(paths) + '\0\0').encode('utf-16-le')
    h = k32.GlobalAlloc(GHND, len(data))
    if not h:
        return False
    p = k32.GlobalLock(h)
    if not p:
        return False
    ctypes.memmove(p, data, len(data))
    k32.GlobalUnlock(h)
    if not u32.OpenClipboard(None):
        k32.GlobalFree(h)
        return False
    try:
        u32.EmptyClipboard()
        # 成功后这份内存归系统所有，绝不能再 GlobalFree；失败才由我们释放
        if not u32.SetClipboardData(CF_HDROP, h):
            k32.GlobalFree(h)
            return False
    finally:
        u32.CloseClipboard()
    return True


def clip_files():
    """读回剪贴板里的文件列表（tkinter 里没法肉眼验剪贴板，只能让系统自己报）。"""
    ctypes, _, u32, s32 = _clip_dlls()
    if not u32.IsClipboardFormatAvailable(CF_HDROP):
        return []
    if not u32.OpenClipboard(None):
        return None
    try:
        h = u32.GetClipboardData(CF_HDROP)
        if not h:
            return None
        n = int(s32.DragQueryFileW(h, 0xFFFFFFFF, None, 0))
        out = []
        for i in range(n):
            buf = ctypes.create_unicode_buffer(4096)
            s32.DragQueryFileW(h, i, ctypes.byref(buf), 4096)
            out.append(buf.value)
        return out
    finally:
        u32.CloseClipboard()


def copy_apk_to_clip():
    """把安装包文件放进剪贴板，并读回确认那条路径真的在——True 才敢说微信 Ctrl+V 有文件。"""
    if not os.path.exists(APK):
        return False
    want = os.path.abspath(APK.replace('/', os.sep))
    try:
        if not copy_files_to_clip([want]):
            return False
    except Exception:
        return False
    got = clip_files() or []
    return any(os.path.normpath(g).lower() == os.path.normpath(want).lower() for g in got)


def open_folder_selected(path):
    """打开资源管理器并选中这个文件：拖进微信/QQ 窗口同样不碰浏览器。"""
    subprocess.Popen(['explorer', '/select,', os.path.normpath(path)])
    return True


def cloud_link():
    """云端那份的地址：读「发布到云端.py」留下的清单，没发布过就没有这条路。"""
    try:
        with open(MANIFEST, encoding='utf-8') as f:
            m = json.load(f)
        return m['url'], 'v%s' % m['versionName']
    except Exception:
        return None, None


def show(url, info, err):
    import threading
    import tkinter as tk
    import tkinter.font as tkfont

    root = tk.Tk()
    root.withdraw()
    # 一开窗口就把「文件本身」放进剪贴板：微信/QQ 里 Ctrl+V 就是发文件，全程不碰浏览器
    got_file = copy_apk_to_clip()
    if not got_file and url:
        root.clipboard_clear()
        root.clipboard_append(url)

    win = tk.Toplevel(root)
    win.title('追迹 · 手机版安装')
    win.attributes('-topmost', True)
    win.configure(bg='#f7f3ea', padx=22, pady=18)
    mono = tkfont.Font(family='Microsoft YaHei UI', size=12, weight='bold')
    # 地址比标题长，12 号下末尾会被输入框切掉几个字符（看得见却读不全最容易被怀疑是坏链），降一档刚好放得下
    urlf = tkfont.Font(family='Microsoft YaHei UI', size=11, weight='bold')
    small = tkfont.Font(family='Microsoft YaHei UI', size=9)
    # 长句必须自己折行：Label 的请求宽度就是整句的宽度，不折行会把窗口撑得比屏幕还宽（实测 1314 > 1280），
    # 结果右侧「关闭」跑到屏外。按屏幕宽度夹一档，窗口永远放得下。
    wrap = max(360, int(win.winfo_screenwidth() * 0.62))

    def label(text, font=None, fg='#3a3227', anchor='w'):
        w = tk.Label(win, text=text, font=font or small, fg=fg, bg='#f7f3ea',
                     anchor=anchor, justify='left', wraplength=wrap)
        w.pack(fill='x')
        return w

    alive = [True]
    pub, pver = cloud_link()
    stat2 = None

    def show_res(w, cap, res):
        if not alive[0] or w is None:
            return
        ok, detail, size = res
        if ok:
            w.configure(text='%s：此刻能下载（HTTP %s · %d KB）' % (cap, detail, size // 1024),
                        fg='#2f7d4f')
        else:
            w.configure(text='%s：暂时打不开（%s）' % (cap, detail), fg='#a83232')

    def ping():
        if not alive[0]:
            return
        targets = [('局域网这份', url, stat), ('云端那份', pub, stat2)]

        def work():
            for cap, u, w in targets:
                if not u or not alive[0]:
                    continue
                res = probe(u)
                if alive[0]:
                    win.after(0, lambda w=w, cap=cap, res=res: show_res(w, cap, res))
        threading.Thread(target=work, daemon=True).start()

    def tick():
        if not alive[0]:
            return
        ping()
        win.after(KEEPALIVE_MS, tick)

    # ---- 主路：把安装包文件本身交出去，全程不碰浏览器 ----
    has_apk = os.path.exists(APK)
    if has_apk:
        label('装到手机：APK 文件已经放进剪贴板 —— 微信/QQ 打开「文件传输助手」按 Ctrl+V 发出，'
              '手机上点开即装。', font=mono)
        if got_file:
            lead = ('文件此刻就在剪贴板里，现在去微信/QQ 粘贴即可：不碰浏览器就没有那堵'
                    '「页面访问提示」，也不用连同一个 WiFi。')
        else:
            lead = ('剪贴板放文件没成功，先放了下载网址：点下面「复制 APK 文件」重试，'
                    '或者「打开所在文件夹」把文件直接拖进微信/QQ 窗口。')
        ustat = label(lead + ' 电脑上这份 %s · %d KB · 构建于 %s；签名与旧版相同，覆盖安装、数据不动。'
                      % (info['ver'], info['kb'], info['when']),
                      fg='#2f7d4f' if got_file else '#a83232')
    else:
        ustat = None

    row = tk.Frame(win, bg='#f7f3ea')
    row.pack(fill='x', pady=(14, 0))

    def close():
        alive[0] = False
        win.destroy()

    def set_msg(text, fg='#8a7c68'):
        if alive[0] and ustat is not None:
            ustat.configure(text=text, fg=fg)

    def reset_btn(w, text):
        if alive[0]:
            w.configure(text=text)

    if has_apk:
        def copy_again():
            if copy_apk_to_clip():
                btn.configure(text='已复制文件 ✓')
                set_msg('文件重新放好了：去微信/QQ 的「文件传输助手」里 Ctrl+V。', '#2f7d4f')
            elif url:
                root.clipboard_clear()
                root.clipboard_append(url)
                btn.configure(text='放了网址 ✓')
                set_msg('还是放不进文件，退一步放了局域网网址：%s' % url, '#a83232')
            win.after(1500, lambda: reset_btn(btn, '复制 APK 文件'))

        def do_folder():
            try:
                open_folder_selected(APK.replace('/', os.sep))
                set_msg('已打开并选中 %s —— 把它拖进微信/QQ 窗口同样发得出去。'
                        % os.path.basename(APK), '#2f7d4f')
            except Exception as e:
                set_msg('打不开文件夹：' + repr(e)[:80], '#a83232')

        btn = tk.Button(row, text='复制 APK 文件', command=copy_again, relief='flat',
                        bg='#e8dfcc', fg='#3a3227', activebackground='#ddd2ba', padx=12)
        btn.pack(side='left')
        fbtn = tk.Button(row, text='打开所在文件夹', command=do_folder, relief='flat',
                         bg='#e8dfcc', fg='#3a3227', activebackground='#ddd2ba', padx=12)
        fbtn.pack(side='left', padx=(8, 0))

    # ---- 备用路 1：局域网直链（要走浏览器，手机得和电脑连同一路由器）----
    if err:
        label(err, font=mono, fg='#a83232')
        stat = None
    else:
        label('备用 · 局域网网址（手机浏览器打开，要先连上和电脑同一个路由器）', font=mono)
        ent = tk.Entry(win, font=urlf, bg='#fffdf7', fg='#3a3227',
                       relief='flat', highlightthickness=1, highlightbackground='#d9cfbb')
        ent.pack(fill='x', pady=(6, 2), ipady=5)
        ent.insert(0, url)
        ent.select_range(0, 'end')
        ent.icursor('end')
        stat = label('正在验证地址是否可下载…', fg='#8a7c68')
        label('窗口开着时地址一直保持可用；关掉后本地服务空闲 1 小时自退，届时再点一次入口。',
              fg='#8a7c68')

    # ---- 备用路 2：云端直链（不依赖这台电脑，但同样要在浏览器里过一道验证页）----
    if pub:
        label('备用 · 云端网址（%s，不用开电脑）：已经装过的话不必再下载，'
              '升级在 App 里点：账号 → 安装包 → 检查更新。' % pver, font=mono)
        ent2 = tk.Entry(win, font=urlf, bg='#fffdf7', fg='#3a3227',
                        relief='flat', highlightthickness=1, highlightbackground='#d9cfbb')
        ent2.pack(fill='x', pady=(6, 2), ipady=5)
        ent2.insert(0, pub)
        stat2 = label('正在验证云端地址…', fg='#8a7c68')

        def copy_pub():
            root.clipboard_clear()
            root.clipboard_append(pub)
            pubbtn.configure(text='已复制 ✓')
            win.after(1500, lambda: reset_btn(pubbtn, '复制云端地址'))

        pubbtn = tk.Button(row, text='复制云端地址', command=copy_pub, relief='flat',
                           bg='#e8dfcc', fg='#3a3227', activebackground='#ddd2ba', padx=12)
        pubbtn.pack(side='left', padx=(8, 0))

    tk.Button(row, text='关闭', command=close, relief='flat',
              bg='#f7f3ea', fg='#8a7c68', padx=12).pack(side='right')
    win.bind('<Escape>', lambda e: close())
    if has_apk:
        win.bind('<Return>', lambda e: copy_again())
    win.protocol('WM_DELETE_WINDOW', close)
    win.update_idletasks()
    sw, sh = win.winfo_screenwidth(), win.winfo_screenheight()
    # 宽高都按屏幕夹住：宁可内部留白，也不能让按钮跑到屏幕外
    w = min(win.winfo_reqwidth(), sw - 8)
    h = min(win.winfo_reqheight(), sh - 8)
    win.geometry('%dx%d+%d+%d' % (w, h, (sw - w) // 2, max(0, min((sh - h) // 3, sh - h - 8))))
    ping()
    win.after(KEEPALIVE_MS, tick)
    win.mainloop()
    alive[0] = False
    root.destroy()


def main():
    if '--print' in sys.argv:
        url = install_url()
        if not url:
            print('没找到本机局域网 IP：检查 WiFi 是否连着')
            return 1
        print(url)
        return 0

    err = None
    url = None
    info = apk_info()
    if info is None:
        err = 'APK 不在：\n%s\n先在项目目录跑 python mobile-shell/build-apk.py 打一个。' % APK
    elif not ensure_server():
        err = '本地服务没能起来（端口 %d）。\n看看 %s' % (PORT, LOG)
    else:
        url = install_url()
        if not url:
            err = '没找到本机局域网 IP。\n手机要连和电脑同一个路由器，检查 WiFi 或网线。'
    show(url, info or {'ver': '-', 'kb': 0, 'when': '-'}, err)
    return 0


if __name__ == '__main__':
    sys.exit(main())
