/* api/broadcast.js — إشعارات جماعية من لوحة الإدارة فقط (ملف جديد، لا يمس notify.js) */
const webpush=require('web-push');
const crypto=require('crypto');
const P=process.env.FIREBASE_PROJECT||'grocery-debts';
const FS=`https://firestore.googleapis.com/v1/projects/${P}/databases/(default)/documents`;
const ADMINS=(process.env.ADMIN_EMAILS||'weesjjjdu@gmail.com').toLowerCase().split(',').map(s=>s.trim()).filter(Boolean);
const ORIGIN=/^(http:\/\/(127\.0\.0\.1|localhost)(:\d+)?|https:\/\/(grocery-debts[a-z0-9-]*\.vercel\.app|[a-z0-9-]+\.github\.io))$/;
const b64=s=>Buffer.from(s.replace(/-/g,'+').replace(/_/g,'/'),'base64');
const num=n=>Number(n).toLocaleString('en-US',{maximumFractionDigits:2});

const KC={keys:null,t:0};
async function verify(jwt){
  const p=(jwt||'').split('.');if(p.length!==3)return null;
  const h=JSON.parse(b64(p[0])),b=JSON.parse(b64(p[1]));
  if(h.alg!=='RS256'||b.aud!==P||b.iss!=='https://securetoken.google.com/'+P||b.exp*1000<Date.now()||!b.sub)return null;
  if(!KC.keys||Date.now()-KC.t>36e5||!KC.keys.find(x=>x.kid===h.kid)){KC.keys=(await(await fetch('https://www.googleapis.com/service_accounts/v1/jwk/securetoken@system.gserviceaccount.com')).json()).keys;KC.t=Date.now()}
  const k=KC.keys.find(x=>x.kid===h.kid);if(!k)return null;
  const ok=crypto.verify('RSA-SHA256',Buffer.from(p[0]+'.'+p[1]),crypto.createPublicKey({key:k,format:'jwk'}),b64(p[2]));
  return ok?{uid:b.sub,email:String(b.email||'').toLowerCase()}:null;
}

module.exports=async(req,res)=>{
  const o=req.headers.origin||'';
  if(ORIGIN.test(o)){res.setHeader('Access-Control-Allow-Origin',o);res.setHeader('Vary','Origin')}
  res.setHeader('Access-Control-Allow-Headers','Content-Type, Authorization');
  res.setHeader('Access-Control-Allow-Methods','POST, OPTIONS');
  if(req.method==='OPTIONS')return res.status(204).end();
  if(req.method!=='POST')return res.status(405).end();
  try{
    const jwt=(req.headers.authorization||'').replace('Bearer ','');
    const me=await verify(jwt);
    if(!me)return res.status(401).json({error:'auth'});
    if(!ADMINS.includes(me.email))return res.status(403).json({error:'admin'});

    const{title,msg,targets,dry}=req.body||{};
    if(typeof msg!=='string'||!msg.trim()||msg.length>240||(title!==undefined&&(typeof title!=='string'||title.length>60)))return res.status(400).json({error:'input'});
    if(!Array.isArray(targets)||!targets.length||targets.length>2000)return res.status(400).json({error:'targets'});
    const T=targets.filter(t=>t&&/^[A-Za-z0-9]{10,64}$/.test(t.id||'')).map(t=>({
      id:t.id,name:String(t.name||'').slice(0,60),store:String(t.store||'').slice(0,60),
      cur:String(t.cur||'ر.ي').slice(0,10),bal:Number.isFinite(Number(t.bal))?Number(t.bal):0}));
    if(!T.length)return res.status(400).json({error:'targets'});

    const H={Authorization:'Bearer '+jwt};
    const subsOf=async id=>{
      let docs=[],pt='';
      do{
        const r=await fetch(`${FS}/accounts/${id}/subs?pageSize=100${pt?'&pageToken='+encodeURIComponent(pt):''}`,{headers:H});
        if(r.status===403){const e=new Error('rules');e.rules=true;throw e}
        if(!r.ok)return docs;
        const j=await r.json();docs=docs.concat(j.documents||[]);pt=j.nextPageToken||'';
      }while(pt);
      return docs;
    };
    const found=[];
    try{
      for(let i=0;i<T.length;i+=12)
        await Promise.all(T.slice(i,i+12).map(async t=>{(await subsOf(t.id)).forEach(d=>found.push({t,d}))}));
    }catch(e){
      if(e.rules)return res.status(403).json({error:'rules'});
      throw e;
    }

    const ttl=(title||'ديوني').trim()||'ديوني',body=msg.trim();
    const hasPH=/\{(name|balance|currency|store)\}/.test(ttl+body);
    const fill=(s,t)=>s.replace(/\{name\}/g,t.name||'عميلنا').replace(/\{balance\}/g,num(Math.max(t.bal,0)))
      .replace(/\{currency\}/g,t.cur).replace(/\{store\}/g,t.store||'');

    let items=[];
    for(const f of found){
      try{const sub=JSON.parse(f.d.fields.sub.stringValue);if(sub&&sub.endpoint)items.push({t:f.t,d:f.d,sub})}catch(e){}
    }
    if(!hasPH){const seen=new Set();items=items.filter(x=>seen.has(x.sub.endpoint)?false:(seen.add(x.sub.endpoint),true))}
    const accs=new Set(found.map(x=>x.t.id)).size;

    if(dry)return res.json({ok:true,dry:true,targets:T.length,accounts:accs,devices:items.length});
    if(!process.env.VAPID_PUBLIC_KEY||!process.env.VAPID_PRIVATE_KEY)return res.status(500).json({error:'vapid'});
    webpush.setVapidDetails(process.env.VAPID_SUBJECT||'mailto:admin@example.com',process.env.VAPID_PUBLIC_KEY,process.env.VAPID_PRIVATE_KEY);

    let sent=0,failed=0,removed=0;
    for(let i=0;i<items.length;i+=20){
      await Promise.all(items.slice(i,i+20).map(async x=>{
        try{
          const payload=JSON.stringify({title:fill(ttl,x.t).slice(0,60),body:fill(body,x.t).slice(0,300),url:`https://${req.headers.host}/?c=${x.t.id}`});
          await webpush.sendNotification(x.sub,payload,{TTL:86400,urgency:'normal'});
          sent++;
        }catch(e){
          failed++;
          if(e.statusCode===404||e.statusCode===410){
            removed++;
            await fetch(`https://firestore.googleapis.com/v1/${x.d.name}`,{method:'DELETE',headers:H}).catch(()=>{});
          }
        }
      }));
    }
    res.json({ok:true,targets:T.length,accounts:accs,devices:items.length,sent,failed,removed});
  }catch(e){
    console.error('broadcast error',e);
    res.status(500).json({error:'server'});
  }
};
