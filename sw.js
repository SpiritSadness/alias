const CACHE = 'alias-static-v25';
const FILES = ["./appearance.js?v=24", "./entry.js?v=24", "./history.js?v=24", "./play-modes.js?v=24", "./review.js?v=24", "./", "./index.html", "./styles.css?v=24", "./app.js?v=24", "./game-rules.js?v=24", "./storage.js?v=24", "./pwa.js?v=24", "./preferences.js?v=19", "./session.js?v=24", "./navigation.js?v=24", "./definitions.js?v=24", "./manifest.webmanifest?v=18", "./icon.svg?v=18", "./words.js?v=24", "./word-bank.js?v=24", "./icon-192-v18.png", "./icon-512-v18.png", "./icon-maskable-v18.png", "./apple-touch-icon-v18.png", "./word-data-notice.txt"];

self.addEventListener('install', event => {
  event.waitUntil(caches.open(CACHE).then(cache => cache.addAll(FILES)).then(() => self.skipWaiting()));
});
self.addEventListener('activate', event => {
  event.waitUntil(caches.keys().then(keys => Promise.all(keys.filter(key => /^(alias-static-|svoyi-slova-static-)/.test(key) && key !== CACHE).map(key => caches.delete(key)))).then(() => self.clients.claim()));
});
self.addEventListener('message', event => {
  if (event.data?.type !== 'OFFLINE_STATUS' || !event.ports[0]) return;
  event.waitUntil(caches.open(CACHE).then(async cache => {
    const entries = await Promise.all(FILES.map(file => cache.match(file)));
    event.ports[0].postMessage({ ready: entries.every(Boolean) });
  }));
});
// Only the shipped assets enter this cache. Navigation query variants share one key.
const workerBase = new URL('./',self.location.href);
const assetUrls = new Set(FILES.map(file=>new URL(file,workerBase).href));
const indexUrl = new URL('./index.html',workerBase).href;
self.addEventListener('fetch', event => {
  if(event.request.method!=='GET')return;
  const url=new URL(event.request.url);
  if(url.origin!==self.location.origin)return;
  const navigation=event.request.mode==='navigate' && [workerBase.pathname,new URL(indexUrl).pathname].includes(url.pathname);
  const key=navigation?indexUrl:assetUrls.has(url.href)?url.href:null;
  if(!key)return;
  event.respondWith(caches.open(CACHE).then(async cache=>{
    try {
      const response=await fetch(event.request);
      if(response.status>=500||response.status===408)return await cache.match(key)||response;
      if(response.ok)event.waitUntil(cache.put(key,response.clone()));
      return response;
    }catch{return await cache.match(key)||Response.error();}
  }));
});
