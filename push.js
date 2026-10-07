import{getApps,getApp,initializeApp}from"https://www.gstatic.com/firebasejs/10.12.2/firebase-app.js";
import{getAuth,onAuthStateChanged}from"https://www.gstatic.com/firebasejs/10.12.2/firebase-auth.js";
import{getFirestore,doc,setDoc,deleteDoc,collection,query,where,onSnapshot}from"https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js";

/* ===== إعدادات ===== */
const FB_CONFIG={
  apiKey:"AIzaSyDaLsIF93OD-Lr9y51j_s4wB9OzahLUiTQ",
  authDomain:"grocery-debts.firebaseapp.com",
  projectId:"grocery-debts",
  storageBucket:"grocery-debts.firebasestorage.app",
  messagingSenderId:"484535933298",
  appId:"1:484535933298:web:87f8e2ea08a6d26231e5eb"
};

const token=new URLSearchParams(location.search).get('c');

/* ===== تهيئة Firebase غير حاجبة (لا توقف تعريف الدوال) ===== */
let app=null,auth=null,db=null;
const FB_READY=(async()=>{
  for(let i=0;i<80&&!getApps().length;i++)await new Promise(r=>setTimeout(r,50));
  app=getApps().length?getApp():initializeApp(FB_CONFIG);
  auth=getAuth(app);
  db=getFirestore(app);
  return {app,auth,db};
})();

/* ===== أدوات مساعدة ===== */
const withT=(p,ms,msg)=>Promise.race([
  p,
  new Promise((_,rej)=>setTimeout(()=>rej(new Error(msg||'انتهت المهلة')),ms))
]);
const u8=s=>Uint8Array.from(atob(s.replace(/-/g,'+').replace(/_/g,'/')),c=>c.charCodeAt(0));
const sha=async s=>[...new Uint8Array(await crypto.subtle.digest('SHA-256',new TextEncoder().encode(s)))].map(b=>b.toString(16).padStart(2,'0')).join('');
const b64url=buf=>btoa(String.fromCharCode(...new Uint8Array(buf))).replace(/\+/g,'-').replace(/\//g,'_').replace(/=+$/,'');

/* ===== إرسال إشعار لصاحب الحساب ===== */
window.notifyCustomer=async(t,msg,title)=>{
  try{
    await FB_READY;
    const u=auth.currentUser;if(!u)return;
    await withT(fetch('/api/notify',{
      method:'POST',
      headers:{'Content-Type':'application/json',Authorization:'Bearer '+await u.getIdToken()},
      body:JSON.stringify({token:t,msg:msg,title:title||'ديوني'})
    }),12000,'فشل إرسال الإشعار');
  }catch(e){console.warn('notifyCustomer:',e.message)}
};

/* ===== مراقبة تغيّر الرصيد (يُرسل إشعاراً للعميل) ===== */
if(token){
  let stop=null;
  FB_READY.then(({auth,db})=>{
    onAuthStateChanged(auth,u=>{
      if(stop){stop();stop=null}
      if(!u)return;
      const last=new Map();
      stop=onSnapshot(query(collection(db,'accounts'),where('owner','==',u.uid)),s=>{
        s.docChanges().forEach(ch=>{
          const a=ch.doc.data(),id=ch.doc.id,b=Number(a.balance)||0;
          const prev=last.get(id);last.set(id,b);
          if(ch.type!=='modified'||prev===undefined||ch.doc.metadata.hasPendingWrites)return;
          const d=b-prev;if(!d)return;
          const amt=Math.abs(d),cur=a.currency||'ر.ي';
          const f=n=>n.toLocaleString('en-US',{maximumFractionDigits:2});
          setDoc(doc(collection(db,'accounts',id,'tx')),{
            type:d>0?'debt':'payment',amount:amt,note:'',ts:Date.now()
          }).catch(()=>{});
          window.notifyCustomer(
            id,
            'رصيدك — '+cur+' '+f(amt)+' | '+(d>0?'عليك':'لك')+'  المتبقي:  '+f(b)+'  '+cur,
            'ديوني'
          );
        });
      });
    });
  });
}

/* ===== تسجيل الاشتراك في الإشعارات ===== */
async function subscribe(){
  await FB_READY;

  const reg=await withT(navigator.serviceWorker.register('sw.js'),10000,'فشل تسجيل Service Worker');
  await withT(navigator.serviceWorker.ready,10000,'Service Worker لم يُنشَّط');

  /* جلب مفتاح VAPID من السيرفر */
  let key;
  try{
    const r=await withT(fetch('/api/notify'),10000,'فشل جلب مفتاح VAPID');
    if(!r.ok)throw new Error('HTTP '+r.status);
    ({key}=await r.json());
    if(!key)throw new Error('لم يُرجع السيرفر المفتاح');
  }catch(e){
    throw new Error('لا يمكن الوصول لخادم الإشعارات: '+e.message);
  }

  /* التحقق من الاشتراك الحالي */
  let sub=await reg.pushManager.getSubscription();
  const cur=sub&&sub.options&&sub.options.applicationServerKey;
  const same=!cur||b64url(cur)===key.replace(/=+$/,'');

  if(sub&&!same){
    try{await deleteDoc(doc(db,'accounts',token,'subs',await sha(sub.endpoint)))}catch(e){}
    try{await sub.unsubscribe()}catch(e){}
    sub=null;
  }

  /* إنشاء اشتراك جديد */
  if(!sub){
    sub=await withT(
      reg.pushManager.subscribe({userVisibleOnly:true,applicationServerKey:u8(key)}),
      15000,
      'المتصفح رفض الاشتراك أو تأخر'
    );
  }

  /* حفظ الاشتراك في Firestore */
  await withT(
    setDoc(doc(db,'accounts',token,'subs',await sha(sub.endpoint)),{
      sub:JSON.stringify(sub),
      ts:Date.now()
    }),
    10000,
    'فشل حفظ الاشتراك'
  );

  return true;
}

/* ===== تفعيل الإشعارات (الدالة العامة) ===== */
async function enablePushNotifications(){
  try{
    /* 1) طلب الإذن */
    let perm=Notification.permission;
    if(perm!=='granted'){
      perm=await withT(
        Notification.requestPermission(),
        15000,
        'لم تستجب نافذة الإذن'
      );
    }
    if(perm!=='granted')throw new Error('لم يتم منح الإذن من المستخدم');

    /* 2) تسجيل الاشتراك */
    await subscribe();
    return true;
  }catch(e){
    console.error('push error:',e);
    throw e;
  }
}

/* ✅ التعريف فوراً — قبل أي انتظار */
window.enablePushNotifications=enablePushNotifications;
window.pushReady=true;

/* ===== ترميم تلقائي للاشتراك عند فتح الرابط ===== */
if(
  token &&
  'serviceWorker' in navigator &&
  'PushManager' in window &&
  'Notification' in window &&
  Notification.permission==='granted'
){
  window.addEventListener('load',()=>{
    setTimeout(()=>{
      subscribe().catch(e=>console.warn('resub:',e.message));
    },1500);
  });
}
