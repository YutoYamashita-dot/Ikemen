// server.js
import express from "express";
import cors from "cors";

const app = express();
const PORT = process.env.PORT || 3000;

app.use(cors({ origin: true }));
app.use(express.json());

/* ---------------- cache ---------------- */
const cache = new Map();
const TTL_MS = 6 * 60 * 60 * 1000;

const getCache = (k) => {
  const v = cache.get(k);
  if (!v) return null;
  if (Date.now() - v.at > TTL_MS) {
    cache.delete(k);
    return null;
  }
  return v.data;
};
const setCache = (k, d) => cache.set(k, { at: Date.now(), data: d });

/* -------------- utils -------------- */
const PREFS = [
  "北海道","青森県","岩手県","宮城県","秋田県","山形県","福島県",
  "茨城県","栃木県","群馬県","埼玉県","千葉県","東京都","神奈川県",
  "新潟県","富山県","石川県","福井県","山梨県","長野県",
  "岐阜県","静岡県","愛知県","三重県",
  "滋賀県","京都府","大阪府","兵庫県","奈良県","和歌山県",
  "鳥取県","島根県","岡山県","広島県","山口県",
  "徳島県","香川県","愛媛県","高知県",
  "福岡県","佐賀県","長崎県","熊本県","大分県","宮崎県","鹿児島県","沖縄県"
];

const normalize = (s) =>
  (s || "").toString()
    .replace(/\s+/g, "")
    .replace(/[（）()[\]【】]/g, "")
    .trim();

const extractPref = (s) => PREFS.find((p) => s.includes(p)) || null;

const expandNames = (raw) => {
  const norm = normalize(raw);
  const pref = extractPref(norm);
  const withoutPref = pref ? norm.replace(pref, "") : norm;
  const base = withoutPref.replace(/(特別区|[区市町村])$/u, "");
  return Array.from(new Set([
    norm, withoutPref, base,
    base + "区", base + "市", base + "町", base + "村"
  ].filter(Boolean)));
};

const num = (x) => {
  if (x == null) return null;
  const s = String(x).replace(/[^0-9.eE+-]/g, "");
  if (!s) return null;
  const n = Number(s);
  return Number.isFinite(n) ? n : null;
};

const ts = (x) => {
  if (!x) return 0;
  const t = Date.parse(x);
  return Number.isFinite(t) ? t : 0;
};

function stdNormCdf(x) {
  const t = 1 / (1 + 0.2316419 * Math.abs(x));
  const d = 0.3989422804014327 * Math.exp(-(x * x) / 2);
  let p = d * (((((1.330274429 * t) - 1.821255978) * t + 1.781477937) * t - 0.356563782) * t + 0.31938153) * t;
  p = 1 - p;
  return x >= 0 ? p : 1 - p;
}
const upperTailFromHensachi = (h) => 1 - stdNormCdf((h - 50) / 10);

/* 男性人口を年齢レンジで按分（総務省の概算3帯） */
function maleShareByAge(minAge, maxAge) {
  // 男性比で厳密は困難なので、男性人口にも近いシェア（総人口に準じた丸め）
  const bands = [
    [0, 14, 0.127],
    [15, 64, 0.589],
    [65, 99, 0.284],
  ];
  const lo = Math.max(0, Math.min(99, Number(minAge) || 0));
  const hi = Math.max(0, Math.min(99, Number(maxAge) || 99));
  if (hi < lo) return 0;
  let total = 0;
  for (const [b0,b1,share] of bands) {
    const L = Math.max(lo, b0);
    const R = Math.min(hi, b1);
    if (R >= L) total += share * ((R - L + 1) / (b1 - b0 + 1));
  }
  return Math.max(0, Math.min(1, total));
}

/* -------------- Wikidata -------------- */
async function queryWD(sparql, { timeoutMs = 5000, retries = 2 } = {}) {
  let last = null;
  for (let i = 0; i <= retries; i++) {
    const ctrl = new AbortController();
    const id = setTimeout(() => ctrl.abort(), timeoutMs);
    try {
      const url = "https://query.wikidata.org/sparql?format=json&query=" + encodeURIComponent(sparql);
      const r = await fetch(url, {
        headers: {
          "User-Agent": "CoolGuysBackend/1.3 (contact: example@example.com)",
          "Accept": "application/sparql-results+json"
        },
        signal: ctrl.signal
      });
      clearTimeout(id);
      if (!r.ok) throw new Error(`HTTP ${r.status}`);
      const j = await r.json();
      return j?.results?.bindings ?? null;
    } catch (e) {
      last = e;
      clearTimeout(id);
      await new Promise((res) => setTimeout(res, 300 * (i + 1)));
    }
  }
  return null;
}

