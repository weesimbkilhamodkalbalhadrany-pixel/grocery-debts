const webpush=require('web-push');
const crypto=require('crypto');
const P=process.env.FIREBASE_PROJECT||'grocery-debts';
const FS=`https://firestore.googleapis.com/v1/projects/${P}/databases/(default)/documents`;
const b64=s=>Buffer.from(s.replace(/-/g,'+').replace(/_/g,'/'),'base64');

const KC={keys:null,t:0};
async function verify(jwt){
  const p=(jwt||'').split('.');if(p.length!==3)return null;
  const h=JSON.parse(b64(p[0])),b=JSON.parse(b64(p[1]));
  if(h.alg!=='RS256'||b.aud!==P||b.iss!=='https://securetoken.google.com/'+P||b.exp*1000<Date.now()||!b.sub)return null;
  if(!KC.keys||Date.now()-KC.t>36e5||!KC.keys.find(x=>x.kid===h.kid)){KC.keys=(await(await fetch('https://www.googleapis.com/service_accounts/v1/jwk/securetoken@system.gserviceaccount.com')).json()).keys;KC.t=Date.now()}
  const k=KC.keys.find(x=>x.kid===h.kid);if(!k)return null;
  const ok=crypto.verify('RSA-SHA256',Buffer.from(p[0]+'.'+p[1]),crypto.createPublicKey({key:k,format:'jwk'}),b64(p[2]));
  return ok?b.sub:null;
}

module.exports=async(req,res)=>{
  if(req.method==='GET')return res.json({key:process.env.VAPID_PUBLIC_KEY||''});
  if(req.method!=='POST')return res.status(405).end();
  try{
    const jwt=(req.headers.authorization||'').replace('Bearer ','');
    const uid=await verify(jwt);if(!uid)return res.status(401).json({error:'auth'});

    const{token,msg,title}=req.body||{};
    if(!/^[a-f0-9]{32,64}$/.test(token||'')||typeof msg!=='string'||!msg||msg.length>300)return res.status(400).json({error:'input'});

    const H={Authorization:'Bearer '+jwt};
    const subsUrl=p=>`${FS}/accounts/${token}/subs?pageSize=300${p?'&pageToken='+encodeURIComponent(p):''}`;
    const[a,s0]=await Promise.all([fetch(`${FS}/accounts/${token}`,{headers:H}),fetch(subsUrl(''),{headers:H})]);
    if(!a.ok)return res.status(404).json({error:'account'});
    if((await a.json()).fields?.owner?.stringValue!==uid)return res.status(403).json({error:'owner'});
    if(!s0.ok){console.error('subs list',s0.status,await s0.text());return res.status(502).json({error:'subs',status:s0.status})}
    let j=await s0.json(),docs=j.documents||[],pt=j.nextPageToken||'';
    while(pt){
      const s=await fetch(subsUrl(pt),{headers:H});
      if(!s.ok){console.error('subs list',s.status);break}
      j=await s.json();docs=docs.concat(j.documents||[]);pt=j.nextPageToken||'';
    }

    webpush.setVapidDetails(
      process.env.VAPID_SUBJECT||'mailto:admin@example.com',
      process.env.VAPID_PUBLIC_KEY,
      process.env.VAPID_PRIVATE_KEY
    );

    const payload=JSON.stringify({
      title:title||'ديوني',
      body:msg,
      url:`https://${req.headers.host}/?c=${token}`
    });

    // urgency:high يوقظ الجهاز فوراً، وTTL يُبقي الإشعار 24 ساعة إن كان الجهاز مطفأً
    const opts={TTL:86400,urgency:'high'};

    let sent=0,failed=0,removed=0;
    await Promise.all(docs.map(async d=>{
      try{
        const sub=JSON.parse(d.fields.sub.stringValue);
        await webpush.sendNotification(sub,payload,opts);
        sent++;
      }catch(e){
        failed++;
        console.error('push fail',e.statusCode,e.body||e.message);
        // اشتراك منتهي أو ملغى: احذفه
        if(e.statusCode===404||e.statusCode===410){
          removed++;
          await fetch(`https://firestore.googleapis.com/v1/${d.name}`,{method:'DELETE',headers:H}).catch(()=>{});
        }
      }
    }));

    res.json({ok:true,sent,failed,removed,total:docs.length});
  }catch(e){
    console.error('notify error',e);
    res.status(500).json({error:'server'});
  }
};
