@echo off
title AniTracker regression tests
cd /d %~dp0
rem 门禁必须串行：两个 Chrome 门禁并发会撞端口。
rem v2.35.0 起加 phone-canon-check（漫改恢复+漫改进度行）与 name-refresh-e2e（不经过 AI 刷名）。
node tests\cred-crypto-check.js
set RC0=%ERRORLEVEL%
node tests\run-regression.js
set RC1=%ERRORLEVEL%
node tests\douban-sync-e2e.js
set RC2=%ERRORLEVEL%
node tests\douban-push-e2e.js
set RC3=%ERRORLEVEL%
node tests\desktop-tier-check.js
set RC4=%ERRORLEVEL%
node tests\phone-canon-check.js
set RC5=%ERRORLEVEL%
node tests\name-refresh-e2e.js
set RC6=%ERRORLEVEL%
node tests\phone-use.js
set RC7=%ERRORLEVEL%
node tests\phone-look.js
set RC8=%ERRORLEVEL%
node tests\ep-duration-check.js
set RC9=%ERRORLEVEL%
rem v2.48.0：纯逻辑门禁（不开浏览器、不占端口）——语法闸 + 查询剥壳/季级集数 + 它的负测跑手
node tests\_syntax.js
set RC10=%ERRORLEVEL%
node tests\season-scope-check.js
set RC11=%ERRORLEVEL%
node tests\season-scope-negative.js
set RC12=%ERRORLEVEL%
rem v2.49.0：爱奇艺中文源那一环（判据在页面、白名单在服务端）+ 它的负测 + 服务端规则的本地自测
node tests\iq-source-check.js
set RC13=%ERRORLEVEL%
node tests\iq-source-negative.js
set RC14=%ERRORLEVEL%
python -X utf8 tests\iq_relay_rules_check.py
set RC15=%ERRORLEVEL%
python -X utf8 tests\iq_relay_rules_negative.py
set RC16=%ERRORLEVEL%
rem v2.49.0：存量季切（判据在页面、夹具在门禁）+ 它的负测跑手
node tests\reslice-check.js
set RC17=%ERRORLEVEL%
node tests\reslice-negative.js
set RC18=%ERRORLEVEL%
rem v2.50.0：时长同源这条链（页面 dbInfo 端点顺序/降级/缓存 + 本机 /db-info 的判决与服务契约），各档都配负测
node tests\dbinfo-transport-check.js
set RC19=%ERRORLEVEL%
node tests\dbinfo-transport-negative.js
set RC20=%ERRORLEVEL%
python -X utf8 tests\db_info_rules_check.py
set RC21=%ERRORLEVEL%
python -X utf8 tests\db_info_rules_negative.py
set RC22=%ERRORLEVEL%
echo.
echo EXIT CODE: cred=%RC0% regression=%RC1% douban-sync=%RC2% douban-push=%RC3% desk-tier=%RC4% phone-canon=%RC5% name-refresh=%RC6% phone-use=%RC7% phone-look=%RC8% ep-duration=%RC9% syntax=%RC10% season-scope=%RC11% season-scope-neg=%RC12% iq-source=%RC13% iq-source-neg=%RC14% iq-rules=%RC15% iq-rules-neg=%RC16% reslice=%RC17% reslice-neg=%RC18% dbinfo-transport=%RC19% dbinfo-transport-neg=%RC20% db-rules=%RC21% db-rules-neg=%RC22%
if not "%RC0%"=="0" exit /b 1
if not "%RC1%"=="0" exit /b 2
if not "%RC2%"=="0" exit /b 3
if not "%RC3%"=="0" exit /b 4
if not "%RC4%"=="0" exit /b 5
if not "%RC5%"=="0" exit /b 6
if not "%RC6%"=="0" exit /b 7
if not "%RC7%"=="0" exit /b 8
if not "%RC8%"=="0" exit /b 9
if not "%RC9%"=="0" exit /b 10
if not "%RC10%"=="0" exit /b 11
if not "%RC11%"=="0" exit /b 12
if not "%RC12%"=="0" exit /b 13
if not "%RC13%"=="0" exit /b 14
if not "%RC14%"=="0" exit /b 15
if not "%RC15%"=="0" exit /b 16
if not "%RC16%"=="0" exit /b 17
if not "%RC17%"=="0" exit /b 18
if not "%RC18%"=="0" exit /b 19
if not "%RC19%"=="0" exit /b 20
if not "%RC20%"=="0" exit /b 21
if not "%RC21%"=="0" exit /b 22
if not "%RC22%"=="0" exit /b 23
pause