/* AniTracker SW v12 — v2.13.0 分层缓存策略：
   - 页面/版本探测：network-first（改动即达，失败回退缓存）
   - 数据集/SDK/filler/图标等静态大件：stale-while-revalidate（秒回+后台刷新），
     并在 install 时预缓存——离线二次打开浏览库和账号组件依然可用 */
var CACHE='anitracker-v12';
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
