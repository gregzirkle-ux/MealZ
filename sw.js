const CACHE='rdg-sv-14';
const FILES=['index.html','app.js','cloud.js','archive.js','report.js','docx.umd.js','logo.png','manifest.json','icon-192.png','icon-512.png','apple-touch-icon.png'];
const BASE=new URL('./',self.location.href);
self.addEventListener('install',event=>event.waitUntil((async()=>{
 const cache=await caches.open(CACHE);
 // All required files must be available before this version can replace the old one.
 await cache.addAll(FILES.map(f=>new Request(new URL(f,BASE),{cache:'reload'})));
})()));
self.addEventListener('message',event=>{if(event.data==='ACTIVATE')self.skipWaiting();});
self.addEventListener('activate',event=>event.waitUntil((async()=>{for(const key of await caches.keys())if(key.startsWith('rdg-sv-')&&key!==CACHE)await caches.delete(key);await self.clients.claim();})()));
self.addEventListener('fetch',event=>{
 if(event.request.method!=='GET')return;
 const u=new URL(event.request.url);if(u.origin!==BASE.origin)return;
 let file=u.pathname.slice(BASE.pathname.length);if(u.pathname===BASE.pathname)file='index.html';
 if(!FILES.includes(file))return;
 event.respondWith((async()=>{const cache=await caches.open(CACHE),key=new URL(file,BASE).href;const hit=await cache.match(key);if(hit)return hit;const response=await fetch(event.request);if(response.ok)await cache.put(key,response.clone());return response;})());
});
