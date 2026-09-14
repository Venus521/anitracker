# -*- coding: utf-8 -*-
"""ASCII-named launcher wrapper for the Chinese-named server script.
cmd/batch byte handling for CJK filenames is codepage-fragile; this wrapper
keeps the .bat entry 100% ASCII while Python resolves the real filename."""
import os, sys, runpy

here = os.path.dirname(os.path.abspath(__file__))
target = os.path.join(here, "服务器-空闲自退.py")
if not os.path.exists(target):
    try:
        sys.stderr.write("server script missing: %s\n" % target)
    except Exception:
        pass
    sys.exit(2)

args = list(sys.argv[1:])
if "--log" not in args:
    args = args + ["--log", os.path.join(here, "服务器日志.txt")]
sys.argv = [target] + args
runpy.run_path(target, run_name="__main__")
