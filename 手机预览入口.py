# -*- coding: utf-8 -*-
"""手机端预览入口 —— DeskBox/启动方式/AniTracker 手机预览.lnk 指到这里。

走查只吐 PNG 等于没走查：没人会天天去翻一个装图的文件夹。所以这个入口一开就把「走查墙」
（上半：逐屏 393×851 真机尺寸截图 + 每屏实测 + 版式门禁；下半：12 个真人任务的行为走查结论
 + 过程截图）摊到浏览器里，顺手告诉你这批结果是不是比现在的页面旧了，并能一键重跑任一条。

为什么不用 PowerShell：这台机器 powershell 冷启动 13~20 秒，pythonw + tkinter 不到 2 秒。

用法：pythonw 手机预览入口.py            弹窗并打开走查墙（正常入口用法）
      python 手机预览入口.py --open      只打开走查墙，不起界面
      python 手机预览入口.py --stale     只回答「该不该重跑」（过期退出码 1）
"""
import os
import shutil
import subprocess
import sys
import time

PROJ = os.path.dirname(os.path.abspath(__file__))
SHOTS = os.path.join(PROJ, 'tests', 'shots-phone')
WALL = os.path.join(SHOTS, '手机预览.html')
LOOK = os.path.join(PROJ, 'tests', 'phone-look.js')
USE = os.path.join(PROJ, 'tests', 'phone-use.js')
USE_LOG = os.path.join(SHOTS, 'use', 'use-findings.json')
LIVE = os.path.join(PROJ, 'tests', 'phone-live.js')
PAGE = os.path.join(PROJ, 'index.html')


def node_exe():
    """从 .lnk 起进程时 PATH 未必带 node，找不到就按常见安装位置扫。"""
    found = shutil.which('node')
    if found:
        return found
    for pat in (r'C:\Program Files\nodejs\node.exe',
                os.path.expanduser('~') + r'\AppData\Roaming\nvm\*\node.exe',
                r'C:\Program Files\nodejs\node.exe'):
        if '*' in pat:
            import glob
            hits = glob.glob(pat)
            if hits:
                return hits[0]
        elif os.path.exists(pat):
            return pat
    return None


def newest_png():
    if not os.path.isdir(SHOTS):
        return 0
    ts = [os.path.getmtime(os.path.join(SHOTS, f))
          for f in os.listdir(SHOTS) if f.endswith('.png')]
    return max(ts) if ts else 0


def stale():
    """页面比截图新 ⇒ 这批图说的不是现在这版界面，必须重跑。"""
    return (not os.path.exists(WALL)) or newest_png() < os.path.getmtime(PAGE)


def status_line():
    if not os.path.exists(WALL):
        return '还没走过查：点「重新走查」跑一遍（约 40 秒）', '#a83232'
    t = time.strftime('%Y-%m-%d %H:%M', time.localtime(newest_png()))
    if stale():
        return '截图 %s，比现在的页面旧 —— 重跑一次才算数' % t, '#b8860b'
    return '截图 %s · 与当前页面一致' % t, '#2f7d4f'


def open_wall():
    if os.path.exists(WALL):
        os.startfile(WALL)          # 交给默认浏览器，file:// 直开，不占端口
        return True
    return False


def run(cmd, timeout=300):
    r = subprocess.run(cmd, cwd=PROJ, capture_output=True, text=True,
                       encoding='utf-8', errors='replace', timeout=timeout)
    tail = ((r.stdout or '') + '\n' + (r.stderr or '')).strip().splitlines()
    return r.returncode, ' | '.join(tail[-3:])


