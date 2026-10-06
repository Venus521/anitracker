/* AniTracker SW v22 — v2.22.0 批次：缓存名 +1，旧 v21 缓存整体作废。
   分层缓存策略沿用 v2.13.0：
   - 页面/版本探测：network-first（改动即达，失败回退缓存）
   - 数据集/SDK/filler/图标等静态大件：stale-while-revalidate（秒回+后台刷新），
     并在 install 时预缓存——离线二次打开浏览库和账号组件依然可用 */
/* 缓存名钉住 build：换界面必须换缓存名，否则旧 SW 会拿 v14 那份继续喂页面。
   名字里带 build 号，门禁就能拿 index.html 的 AT_BUILD 对账——忘了改立刻红，不靠人记「这批该升到 v 几」。 */
/* v2.29.2 版本单一源：此处 'anitracker-v29-20261003b' 与 tracker-version.json 的 build 必须一字不差。
   发版流水线（发版.py）已加 assert；运行期 index.html 的 _atVersionCheck 也会触发对账警告。 */
var CACHE='anitracker-v43-20261007d';
var PRECACHE=['./index.html','./tracker-manifest.webmanifest','./ani-tracker-lib.json','./vendor/cloudbase.full.js','./tracker-filler-data.js','./favicon.ico'];
/* 需要「永远尽量新」的资源：命中即走网络 */
var NETWORK_FIRST=/(^|\/)(index\.html|ani-tracker\.html|tracker-version\.json)$/;
/* 大件静态：先给缓存，后台更新 */
var SWR=/(\.json|\.js|\.png|\.ico|\.webmanifest)$/;

self.addEventListener('install',function(e){
  e.waitUntil(caches.open(CACHE).then(function(c){
    return Promise.all(PRECACHE.map(function(u){ return c.add(u).catch(function(){}); }));
  }).then(function(){ return self.skipWaiting(); }));
});
self.addEventListener('activate',function(e){
  e.waitUntil(caches.keys().then(function(keys){
    return Promise.all(keys.filter(function(k){ return k!==CACHE; }).map(function(k){ return caches.delete(k); }));
  }).then(function(){ return self.clients.claim(); }));
});
self.addEventListener('fetch',function(e){
  var url=new URL(e.request.url);
  if(e.request.method!=='GET') return;
  if(url.origin!==location.origin) return;
  var p=decodeURIComponent(url.pathname);
  if(NETWORK_FIRST.test(p)){
    e.respondWith(
      fetch(e.request).then(function(res){
        try{ if(res&&res.status===200){ var cp=res.clone(); caches.open(CACHE).then(function(c){ c.put(e.request,cp); }); } }catch(err){}
        return res;
      }).catch(function(){ return caches.match(e.request); })
    );
    return;
  }
  if(SWR.test(p)){
    e.respondWith(caches.match(e.request).then(function(hit){
      var refresh=fetch(e.request).then(function(res){
        try{ if(res&&res.status===200){ var cp=res.clone(); caches.open(CACHE).then(function(c){ c.put(e.request,cp); }); } }catch(err){}
        return res;
      }).catch(function(){ return hit; });
      return hit||refresh;
    }));
    return;
  }
  /* 其余同源请求维持 network-first */
  e.respondWith(
    fetch(e.request).then(function(res){
      try{ if(res&&res.status===200){ var cp=res.clone(); caches.open(CACHE).then(function(c){ c.put(e.request,cp); }); } }catch(err){}
      return res;
    }).catch(function(){ return caches.match(e.request); })
  );
});
