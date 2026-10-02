const webpush=require('web-push');
const crypto=require('crypto');
const P=process.env.FIREBASE_PROJECT||'grocery-debts';
const FS=`https://firestore.googleapis.com/v1/projects/${P}/databases/(default)/documents`;
const b64=s=>Buffer.from(s.replace(/-/g,'+').replace(/_/g,'/'),'base64');

async function verify(jwt){
  const p=(jwt||'').split('.');if(p.length!==3)return null;
  const h=JSON.parse(b64(p[0])),b=JSON.parse(b64(p[1]));
  if(h.alg!=='RS256'||b.aud!==P||b.iss!=='https://securetoken.google.com/'+P||b.exp*1000<Date.now()||!b.sub)return null;
  const{keys}=await(await fetch('https://www.googleapis.com/service_accounts/v1/jwk/securetoken@system.gserviceaccount.com')).json();
  const k=keys.find(x=>x.kid===h.kid);if(!k)return null;
  const ok=crypto.verify('RSA-SHA256',Buffer.from(p[0]+'.'+p[1]),crypto.createPublicKey({key:k,format:'jwk'}),b64(p[2]));
  return ok?b.sub:null;
}

module.exports=async(req,res)=>{
  if(req.method==='GET')return res.json({key:process.env.VAPID_PUBLIC_KEY||''});
  if(req.method!=='POST')return res.status(405).end();
  try{
    const jwt=(req.headers.authorization||'').replace('Bearer ','');
    const uid=await verify(jwt);if(!uid)return res.status(401).json({error:'auth'});
    // استخراج العنوان (title) بالإضافة إلى التوكن والرسالة
    const{token,msg,title}=req.body||{};
    if(!/^[a-f0-9]{32,64}$/.test(token||'')||typeof msg!=='string'||!msg||msg.length>300)return res.status(400).json({error:'input'});
    const H={Authorization:'Bearer '+jwt};
    const a=await fetch(`${FS}/accounts/${token}`,{headers:H});
    if(!a.ok)return res.status(404).json({error:'account'});
    if((await a.json()).fields?.owner?.stringValue!==uid)return res.status(403).json({error:'owner'});
    const s=await fetch(`${FS}/accounts/${token}/subs`,{headers:H});
    const docs=(await s.json()).documents||[];
    webpush.setVapidDetails(process.env.VAPID_SUBJECT||'mailto:admin@example.com',process.env.VAPID_PUBLIC_KEY,process.env.VAPID_PRIVATE_KEY);
    // العنوان الديناميكي: يستخدم الاسم المُرسل من التطبيق (اسم المتجر)، وإذا لم يُرسل يستخدم "ديوني" كافتراضي
    const payload=JSON.stringify({title:title||'ديوني',body:msg,url:`https://${req.headers.host}/?c=${token}`});
    let sent=0;
    await Promise.all(docs.map(async d=>{
      try{await webpush.sendNotification(JSON.parse(d.fields.sub.stringValue),payload);sent++}
      catch(e){if(e.statusCode===404||e.statusCode===410)await fetch(`https://firestore.googleapis.com/v1/${d.name}`,{method:'DELETE',headers:H})}
    }));
    res.json({ok:true,sent});
  }catch(e){res.status(500).json({error:'server'})}
};
