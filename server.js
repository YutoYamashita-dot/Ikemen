import express from "express";
import cors from "cors";

/** ===============================
 * 基本設定
 * =============================== */
const app = express();
const PORT = process.env.PORT || 3000;
app.use(cors({ origin: true }));
app.use(express.json());

/** ===============================
 * メモリキャッシュ (地域×年齢レンジ単位)
 * =============================== */
const cache = new Map(); // key -> { data, at }
const TTL_MS = 6 * 60 * 60 * 1000; // 6 hours

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

/** ===============================
 * 共通ユーティリティ
 * =============================== */
const normalizeRegion = (s) =>
  (s || "")
    .replace(/\s+/g, "")
    .replace(/[（）()[\]【】]/g, "")
    .trim();

const expandCandidates = (norm) => {
  const bare = norm.replace(/(区|市|町|村)$/u, "");
  const list = [norm, bare, bare + "区", bare + "市", bare + "町", bare + "村"].filter(Boolean);
  return Array.from(new Set(list));
};

const toNumber = (v) => {
  if (v == null) return null;
  const s = String(v).replace(/[^0-9.eE+-]/g, "");
  if (!s) return null;
  const n = Number(s);
  return Number.isFinite(n) ? n : null;
};

// 日本の年齢構成ざっくり3区分でレンジ比率を出す（0–14, 15–64, 65–99）
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
    if (R >= L) {
      total += share * ((R - L + 1) / (b1 - b0 + 1));
    }
  }
  return Math.max(0, Math.min(1, total));
}

// 正規 CDF 近似 → 上位割合（偏差値→上位確率）
function stdNormCdf(x) {
  const t = 1 / (1 + 0.2316419 * Math.abs(x));
  const d = 0.3989422804014327 * Math.exp(-(x * x) / 2);
  let p = d * (((((1.330274429 * t) - 1.821255978) * t + 1.781477937) * t - 0.356563782) * t + 0.31938153) * t;
  p = 1 - p;
  return x >= 0 ? p : 1 - p;
}
const upperTailFromHensachi = (h) => 1 - stdNormCdf((h - 50) / 10);

/** ===============================
 * Wikidata クエリ（fetch + リトライ/タイムアウト）
 * =============================== */
async function queryWikidata(sparql, { timeoutMs = 3000, retries = 2 } = {}) {
  let lastErr = null;
  for (let i = 0; i <= retries; i++) {
    const ctrl = new AbortController();
    const id = setTimeout(() => ctrl.abort(), timeoutMs);
    try {
      const url = "https://query.wikidata.org/sparql?format=json&query=" + encodeURIComponent(sparql);
      const resp = await fetch(url, {
        method: "GET",
        headers: {
          "User-Agent": "CoolGuysBackend/1.1 (contact: example@example.com)",
          "Accept": "application/sparql-results+json",
        },
        signal: ctrl.signal,
      });
      clearTimeout(id);
      if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
      const json = await resp.json();
      return json?.results?.bindings ?? null;
    } catch (e) {
      lastErr = e;
      clearTimeout(id);
      await new Promise((r) => setTimeout(r, 200 * (i + 1))); // 短いバックオフ
    }
  }
  return null;
}

/** ===============================
 * Wikidata から 男性人口(P1540) / 総人口(P1082) / 女性人口(P1539) / 面積(P2046) を取得
 *   - 候補名: 厳密一致 → あいまい一致の二段階
 *   - 男性が無ければ total-female、さらに無ければ total*0.50 を採用
 * =============================== */
async function fetchMaleTotalAreaFromWikidata(candidates) {
  const makeFilter = (pat, exact) =>
    exact ? `FILTER( regex(str(?itemLabel), "^${pat}$", "i") )` : `FILTER( regex(str(?itemLabel), "${pat}", "i") )`;

  async function tryOnce(exact) {
    const filter = makeFilter(candidates.join("|"), exact);
    const sparql = `
SELECT ?item ?itemLabel ?male ?female ?total ?area WHERE {
  ?item wdt:P17 wd:Q17 .                           # 日本
  OPTIONAL { ?item p:P1540 ?m . ?m ps:P1540 ?male . }   # 男性人口
  OPTIONAL { ?item p:P1539 ?f . ?f ps:P1539 ?female . } # 女性人口
  OPTIONAL { ?item p:P1082 ?t . ?t ps:P1082 ?total . }  # 総人口
  OPTIONAL { ?item wdt:P2046 ?area }                    # 面積(km2)
  SERVICE wikibase:label { bd:serviceParam wikibase:language "ja,en". }
  ${filter}
}
ORDER BY DESC(?male) DESC(?total)
LIMIT 1`;
    const rows = await queryWikidata(sparql, { timeoutMs: 3500, retries: 2 });
    if (!rows || rows.length === 0) return null;
    const b = rows[0];

    const male = toNumber(b?.male?.value);
    const female = toNumber(b?.female?.value);
    const total = toNumber(b?.total?.value);
    const areaKm2 = toNumber(b?.area?.value);

    let maleFinal = male ?? (total != null && female != null ? total - female : null);
    if (maleFinal == null && total != null) maleFinal = Math.round(total * 0.50);

    return {
      male: maleFinal != null && maleFinal > 0 ? Math.round(maleFinal) : null,
      total: total != null && total > 0 ? Math.round(total) : null,
      areaKm2: areaKm2 != null && areaKm2 > 0 ? areaKm2 : null,
    };
  }

  const exact = await tryOnce(true);
  if (exact) return exact;
  return await tryOnce(false);
}

