// WC2026 Sweepstake Service Worker — offline cache
var CACHE = 'wc2026-v1';
var STATIC = [
  '/wc2026-sweepstake/',
  '/wc2026-sweepstake/index.html',
  '/wc2026-sweepstake/app.js',
  '/wc2026-sweepstake/style.css'
];

self.addEventListener('install', function(e){
  e.waitUntil(caches.open(CACHE).then(function(c){return c.addAll(STATIC);}));
  self.skipWaiting();
});

self.addEventListener('activate', function(e){
  e.waitUntil(caches.keys().then(function(keys){
    return Promise.all(keys.filter(function(k){return k!==CACHE;}).map(function(k){return caches.delete(k);}));
  }));
  self.clients.claim();
});

self.addEventListener('fetch', function(e){
  // Network first for Supabase API calls
  if(e.request.url.indexOf('supabase.co')!==-1){
    e.respondWith(fetch(e.request).catch(function(){return new Response('[]',{headers:{'Content-Type':'application/json'}});}));
    return;
  }
  // Cache first for static assets
  e.respondWith(caches.match(e.request).then(function(cached){
    return cached||fetch(e.request).then(function(res){
      if(res.ok){
        var clone=res.clone();
        caches.open(CACHE).then(function(c){c.put(e.request,clone);});
      }
      return res;
    });
  }));
});
