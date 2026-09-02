/* AniTracker SW — HTML network-first（更新即达），同源静态 cache-first，跨域 API 永不缓存 */
var CACHE='anitracker-v1';
var PRECACHE=['./ani-tracker.html','./tracker-manifest.webmanifest'];
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
  var isHTML=e.request.destination==='document'||/\.html?$/.test(url.pathname);
  if(isHTML){
    e.respondWith(fetch(e.request).then(function(res){
      var cp=res.clone(); caches.open(CACHE).then(function(c){ c.put(e.request,cp); }); return res;
    }).catch(function(){ return caches.match(e.request); }));
  } else {
    e.respondWith(caches.match(e.request).then(function(hit){
      return hit||fetch(e.request).then(function(res){
        var cp=res.clone(); caches.open(CACHE).then(function(c){ c.put(e.request,cp); }); return res;
      });
    }));
  }
});