/** ===============================
 * /estimate エンドポイント
 * 例: /estimate?region=渋谷区&minAge=18&maxAge=35&hensachi=65
 * 返却: { maleInRange, population:{male,total,areaKm2}, model:{upperTail} }
 * =============================== */
app.get("/estimate", async (req, res) => {
  try {
    const region = (req.query.region ?? "").toString();
    if (!region) return res.status(400).json({ error: "region required" });
    const minAge = Math.max(0, parseInt(req.query.minAge ?? "18", 10));
    const maxAge = Math.min(99, parseInt(req.query.maxAge ?? "35", 10));
    const hensachi = req.query.hensachi != null ? Number(req.query.hensachi) : null;

    // キャッシュ
    const key = `est:${region}|${minAge}-${maxAge}`;
    const cached = getCache(key);
    if (cached) return res.json(cached);

    // 地域名の候補作成
    const norm = normalizeRegion(region);
    const cands = expandCandidates(norm);

    // Wikidata から取得
    const stats = await fetchMaleTotalAreaFromWikidata(cands);

    // 男性総数
    let male = stats?.male ?? (stats?.total ? Math.round(stats.total * 0.50) : 0);
    male = Math.max(0, male);

    // 年齢レンジで配分（ここが上2行の「地域×年齢レンジ人口」のベース）
    let maleInRange = Math.round(male * jpAgeShare(minAge, maxAge));
    if (maleInRange <= 0 && male > 0) maleInRange = 1; // 0固定を避ける

    // 偏差値→上位割合（モデルパラメータとして返す）
    const upperTail = hensachi != null ? upperTailFromHensachi(hensachi) : null;

    const payload = {
      region,
      maleInRange,
      population: {
        male,
        total: stats?.total ?? 0,
        areaKm2: stats?.areaKm2 ?? null
      },
      model: upperTail != null ? { upperTail } : null
    };

    setCache(key, payload);
    return res.json(payload);
  } catch (e) {
    // 失敗時も形は崩さずに返す（フロント側フォールバックを許容）
    return res.json({
      region: req.query.region ?? "",
      maleInRange: 0,
      population: { male: 0, total: 0, areaKm2: null },
      model: null,
      error: "backend-fallback"
    });
  }
});

/** ===============================
 * /regions（サジェスト）
 * 例: /regions?q=渋谷
 * =============================== */
app.get("/regions", async (req, res) => {
  try {
    const q = (req.query.q ?? "").toString().trim();
    if (!q) return res.json({ candidates: [] });

    // 「渋谷」「渋谷区」「渋谷市」などをまとめて拾う
    const norm = normalizeRegion(q);
    const bare = norm.replace(/(区|市|町|村)$/u, "");
    const pats = Array.from(new Set([norm, bare, `${bare}(区|市|町|村)`]))
      .filter(Boolean)
      .join("|");

    const sparql = `
SELECT DISTINCT ?item ?itemLabel WHERE {
  ?item wdt:P17 wd:Q17 .
  ?item rdfs:label ?itemLabel .
  FILTER (lang(?itemLabel) = "ja" || lang(?itemLabel) = "en")
  FILTER (regex(str(?itemLabel), "${pats}", "i"))
}
LIMIT 20`;

    const key = `reg:${q}`;
    const cached = getCache(key);
    if (cached) return res.json(cached);

    const rows = await queryWikidata(sparql, { timeoutMs: 2500, retries: 1 });
    const names = (rows || []).map(r => r?.itemLabel?.value).filter(Boolean);

    const payload = { candidates: names.map(n => ({ regionName: n })) };
    setCache(key, payload);
    return res.json(payload);
  } catch {
    return res.json({ candidates: [] });
  }
});

/** ===============================
 * Health
 * =============================== */
app.get("/healthz", (_req, res) => res.json({ ok: true }));

app.listen(PORT, () => {
  console.log(`[coolguys-backend] listening on :${PORT}`);
});