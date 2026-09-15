import subprocess

# 分离进程起静态服务器。
# 注意：DETACHED 模式下没有 std 句柄，http.server 每请求写 stderr 会崩（空响应），
# 必须把 stdout/stderr 重定向到文件。
work = r"D:\项目\01_媒体娱乐\ani-tracker"
log = r"C:\Users\Venus\.zcode\workspace\default\tracker-server.log"
# v2.4.4：遗留日志目录不存在时回退到项目目录（修复启动崩溃）
import os as _os
if not _os.path.isdir(_os.path.dirname(log)):
    log = _os.path.join(work, "tracker-server.log")
DETACHED = 0x00000008
NEWGROUP = 0x00000200
with open(log, "ab") as lf:
    subprocess.Popen(
        ["python", "-m", "http.server", "8089", "--bind", "0.0.0.0", "--directory", work],
        stdout=lf,
        stderr=lf,
        creationflags=DETACHED | NEWGROUP,
        close_fds=True,
    )
print("tracker server launching on :8089, log:", log)
