import{getApps,getApp,initializeApp}from"https://www.gstatic.com/firebasejs/10.12.2/firebase-app.js";
import{getAuth,onAuthStateChanged}from"https://www.gstatic.com/firebasejs/10.12.2/firebase-auth.js";
import{getFirestore,doc,setDoc,deleteDoc,collection,query,where,onSnapshot}from"https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js";

/* Firebase الافتراضي */
for(let i=0;i<80&&!getApps().length;i++)await new Promise(r=>setTimeout(r,50));
const app=getApps().length?getApp():initializeApp({apiKey:"AIzaSyDaLsIF93OD-Lr9y51j_s4wB9OzahLUiTQ",authDomain:"grocery-debts.firebaseapp.com",projectId:"grocery-debts",storageBucket:"grocery-debts.firebasestorage.app",messagingSenderId:"484535933298",appId:"1:484535933298:web:87f8e2ea08a6d26231e5eb"});
const auth=getAuth(app),db=getFirestore(app);
const token=new URLSearchParams(location.search).get('c');

/* إرسال إشعار لصاحب الحساب (عند أي تغير) */
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

/* عند أي تغيير في رصيد أي عميل يتم إرسال إشعار لصاحب الحساب */
if(token){
  let stop=null;
  onAuthStateChanged(auth,u=>{
    if(stop){stop();stop=null;}
    if(!u)return;
    const last=new Map();
    stop=onSnapshot(query(collection(db,'accounts'),where('owner','==',u.uid)),s=>{
      s.docChanges().forEach(ch=>{
        const a=ch.doc.data(),id=ch.doc.id,b=Number(a.balance)||0;
        const prev=last.get(id);last.set(id,b);
        if(ch.type!=='modified'||prev===undefined||ch.doc.metadata.hasPendingWrites)return;
        const d=b-prev;if(!d)return;
        const amt=Math.abs(d),cur=a.currency||'ر.ي',f=n=>n.toLocaleString('en-US',{maximumFractionDigits:2});
        setDoc(doc(collection(db,'accounts',id,'tx')),{type:d>0?'debt':'payment',amount:amt,note:'',ts:Date.now()}).catch(()=>{});
        window.notifyCustomer(id,'رصيدك — '+cur+' '+f(amt)+' | '+(d>0?'عليك':'لك')+'  المتبقي:  '+f(b)+'  '+cur,'ديوني');
      });
    });
  });
}

/* تفعيل الإشعارات */
const u8=s=>Uint8Array.from(atob(s.replace(/-/g,'+').replace(/_/g,'/')),c=>c.charCodeAt(0));
const sha=async s=>[...new Uint8Array(await crypto.subtle.digest('SHA-256',new TextEncoder().encode(s)))].map(b=>b.toString(16).padStart(2,'0')).join('');
const b64url=buf=>btoa(String.fromCharCode(...new Uint8Array(buf))).replace(/\+/g,'-').replace(/\//g,'_').replace(/=+$/,'');

async function subscribe(){
  const reg=await navigator.serviceWorker.register('sw.js');
  await navigator.serviceWorker.ready;
  const{key}=await(await fetch('/api/notify')).json();
  /* نُبقي الاشتراك الحالي إن كان صالحاً (نفس المفتاح)، ونجدّده فقط إذا تغيّر مفتاح VAPID */
  let sub=await reg.pushManager.getSubscription();
  const cur=sub&&sub.options&&sub.options.applicationServerKey;
  const same=!cur||b64url(cur)===key.replace(/=+$/,'');
  if(sub&&!same){
    try{await deleteDoc(doc(db,'accounts',token,'subs',await sha(sub.endpoint)))}catch(e){}
    await sub.unsubscribe();sub=null;
  }
  if(!sub)sub=await reg.pushManager.subscribe({userVisibleOnly:true,applicationServerKey:u8(key)});
  /* المعرّف ثابت (hash للـ endpoint) فلا تتراكم اشتراكات مكررة */
  await setDoc(doc(db,'accounts',token,'subs',await sha(sub.endpoint)),{sub:JSON.stringify(sub),ts:Date.now()});
}

async function enable(b){
  try{
    if(await Notification.requestPermission()==='granted'){
      if(b)b.textContent='⏳ جار التفعيل...';
      await subscribe();
      if(b)b.remove();
    }else if(b){
      b.textContent='❌ تم رفض الإذن. فعّلها من إعدادات المتصفح ثم أعد المحاولة';
      setTimeout(()=>b.remove(),4000);
    }
  }catch(e){
    if(b)b.textContent='⚠️ تعذر التفعيل. اضغط مرة أخرى للتأكيد';
    console.error(e);
    throw e;
  }
}
window.enablePushNotifications=enable;

/* ترميم تلقائي: كلما فُتح الرابط والإذن ممنوح، يُحفظ الاشتراك من جديد
   (يعالج الاشتراكات التي حُذفت من السيرفر دون أن يشعر العميل) */
if(token&&('serviceWorker' in navigator)&&('PushManager' in window)&&('Notification' in window)&&Notification.permission==='granted'){
  window.addEventListener('load',()=>setTimeout(()=>subscribe().catch(e=>console.error('resub',e)),1500));
}
