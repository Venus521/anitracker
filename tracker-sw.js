/* AniTracker SW v3 — 同源资源全部 network-first（更新即达，失败回退缓存）；跨域不缓存 */
var CACHE='anitracker-v4';
var PRECACHE=['./index.html','./tracker-manifest.webmanifest'];
self.addEventListener('install',function(e){
  e.waitUntil(caches.open(CACHE).then(function(c){ return c.addAll(PRECACHE); }).then(function(){ return self.skipWaiting(); }));
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
  e.respondWith(
    fetch(e.request).then(function(res){
      try{ if(res&&res.status===200){ var cp=res.clone(); caches.open(CACHE).then(function(c){ c.put(e.request,cp); }); } }catch(err){}
      return res;
    }).catch(function(){ return caches.match(e.request); })
  );
});
