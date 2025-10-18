import express from "express";
import cors from "cors";

/**
 * 修正ポイント
 * 1) SPARQL に PREFIX を追加（必須）
 * 2) 面積(P2046)は p:/psn:/wikibase:quantityAmount & quantityUnit を使い、km²に正規化
 * 3) 都道府県ヒント、厳密一致→別名一致→部分一致の段階評価は維持
 * 4) 男性人口：P1540 > (P1082 - P1539) > 0.50*P1082
 * 5) タイムアウト/リトライ/キャッシュを維持
 */

const app = express();
const PORT = process.env.PORT || 3000;
app.use(cors({ origin: true }));
app.use(express.json());

/* -------------------------- キャッシュ -------------------------- */
const cache = new Map(); // key -> { data, at }
const TTL_MS = 6 * 60 * 60 * 1000; // 6h

const getCache = (key) => {
  const v = cache.get(key);
  if (!v) return null;
  if (Date.now() - v.at > TTL_MS) {
    cache.delete(key);
    return null;
  }
  return v.data;
};
const setCache = (key, data) => cache.set(key, { data, at: Date.now() });

/* --------------------- 地域名ユーティリティ --------------------- */
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
  (s || "")
    .replace(/\s+/g, "")
    .replace(/[（）()[\]【】]/g, "")
    .trim();

function extractPrefHint(raw) {
  const hit = PREFS.find((p) => raw.includes(p));
  return hit || null;
}

function expandNames(raw) {
  const norm = normalize(raw);
  const pref = extractPrefHint(norm);
  const withoutPref = pref ? norm.replace(pref, "") : norm;
  const base = withoutPref.replace(/(特別区|[区市町村])$/u, "");
  const list = [
    norm, withoutPref,
    base, base + "区", base + "市", base + "町", base + "村",
  ].filter(Boolean);
  return Array.from(new Set(list));
}

/* --------------------- 数値/日付ユーティリティ --------------------- */
const toNum = (v) => {
  if (v == null) return null;
  const s = String(v).replace(/[^0-9.eE+-]/g, "");
  if (!s) return null;
  const n = Number(s);
  return Number.isFinite(n) ? n : null;
};
const toTime = (v) => {
  if (!v) return 0;
  const t = Date.parse(v);
  return Number.isFinite(t) ? t : 0;
};

/* --------------------- 年齢レンジ按分（概算） --------------------- */
function jpAgeShare(minAge, maxAge) {
  const bands = [
    [0, 14, 0.127],
    [15, 64, 0.589],
    [65, 99, 0.284],
  ];
  const lo = Math.max(0, Math.min(99, Number(minAge) || 0));
  const hi = Math.max(0, Math.min(99, Number(maxAge) || 99));
  if (hi < lo) return 0;
  let total = 0;
  for (const [b0, b1, share] of bands) {
    const L = Math.max(lo, b0);
    const R = Math.min(hi, b1);
    if (R >= L) total += share * ((R - L + 1) / (b1 - b0 + 1));
  }
  return Math.max(0, Math.min(1, total));
}

/* --------------------- 偏差値→上位割合 --------------------- */
function stdNormCdf(x) {
  const t = 1 / (1 + 0.2316419 * Math.abs(x));
  const d = 0.3989422804014327 * Math.exp(-(x * x) / 2);
  let p = d * (((((1.330274429 * t) - 1.821255978) * t + 1.781477937) * t - 0.356563782) * t + 0.31938153) * t;
  p = 1 - p;
  return x >= 0 ? p : 1 - p;
}
const upperTailFromHensachi = (h) => 1 - stdNormCdf((h - 50) / 10);

/* ------------------- Wikidata クエリ実行 ------------------- */
const PREFIX = `
PREFIX wd: <http://www.wikidata.org/entity/>
PREFIX wdt: <http://www.wikidata.org/prop/direct/>
PREFIX p: <http://www.wikidata.org/prop/>
PREFIX ps: <http://www.wikidata.org/prop/statement/>
PREFIX psn: <http://www.wikidata.org/prop/statement/value-normalized/>
PREFIX pq: <http://www.wikidata.org/prop/qualifier/>
PREFIX pqn: <http://www.wikidata.org/prop/qualifier/value-normalized/>
PREFIX rdfs: <http://www.w3.org/2000/01/rdf-schema#>
PREFIX skos: <http://www.w3.org/2004/02/skos/core#>
PREFIX wikibase: <http://wikiba.se/ontology#>
PREFIX uom: <http://qudt.org/vocab/unit/>
`;