def show():
    import threading
    import tkinter as tk
    import tkinter.font as tkfont

    root = tk.Tk()
    root.withdraw()
    win = tk.Toplevel(root)
    win.title('追迹 · 手机预览')
    win.attributes('-topmost', True)
    win.configure(bg='#f7f3ea', padx=22, pady=18)
    mono = tkfont.Font(family='Microsoft YaHei UI', size=12, weight='bold')
    small = tkfont.Font(family='Microsoft YaHei UI', size=9)
    busy = [False]

    def label(text, font=None, fg='#3a3227'):
        w = tk.Label(win, text=text, font=font or small, fg=fg, bg='#f7f3ea',
                     anchor='w', justify='left')
        w.pack(fill='x')
        return w

    label('走查墙已在浏览器打开：逐屏版式实测 + 12 个真人任务的行为结论', font=mono)
    stat, sfg = status_line()
    sw = label(stat, fg=sfg)
    label('「重新走查」= 电脑 Chrome 按手机参数跑一遍并量数据（出界/触点/字号）；', fg='#5a4f42')
    label('「用起来走查」= 拿 12 个真人任务过一遍交互（加片/标记进度/深滚够不够得着…），量的是行为不是像素；', fg='#5a4f42')
    label('「手机窗口」= 开一个能真点的手机窗口（宽 393 是真的，高度受屏幕限制压掉一截）。', fg='#8a7c68')

    row = tk.Frame(win, bg='#f7f3ea')
    row.pack(fill='x', pady=(14, 0))

    def btn(text, cmd, side='left', padx=0):
        b = tk.Button(row, text=text, command=cmd, relief='flat', bg='#e8dfcc',
                      fg='#3a3227', activebackground='#ddd2ba', padx=12)
        b.pack(side=side, padx=padx)
        return b

    def set_stat(text, fg='#8a7c68'):
        if not busy[0]:
            return
        sw.configure(text=text, fg=fg)

    def rerun_done(rc, msg):
        busy[0] = False
        lookbtn.configure(text='重新走查', state='normal')
        usebtn.configure(state='normal')
        if rc == 0:
            st, sfg = status_line()
            sw.configure(text=st + '　·　走查通过', fg='#2f7d4f')
            open_wall()
        else:
            sw.configure(text='走查没通过（%d）：%s' % (rc, msg[:160]), fg='#a83232')

    def rerun():
        if busy[0]:
            return
        nd = node_exe()
        if not nd:
            sw.configure(text='找不到 node，走查重跑不了', fg='#a83232')
            return
        busy[0] = True
        lookbtn.configure(text='正在走查…', state='disabled')
        usebtn.configure(state='disabled')
        sw.configure(text='正在按 393×851 跑逐屏版式走查（Chrome 无头，约 40 秒）…', fg='#8a7c68')

        def work():
            try:
                rc, msg = run([nd, LOOK])
            except Exception as e:
                rc, msg = 1, repr(e)[:120]
            win.after(0, lambda: rerun_done(rc, msg))
        threading.Thread(target=work, daemon=True).start()

    def use_done(rc, msg):
        busy[0] = False
        usebtn.configure(text='用起来走查', state='normal')
        lookbtn.configure(state='normal')
        if rc == 0:
            sw.configure(text='用起来走查通过：12 个真人任务没发现影响使用的问题', fg='#2f7d4f')
        else:
            sw.configure(text='用起来走查发现问题（%d）：%s' % (rc, msg[:200]), fg='#a83232')

    def use():
        if busy[0]:
            return
        nd = node_exe()
        if not nd:
            sw.configure(text='找不到 node，走查跑不了', fg='#a83232')
            return
        busy[0] = True
        usebtn.configure(text='正在用起来…', state='disabled')
        lookbtn.configure(state='disabled')
        sw.configure(text='正在按 12 个真人任务过一遍手机交互（加片→标记→深滚→长按…，约 90 秒）…', fg='#8a7c68')

        def work():
            try:
                rc, msg = run([nd, USE], timeout=600)
            except Exception as e:
                rc, msg = 1, repr(e)[:120]
            win.after(0, lambda: use_done(rc, msg))
        threading.Thread(target=work, daemon=True).start()

    def live():
        nd = node_exe()
        if not nd:
            sw.configure(text='找不到 node，开不了手机窗口', fg='#a83232')
            return
        DETACHED = 0x00000008 | 0x00000200
        subprocess.Popen([nd, LIVE], cwd=PROJ, creationflags=DETACHED, close_fds=True,
                         stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
        sw.configure(text='手机窗口正在启动（Chrome 会弹一个窄窗口，关掉它即收工）', fg='#2f7d4f')

    def close():
        busy[0] = False
        win.destroy()

    lookbtn = btn('重新走查', rerun)
    usebtn = btn('用起来走查', use, padx=8)
    btn('手机窗口（能点）', live, padx=8)
    btn('再看一次走查墙', open_wall, padx=8)
    btn('关闭', close, side='right')
    win.bind('<Escape>', lambda e: close())
    win.protocol('WM_DELETE_WINDOW', close)
    win.update_idletasks()
    w, h = win.winfo_reqwidth(), win.winfo_reqheight()
    x = (win.winfo_screenwidth() - w) // 2
    y = max(0, min((win.winfo_screenheight() - h) // 3, win.winfo_screenheight() - h - 8))
    win.geometry('+%d+%d' % (x, y))
    win.mainloop()
    root.destroy()


def main():
    if '--stale' in sys.argv:
        print('需要重跑：页面比截图新' if stale() else '不用重跑：截图与当前页面一致')
        return 1 if stale() else 0
    if '--open' in sys.argv:
        return 0 if open_wall() else 1
    open_wall()
    show()
    return 0


if __name__ == '__main__':
    sys.exit(main())
