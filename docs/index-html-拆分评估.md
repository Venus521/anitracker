/* index.html 拆分评估（2026-10-06 实测）—— 为什么这轮不动它

   结论：**现在拆不划算，且有实质风险。** 下面是量出来的依据，不是定性感觉。

   ── 现状构成（437,653 字节）──────────────────────────────
     主逻辑块8  248,372 字节  'use strict'; var LS={shows:'tr_shows',...}
     二级块9    127,362 字节  「AniTracker v2.x」段
     style     152,184 字节
     其余（模板/HTML/小脚本）约 3.5KB

   数据集**已经外置**过了：v2.13.0 把302 部收藏库（649KB）挪到 ani-tracker-lib.json 懒加载。
   所以「单文件 437KB」里没有大数据，剩的是代码本身。

   ── 为什么现在不动 ──
   ① 跨块依赖 53 处。块8 定义 280 个函数，块9 直接调用其中 53 个
      （addShow / delShow / backList / bindCtx / cacheCover / closeM ...）。
      拆成两个 <script src> 后执行顺序由原先的「文档内先后」变成「加载完成先后」，
      块9 在块8 加载完前跑就会踩undefined。这不是重构，是行为变更。
   ② 交付链路是双入口（index.html 为唯一源，ani-tracker.html 是字节一致的副本），
      加脚本就要把新文件同时塞进：双入口同步、APK 的 WEB_FILES 清单、
      内容包发布清单、WebUpdater 校验、service worker 的 PRECACHE。
      每一处漏了就是「手机上白屏」这种失败，且症状离原因很远。
   ③ 拆分对体积的收益在当前场景下接近零：
      浏览器解压后总量不变，gzip 后的差异远小于内容包上传的 1.95MB。
      index.html 走的是同源单文件请求，拆开反而多几次往返。

   ── 什么时候该做 ──
   真要拆，等满足这两条再动：
   · 有一个「离线白屏」的真实事故（说明单文件有维护代价）
   · 或者开始有第二个人改这个文件（协作成本压过拆分成本）

   届时怎么做（先记下，避免将来重新推演）：
   ① 不要拆成两个 script —— 改成把块8/块9 合并成**一个** tracker-app.js，
      再由 index.html 用 <script src="tracker-app.js?v=..."> 引。
      这样跨块依赖变成同文件内顺序执行，行为与现在完全一致，零风险。
   ② style 同理挪成 tracker-app.css（同一次引入，不必凑成多文件）。
   ③ 新文件要同时进：同步双入口.py 之外的四处清单
      （mobile-shell/build-apk.py 的 WEB_FILES、发布到云端.py 的内容清单、
      tracker-sw.js 的 PRECACHE、以及内容包校验）。
   ④ 每加一处就要跑全量门禁：run-regression / douban-* / phone-look / csp-check / a11y。

   ── 真正的体积大头不在这 ──
   1.95MB 内容包里 839KB 是 vendor/cloudbase.full.js（CloudBase SDK），
   649KB 是 ani-tracker-lib.json（302 部剧的数据，含简介和分集），
   437KB 是 index.html。**SDK 那一坨才是最值得优化的**，
   但它与账号云同步绑定（wasm-eval 那条 CSP 也为它让了路），换 SDK 的风险远大于收益。
   所以现状是：体积不紧急，不必为它做高风险重构。

   这份记录的作用是——下次有人（人或 AI）看到「审计项 1：index.html 未拆分」，
   先读这里，而不是把它当成一条待办的缺陷去盲目动手。
*/
