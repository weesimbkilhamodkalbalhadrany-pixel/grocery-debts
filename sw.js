// sw.js — تخزين محلي + إشعارات
const V='v3'; // غيّر الرقم (v2, v3...) عند كل تحديث كبير لإجبار تحديث الملفات
const CORE=['/','/index.html','/manifest.json','/icon-192.png','/icon-512.png',
'https://www.gstatic.com/firebasejs/10.12.2/firebase-app.js',
'https://www.gstatic.com/firebasejs/10.12.2/firebase-auth.js',
'https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js',
'https://cdnjs.cloudflare.com/ajax/libs/qrcodejs/1.0.0/qrcode.min.js',
'https://cdn.jsdelivr.net/npm/chart.js@4.4.1/dist/chart.umd.min.js',
'https://cdnjs.cloudflare.com/ajax/libs/html2pdf.js/0.10.1/html2pdf.bundle.min.js'];

const seen=new Set();
// يحفظ الملف وكل ما يستورده (مكتبات Firebase تعتمد على ملفات فرعية كثيرة)
async function deep(c,u){
  if(seen.has(u))return;seen.add(u);
  try{
    const r=await fetch(u);if(!r.ok)return;
    await c.put(u,r.clone());
    if(!/\.js(\?|$)/.test(u))return;
    const t=await r.text(),re=/(?:from|import)\s*\(?\s*["']([^"']+)["']/g,l=[];let m;
    while((m=re.exec(t))){if(/^(\.|https?:)/.test(m[1]))l.push(new URL(m[1],u).href)}
    await Promise.all(l.map(x=>deep(c,x)));
  }catch(e){}
}
self.addEventListener('install',e=>{
  self.skipWaiting();
  e.waitUntil(caches.open(V).then(c=>Promise.all(CORE.map(u=>deep(c,u)))));
});
self.addEventListener('activate',e=>e.waitUntil(
  caches.keys().then(k=>Promise.all(k.filter(x=>x!==V).map(x=>caches.delete(x)))).then(()=>self.clients.claim())
));

// يفتح فوراً من الجهاز ثم يحدّث نفسه بالخلفية
const clean=async r=>r.redirected?new Response(await r.blob(),{status:200,headers:r.headers}):r;
self.addEventListener('fetch',e=>{
  const r=e.request;if(r.method!=='GET')return;
  const u=new URL(r.url);
  if(u.pathname.startsWith('/api/')||u.hostname.endsWith('googleapis.com')||u.hostname.endsWith('firebaseapp.com')||u.hostname==='apis.google.com'||u.hostname==='wa.me')return;
  e.respondWith(caches.open(V).then(async c=>{
    const key=r.mode==='navigate'?'/index.html':r;
    const hit=await c.match(key);
    const net=fetch(r).then(res=>{if(res&&(res.ok||res.type==='opaque'))c.put(key,res.clone());return res}).catch(()=>null);
    if(hit){e.waitUntil(net);return clean(hit)}
    return (await net)||new Response('غير متصل',{status:503,headers:{'Content-Type':'text/plain;charset=utf-8'}});
  }));
});

// الإشعارات
self.addEventListener('push',event=>{
  let data={title:'ديوني',body:'لديك إشعار جديد'};
  try{data=event.data.json()}catch(e){if(event.data)data.body=event.data.text()}
  event.waitUntil(self.registration.showNotification(data.title||'ديوني',{
    body:data.body||'',icon:'/icon-192.png',badge:'/icon-192.png',dir:'rtl',lang:'ar',
    vibrate:[200,100,200],tag:'debt-notif-'+Date.now(),renotify:true,requireInteraction:false,
    data:{url:data.url||'/'}
  }));
});
self.addEventListener('notificationclick',event=>{
  event.notification.close();
  const url=event.notification.data?.url||'/';
  event.waitUntil(clients.matchAll({type:'window',includeUncontrolled:true}).then(list=>{
    for(const c of list){if(c.url.includes(self.location.origin)){c.focus();if(c.navigate)c.navigate(url);return}}
    return clients.openWindow(url);
  }));
});
