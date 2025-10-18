// /api/estimate.js (JavaScript)
const JP_AGE_BANDS = [
  { from: 0,  to: 14, share: 0.127 },
  { from: 15, to: 64, share: 0.589 },
  { from: 65, to: 99, share: 0.284 },
];

function clampAge(a){ return Math.max(0, Math.min(99, Math.floor(a))); }
function ageShare(minAge, maxAge){
  let amin = clampAge(minAge), amax = clampAge(maxAge);
  if(amin>amax) [amin,amax]=[amax,amin];
  let total=0;
  for(const b of JP_AGE_BANDS){
    const lo=Math.max(amin,b.from), hi=Math.min(amax,b.to);
    if(hi>=lo){
      const years=hi-lo+1, width=b.to-b.from+1;
      total += b.share*(years/width);
    }
  }
  return Math.max(0,Math.min(1,total));
}
function buildPattern(region){
  const normalized = region.replace(/\s+/g,'');
  const bare = normalized.replace(/(区|市|町|村)$/g,'');
  const alts = Array.from(new Set([normalized,bare,`${bare}区`,`${bare}市`,`${bare}町`,`${bare}村`])).filter(Boolean);
  const escaped = alts.map(s=>s.replace(/[.*+?^${}()|[\]\\]/g,'\\$&')).join('|');
  return `(${escaped})(区|市|町|村)?`;
}
async function fetchWd(region){
  const pattern=buildPattern(region);
  const exact = `FILTER( regex(str(?itemLabel), "^${pattern}$", "i") )`;
  const loose = `FILTER( regex(str(?itemLabel), "${pattern}", "i") )`;
  const query=(filter)=>`
SELECT ?item ?itemLabel ?male ?female ?total ?popTime ?area WHERE {
  ?item wdt:P17 wd:Q17 .
  OPTIONAL { ?item p:P1540 ?m . ?m ps:P1540 ?male . OPTIONAL { ?m pq:P585 ?popTime } }
  OPTIONAL { ?item p:P1539 ?f . ?f ps:P1539 ?female . }
  OPTIONAL { ?item p:P1082 ?t . ?t ps:P1082 ?total . }
  OPTIONAL { ?item wdt:P2046 ?area }
  SERVICE wikibase:label { bd:serviceParam wikibase:language "ja,en". }
  ${filter}
}
ORDER BY DESC(?popTime) DESC(?male) DESC(?total)
LIMIT 1`;
  for(const filter of [exact,loose]){
    const url=`https://query.wikidata.org/sparql?format=json&query=${encodeURIComponent(query(filter))}`;
    const resp=await fetch(url,{headers:{
      'User-Agent':'CoolGuysApp/1.0 (Vercel; contact: example@example.com)',
      'Accept':'application/sparql-results+json'
    }});
    if(!resp.ok) continue;
    const body=await resp.json();
    const arr=body?.results?.bindings??[];
    if(!arr.length) continue;
    const b=arr[0];
    const num=x=> typeof x?.value==='string'? Number(x.value.replace(/[^0-9.eE+-]/g,'')):undefined;
    return {
      male: num(b.male),
      female: num(b.female),
      total: num(b.total),
      areaKm2: num(b.area),
      popTime: b.popTime?.value ?? null,
      label: b.itemLabel?.value ?? null
    };
  }
  return null;
}
function stdNormCdf(x){
  const t=1/(1+0.2316419*Math.abs(x));
  const d=0.3989422804014327*Math.exp(-(x*x)/2);
  let p=d*(((((1.330274429*t-1.821255978)*t+1.781477937)*t-0.356563782)*t+0.31938153)*t);
  p=1-p; return x>=0?p:1-p;
}
export default async function handler(req,res){
  try{
    const region=String(req.query.region ?? req.body?.region ?? '').trim();
    const minAge=Number(req.query.minAge ?? req.body?.minAge ?? 18);
    const maxAge=Number(req.query.maxAge ?? req.body?.maxAge ?? 35);
    const hensachi=Number(req.query.hensachi ?? req.body?.hensachi ?? 65);
    if(!region){ res.status(400).json({error:'region is required'}); return; }

    const wd=await fetchWd(region);
    const maleTotal = (wd?.male&&wd.male>0? wd.male :
                      (wd?.total&&wd?.female? Math.max(0, wd.total - wd.female) :
                       (wd?.total? Math.round(wd.total*0.50) : 0)));
    const areaKm2 = wd?.areaKm2 ?? null;

    const share = ageShare(minAge,maxAge);
    const maleInRange = Math.max(0, Math.ceil(maleTotal*share));

    const z=(hensachi-50)/10;
    const upper=1-stdNormCdf(z);
    const estimatedCoolGuys = Math.ceil(maleInRange*upper);

    res.status(200).json({
      regionResolved: wd?.label ?? region,
      population: { male: maleTotal, total: wd?.total ?? null, areaKm2 },
      ageShare: { minAge, maxAge, share },
      model: { upperTail: upper },
      maleInRange,
      estimatedCoolGuys
    });
  }catch(e){
    res.status(502).json({error:'backend-failure', detail:String(e?.message??e)});
  }
}