async function fetchCandidates(rawRegion) {
  const norm = normalize(rawRegion);
  const prefHint = extractPref(norm);
  const names = expandNames(norm);
  const pat = names.map((n) => n.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")).join("|");

  const classes = [
    "wd:Q515",      // city
    "wd:Q532",      // special ward (Tokyo)
    "wd:Q30335059", // ward of Japan
    "wd:Q1012369",  // town
    "wd:Q5322507",  // village
    "wd:Q15284"     // municipality
  ].join(" ");

  const sparql = `
SELECT ?item ?itemLabel ?prefLabel ?male ?female ?total ?area ?maleTime ?femaleTime ?popTime WHERE {
  VALUES ?class { ${classes} }
  ?item wdt:P17 wd:Q17 .
  ?item wdt:P31 ?class .

  OPTIONAL { ?item wdt:P131 ?pref . ?pref rdfs:label ?prefLabel . FILTER(LANG(?prefLabel)="ja") }

  OPTIONAL { ?item p:P1540 ?mStmt . ?mStmt ps:P1540 ?male . OPTIONAL { ?mStmt pq:P585 ?maleTime } }
  OPTIONAL { ?item p:P1539 ?fStmt . ?fStmt ps:P1539 ?female . OPTIONAL { ?fStmt pq:P585 ?femaleTime } }
  OPTIONAL { ?item p:P1082 ?tStmt . ?tStmt ps:P1082 ?total . OPTIONAL { ?tStmt pq:P585 ?popTime } }

  OPTIONAL { ?item wdt:P2046 ?area }

  ?item rdfs:label ?itemLabel .
  FILTER (LANG(?itemLabel) = "ja" || LANG(?itemLabel) = "en")
  OPTIONAL { ?item skos:altLabel ?alt . FILTER (LANG(?alt) = "ja") }

  FILTER (
    regex(str(?itemLabel), "^(${pat})$", "i") ||
    regex(str(?alt), "^(${pat})$", "i") ||
    regex(str(?itemLabel), "(${pat})", "i")
  )
}
ORDER BY DESC(?popTime) DESC(?maleTime) DESC(?total)
LIMIT 20
  `;

  const rows = await queryWD(sparql);
  if (!rows) return [];

  const suff = /[区市町村]$/u.test(norm) ? norm.slice(-1) : "";

  const scored = rows.map((r) => {
    const label = r?.itemLabel?.value ?? "";
    const labelNorm = normalize(label);
    const pref = r?.prefLabel?.value ?? "";
    const male = num(r?.male?.value);
    const female = num(r?.female?.value);
    const total = num(r?.total?.value);
    const area = num(r?.area?.value);
    const maleTime = ts(r?.maleTime?.value);
    const popTime  = ts(r?.popTime?.value);

    let score = 0;
    if (labelNorm === norm) score += 1000;
    if (suff && labelNorm.endsWith(suff)) score += 50;
    if (prefHint && pref && pref.includes(prefHint)) score += 300;

    const mag = (total ?? male ?? 0) || 0;
    score += Math.log10(Math.max(1, mag + 1)) * 10;
    score += (popTime || maleTime) ? Math.min(50, ((Math.max(popTime, maleTime) - 1262304000000) / (365*24*3600*1000))) : 0;

    return {
      score, label, pref,
      male, female, total, areaKm2: area,
      maleTime, popTime
    };
  });

  scored.sort((a,b) => b.score - a.score);
  return scored;
}

/* ---------------- endpoints ---------------- */

app.get("/estimate", async (req, res) => {
  try {
    const rawRegion = (req.query.region ?? "").toString();
    if (!rawRegion) return res.status(400).json({ error: "region required" });

    const minAge = Math.max(0, Math.min(99, parseInt(req.query.minAge ?? "18", 10)));
    const maxAge = Math.max(0, Math.min(99, parseInt(req.query.maxAge ?? "35", 10)));
    const hensachi = req.query.hensachi != null ? Number(req.query.hensachi) : null;

    const norm = normalize(rawRegion);
    const pref = extractPref(norm);
    // キャッシュキー：地域+都道府県ヒント+年齢+偏差値
    const ckey = `est3:${norm}|${pref || ""}|${minAge}-${maxAge}|${hensachi ?? "x"}`;
    const cached = getCache(ckey);
    if (cached) return res.json(cached);

    const cands = await fetchCandidates(norm);
    if (cands.length === 0) {
      const payload = {
        region: rawRegion,
        maleInRange: 0,
        population: { male: 0, total: 0, areaKm2: null },
        model: hensachi != null ? { upperTail: upperTailFromHensachi(hensachi) } : null,
        note: "not-found"
      };
      setCache(ckey, payload);
      return res.json(payload);
    }

    const top = cands[0];

    // 男性人口を最優先で採用（なければ補完）
    let male = top.male ?? ((top.total != null && top.female != null) ? (top.total - top.female) : null);
    if (male == null && top.total != null) male = Math.round(top.total * 0.50);
    male = Math.max(0, Math.round(male ?? 0));

    const share = maleShareByAge(minAge, maxAge);
    let maleInRange = Math.round(male * share);
    if (male > 0 && maleInRange <= 0) maleInRange = 1;

    const payload = {
      region: top.label,
      prefecture: top.pref || null,
      maleInRange,
      population: {
        male,
        total: Math.max(0, Math.round(top.total ?? 0)),
        areaKm2: top.areaKm2 ?? null
      },
      model: hensachi != null ? { upperTail: upperTailFromHensachi(hensachi) } : null
    };
    setCache(ckey, payload);
    return res.json(payload);
  } catch (e) {
    return res.json({
      region: req.query.region ?? "",
      maleInRange: 0,
      population: { male: 0, total: 0, areaKm2: null },
      model: null,
      error: "backend-fallback"
    });
  }
});

app.get("/regions", async (req, res) => {
  try {
    const q = (req.query.q ?? "").toString().trim();
    if (!q) return res.json({ candidates: [] });

    const norm = normalize(q);
    const ckey = `regions3:${norm}`;
    const cached = getCache(ckey);
    if (cached) return res.json(cached);

    const cands = await fetchCandidates(norm);
    const seen = new Set();
    const list = [];
    for (const r of cands) {
      const name = r.pref ? `${r.label}（${r.pref}）` : r.label;
      if (!seen.has(name)) {
        list.push({ regionName: name });
        seen.add(name);
      }
      if (list.length >= 20) break;
    }
    const payload = { candidates: list };
    setCache(ckey, payload);
    return res.json(payload);
  } catch {
    return res.json({ candidates: [] });
  }
});

app.get("/healthz", (_req, res) => res.json({ ok: true }));

app.listen(PORT, () => {
  console.log(`[coolguys-backend] listening on :${PORT}`);
});