async function queryWikidata(sparql, { timeoutMs = 5000, retries = 2 } = {}) {
  let lastErr = null;
  for (let i = 0; i <= retries; i++) {
    const ctrl = new AbortController();
    const id = setTimeout(() => ctrl.abort(), timeoutMs);
    try {
      const url = "https://query.wikidata.org/sparql?format=json&query=" + encodeURIComponent(PREFIX + sparql);
      const resp = await fetch(url, {
        headers: {
          "User-Agent": "CoolGuysBackend/1.2 (contact: example@example.com)",
          "Accept": "application/sparql-results+json"
        },
        signal: ctrl.signal
      });
      clearTimeout(id);
      if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
      const json = await resp.json();
      return json?.results?.bindings ?? null;
    } catch (e) {
      lastErr = e;
      clearTimeout(id);
      await new Promise((r) => setTimeout(r, 250 * (i + 1)));
    }
  }
  return null;
}

/* -------- 候補取得: 男性/女性/総人口(最新)・面積(km²)・都道府県 -------- */
async function fetchCandidates(rawRegion) {
  const prefHint = extractPrefHint(rawRegion);
  const names = expandNames(rawRegion);
  const pat = names.map((n) => n.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")).join("|");

  // 市/特別区/一般区/町/村 など（日本の基礎自治体を広めに）
  const classes = [
    "wd:Q515",      // city
    "wd:Q532",      // special ward of Tokyo
    "wd:Q30335059", // ward of Japan
    "wd:Q1012369",  // town of Japan
    "wd:Q5322507",  // village of Japan
    "wd:Q70208",    // urban municipality of Japan（互換）
    "wd:Q15284"     // municipality
  ].join(" ");

  // 面積は p:/psn:/quantityAmount, quantityUnit で取り、km²へ正規化
  const sparql = `
SELECT ?item ?itemLabel ?prefLabel
       ?male ?female ?total ?maleTime ?femaleTime ?popTime
       ?areaAmount ?areaUnit
WHERE {
  VALUES ?class { ${classes} }
  ?item wdt:P17 wd:Q17 .
  ?item wdt:P31 ?class .

  # 都道府県（上位行政区で日本の都道府県相当）
  OPTIONAL {
    ?item wdt:P131 ?pref .
    ?pref rdfs:label ?prefLabel .
    FILTER(LANG(?prefLabel)="ja")
  }

  # 男性人口（最新候補）
  OPTIONAL {
    ?item p:P1540 ?mStmt .
    ?mStmt ps:P1540 ?male .
    OPTIONAL { ?mStmt pq:P585 ?maleTime }
  }
  # 女性人口（最新候補）
  OPTIONAL {
    ?item p:P1539 ?fStmt .
    ?fStmt ps:P1539 ?female .
    OPTIONAL { ?fStmt pq:P585 ?femaleTime }
  }
  # 総人口（最新候補）
  OPTIONAL {
    ?item p:P1082 ?tStmt .
    ?tStmt ps:P1082 ?total .
    OPTIONAL { ?tStmt pq:P585 ?popTime }
  }

  # 面積：数量と単位を取得（例：平方メートル、平方キロなど）
  OPTIONAL {
    ?item p:P2046 ?aStmt .
    ?aStmt psn:P2046 ?areaNode .
    ?areaNode wikibase:quantityAmount ?areaAmount ;
              wikibase:quantityUnit ?areaUnit .
  }

  # ラベル・別名
  ?item rdfs:label ?itemLabel .
  FILTER (LANG(?itemLabel) = "ja" || LANG(?itemLabel) = "en")
  OPTIONAL { ?item skos:altLabel ?alt . FILTER (LANG(?alt) = "ja") }

  # マッチ条件：完全一致→別名一致→部分一致
  FILTER (
    regex(str(?itemLabel), "^(${pat})$", "i") ||
    regex(str(?alt), "^(${pat})$", "i") ||
    regex(str(?itemLabel), "(${pat})", "i")
  )
}
ORDER BY DESC(?popTime) DESC(?maleTime) DESC(?total)
LIMIT 25
  `;

  const rows = await queryWikidata(sparql);
  if (!rows) return [];

  const norm = normalize(rawRegion);
  const suff = /[区市町村]$/u.test(norm) ? norm.slice(-1) : "";
  const scored = rows.map((r) => {
    const label = r?.itemLabel?.value ?? "";
    const pref = r?.prefLabel?.value ?? "";
    const male = toNum(r?.male?.value);
    const female = toNum(r?.female?.value);
    const total = toNum(r?.total?.value);
    const maleTime = toTime(r?.maleTime?.value);
    const popTime = toTime(r?.popTime?.value);

    // 面積 km² へ正規化（代表的な単位のみ対応：平方メートル/平方キロ）
    let areaKm2 = null;
    const amount = toNum(r?.areaAmount?.value);
    const unitIri = r?.areaUnit?.value || "";
    if (amount != null) {
      // よくある単位
      // QUDT の URI は様々： http://qudt.org/vocab/unit/KiloM2 など
      // 代表的に "KiloM2" を km², "SquareMeter" を m² として扱う
      if (/KiloM2/i.test(unitIri)) {
        areaKm2 = amount; // すでに km²
      } else if (/SquareMeter/i.test(unitIri) || /M2$/i.test(unitIri)) {
        areaKm2 = amount / 1e6; // m² → km²
      } else {
        // わからなければ素直に値を採用（多くは km²）
        areaKm2 = amount;
      }
    }

    // スコアリング
    let s = 0;
    const labelNorm = normalize(label);
    if (labelNorm === norm) s += 1000;               // 完全一致
    if (suff && labelNorm.endsWith(suff)) s += 50;   // 末尾の区市町村が合う
    const prefHint = extractPrefHint(rawRegion);
    if (prefHint && pref && pref.includes(prefHint)) s += 300; // 都道府県ヒント一致
    const mag = (total ?? male ?? 0);
    s += Math.log10(Math.max(1, mag + 1)) * 10;      // 人口規模
    s += (popTime || maleTime)                      // 新しさ
      ? Math.min(50, ((Math.max(popTime, maleTime) - 1262304000000) / (365*24*3600*1000)))
      : 0;

    return {
      score: s,
      label,
      pref,
      male,
      female,
      total,
      areaKm2,
      maleTime,
      popTime
    };
  });

  scored.sort((a, b) => b.score - a.score);
  return scored;
}

/* ------------------------ /estimate ------------------------ */
app.get("/estimate", async (req, res) => {
  try {
    const region = (req.query.region ?? "").toString();
    if (!region) return res.status(400).json({ error: "region required" });

    const minAge = Math.max(0, Math.min(99, parseInt(req.query.minAge ?? "18", 10)));
    const maxAge = Math.max(0, Math.min(99, parseInt(req.query.maxAge ?? "35", 10)));
    const hensachi = req.query.hensachi != null ? Number(req.query.hensachi) : null;

    const key = `est3:${region}|${minAge}-${maxAge}|${hensachi ?? "na"}`;
    const cached = getCache(key);
    if (cached) return res.json(cached);

    const cand = await fetchCandidates(region);
    if (cand.length === 0) {
      const payload = {
        region,
        maleInRange: 0,
        population: { male: 0, total: 0, areaKm2: null },
        model: hensachi != null ? { upperTail: upperTailFromHensachi(hensachi) } : null,
        note: "not-found"
      };
      setCache(key, payload);
      return res.json(payload);
    }

    const top = cand[0];

    // 男性人口の優先順位：male -> total-female -> total*0.50
    let male = top.male ?? ((top.total != null && top.female != null) ? (top.total - top.female) : null);
    if (male == null && top.total != null) male = Math.round(top.total * 0.50);
    male = Math.max(0, Math.round(male ?? 0));

    const share = jpAgeShare(minAge, maxAge);
    let maleInRange = Math.round(male * share);
    if (male > 0 && maleInRange <= 0) maleInRange = 1; // 0 固定を回避

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

    setCache(key, payload);
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

/* ------------------------ /regions（サジェスト） ------------------------ */
app.get("/regions", async (req, res) => {
  try {
    const q = (req.query.q ?? "").toString().trim();
    if (!q) return res.json({ candidates: [] });

    const key = `regions3:${q}`;
    const cached = getCache(key);
    if (cached) return res.json(cached);

    const cands = await fetchCandidates(q);

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
    setCache(key, payload);
    return res.json(payload);
  } catch {
    return res.json({ candidates: [] });
  }
});

/* ------------------------ /healthz ------------------------ */
app.get("/healthz", (_req, res) => res.json({ ok: true }));

app.listen(PORT, () => {
  console.log(`[coolguys-backend] listening on :${PORT}`);
});
