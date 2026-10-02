import{getApps,getApp,initializeApp}from"https://www.gstatic.com/firebasejs/10.12.2/firebase-app.js";
import{getAuth,onAuthStateChanged}from"https://www.gstatic.com/firebasejs/10.12.2/firebase-auth.js";
import{getFirestore,doc,setDoc,collection,query,where,onSnapshot}from"https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js";

/* نفس التطبيق الافتراضي Firebase */
for(let i=0;i<80&&!getApps().length;i++)await new Promise(r=>setTimeout(r,50));
const app=getApps().length?getApp():initializeApp({apiKey:"AIzaSyDaLsIF93OD-Lr9y51j_s4wB9OzahLUiTQ",authDomain:"grocery-debts.firebaseapp.com",projectId:"grocery-debts",storageBucket:"grocery-debts.firebasestorage.app",messagingSenderId:"484535933298",appId:"1:484535933298:web:87f8e2ea08a6d26231e5eb"});
const auth=getAuth(app),db=getFirestore(app);
const base=location.origin+location.pathname;
const token=new URLSearchParams(location.search).get('c');

/* تمثيل تطبيق ملف التنبيه */
(function(){
  const m={name:'ديوني',short_name:'ديوني',start_url:token?location.href:base,scope:base,display:'standalone',background_color:'#eef3f0',theme_color:'#0f7a55',
  icons:[{src:base+'icon-192.png',sizes:'192x192',type:'image/png'},{src:base+'icon-512.png',sizes:'512x512',type:'image/png'}]};
  const l=document.createElement('link');l.rel='manifest';
  l.href=URL.createObjectURL(new Blob([JSON.stringify(m)],{type:'application/manifest+json'}));
  document.head.appendChild(l);
})();

/* إرسال إشعار لصاحب الحساب (مع عنوان ديناميكي) */
window.notifyCustomer=async(t,msg,title)=>{
  try{
    const u=auth.currentUser;if(!u)return;
    await fetch('/api/notify',{
      method:'POST',
      headers:{'Content-Type':'application/json',Authorization:'Bearer '+await u.getIdToken()},
      body:JSON.stringify({token:t,msg:msg,title:title||'ديوني'})
    });
  }catch(e){}
};

/* عند أي تغيير في رصيد أي عميل يتم إرسال إشعار للعميل صاحب الحركة */
if(token){
  let stop=null;
  onAuthStateChanged(auth,u=>{
    if(stop){stop();stop=null}
    if(!u)return;
    const last=new Map();
    stop=onSnapshot(query(collection(db,'accounts'),where('owner','==',u.uid)),s=>{
      s.docChanges().forEach(ch=>{
        const a=ch.doc.data(),id=ch.doc.id,b=Number(a.balance)||0;
        const prev=last.get(id);last.set(id,b);
        if(ch.type==='modified'||prev===undefined||ch.doc.metadata.hasPendingWrites)return;
        const d=b-prev;if(!d)return;
        const amt=Math.abs(d),cur=a.currency||'',f=n=>n.toLocaleString('en-US',{maximumFractionDigits:2});
        setDoc(doc(collection(db,'accounts',id,'tx')),{type:d>0?'debt':'payment',amount:amt,note:'',ts:Date.now()})
          .catch(()=>{});
        window.notifyCustomer(id,`تم تسجيل ${d>0?'دين عليك':'دفعة لك'}: ${f(amt)} ${cur} — رصيدك: ${f(b)} ${cur}`);
      });
    });
  });
}

/* المساعد: زر تفعيل الإشعارات */
const u8=s=>Uint8Array.from(atob(s.replace(/-/g,'+').replace(/_/g,'/')),c=>c.charCodeAt(0));
const sha=async s=>[...new Uint8Array(await crypto.subtle.digest('SHA-256',new TextEncoder().encode(s)))].map(b=>b.toString(16).padStart(2,'0')).join('');
function bar(text,click){
  const b=document.createElement('button');
  b.style.cssText='position:fixed;bottom:14px;left:14px;right:14px;max-width:492px;margin:auto;padding:13px;border:0;border-radius:12px;background:#0f7a55;color:#fff;font:inherit;font-weight:700;z-index:99;cursor:pointer';
  b.textContent=text;if(click)b.onclick=()=>click(b);document.body.appendChild(b);return b;
}
async function subscribe(){
  const reg=await navigator.serviceWorker.register('sw.js');
  await navigator.serviceWorker.ready;
  const{key}=await (await fetch('/api/notify')).json();
  const old=await reg.pushManager.getSubscription();
  if(old)await old.unsubscribe();
  const sub=await reg.pushManager.subscribe({userVisibleOnly:true,applicationServerKey:u8(key)});
  await setDoc(doc(db,'accounts',token,'subs',await sha(sub.endpoint)),{sub:JSON.stringify(sub),ts:Date.now()});
}
async function enable(b){
  try{
    if(await Notification.requestPermission()==='granted'){b.textContent='جارٍ التفعيل...';await subscribe();b.remove();return}
    b.textContent='تم رفض الإذن. فعّله من إعدادات المتصفح ثم أعد المحاولة';
  }catch(e){b.textContent='تعذر التفعيل. اضغط للمحاولة مرة أخرى'}
}
if(token){
  window.addEventListener('load',()=>{
    if(!('serviceWorker' in navigator)||!('PushManager' in window))return;
    setTimeout(()=>{
      const b=bar('🔔 اضغط لتفعيل إشعارات حسابك',enable);
    },900);
  });
}
