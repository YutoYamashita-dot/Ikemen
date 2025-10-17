// /api/estimate.js
import { normalUpperTail, sumMaleByAgeRange, parseAgeRangeFromName } from "./_utils.js";

/**
 * クエリ仕様（例）
 *   /api/estimate?region=品川区&minAge=18&maxAge=35&hensachi=65
 *   &ageKey=cat01&sexKey=cat02&areaKey=area&maleCode=1&cdTime=2020000000
 *
 * 必須:
 *   region (または areaCode), minAge, maxAge, hensachi
 *   環境変数 ESTAT_APP_ID, ESTAT_STATS_DATA_ID
 * オプション（表に合わせて指定）:
 *   ageKey : 年齢クラスID（例 cat01 など）。未指定時は cat01 を試行。
 *   sexKey : 性別クラスID（例 cat02 など）。未指定時は cat02 を試行。
 *   areaKey: 地域クラスID（通常 area ）。未指定時は area。
 *   maleCode: 男性を表すコード（通常 "1"）。未指定時は "1"。
 *   そのほか cdTime 等の cd* はそのまま e-Stat に透過転送。
 *
 * 地域名→コード変換:
 *   環境変数 ESTAT_REGION_MAP_JSON に {"品川区":"13109",...} を入れるか、
 *   直接 areaCode=13109 をクエリで渡してください。
 */

function getEnvJson(name, fallback = "{}") {
  try { return JSON.parse(process.env[name] ?? fallback); } catch { return JSON.parse(fallback); }
}

function regionToCode(regionName, explicitAreaCode) {
  if (explicitAreaCode) return String(explicitAreaCode);
  const map = getEnvJson("ESTAT_REGION_MAP_JSON");
  return map[regionName] ? String(map[regionName]) : null;
}

function buildProxyUrl(statsDataId, params) {
  const base = process.env.VERCEL_URL ? `https://${process.env.VERCEL_URL}` : "";
  const url = new URL("/api/estat/proxy", base);
  url.searchParams.set("path", "/rest/3.0/app/json/getStatsData");
  url.searchParams.set("statsDataId", statsDataId);
  Object.entries(params).forEach(([k, v]) => {
    if (v != null) url.searchParams.set(k, String(v));
  });
  return url.toString();
}

function indexClassInfoById(json) {
  const out = {};
  const classObj = json?.STATISTICAL_DATA?.CLASS_INF?.CLASS_OBJ;
  if (!classObj) return out;
  const list = Array.isArray(classObj) ? classObj : [classObj];
  for (const c of list) {
    const id = c?.["@id"];
    const cls = c?.CLASS;
    if (!id || !cls) continue;
    const items = Array.isArray(cls) ? cls : [cls];
    out[id] = items.map(x => ({
      code: x?.["@code"],
      name: x?.["@name"],
    }));
  }
  return out;
}

function valuesArray(json) {
  const v = json?.STATISTICAL_DATA?.DATA_INF?.VALUE;
  if (!v) return [];
  return Array.isArray(v) ? v : [v];
}

function pickAgeKeyAvailable(vs, candidates) {
  for (const key of candidates) {
    if (vs.some(v => v?.[`@${key}`] != null)) return key;
  }
  return null;
}

export default async function handler(req, res) {
  if (req.method !== "GET") {
    res.setHeader("Allow", "GET"); return res.status(405).json({ error: "Method Not Allowed" });
  }

  const { region, areaCode: areaCodeQ, minAge, maxAge, hensachi } = req.query;
  const min = Number(minAge), max = Number(maxAge), h = Number(hensachi);

  if ((!region && !areaCodeQ) || !isFinite(min) || !isFinite(max) || !isFinite(h)) {
    return res.status(400).json({ error: "Missing or invalid params: region|areaCode, minAge, maxAge, hensachi" });
  }
  const statsDataId = process.env.ESTAT_STATS_DATA_ID;
  const appId = process.env.ESTAT_APP_ID; // proxy 側チェック用
  if (!statsDataId || !appId) {
    return res.status(503).json({ error: "ESTAT_APP_ID / ESTAT_STATS_DATA_ID are not set" });
  }

  // キー名（未指定なら一般的な既定）
  const ageKey = String(req.query.ageKey || "cat01");
  const sexKey = String(req.query.sexKey || "cat02");
  const areaKey = String(req.query.areaKey || "area");
  const maleCode = String(req.query.maleCode || "1");

  // 地域コード解決
  const areaCode = regionToCode(region, req.query.areaCode);
  if (!areaCode) {
    return res.status(400).json({ error: `Area code not found. Provide areaCode=... or set ESTAT_REGION_MAP_JSON for "${region}"` });
  }

  // e-Stat へ透過する cd* パラメータ（cdTime など）
  const passCd = {};
  for (const [k, v] of Object.entries(req.query)) {
    if (/^cd[A-Z0-9_]+$/i.test(k)) passCd[k] = v;
  }

  // 1) 取得
  const url = buildProxyUrl(statsDataId, { ...passCd, [areaKey]: areaCode });
  let json;
  try {
    const r = await fetch(url, { cache: "no-store" });
    if (!r.ok) throw new Error(`e-Stat ${r.status}`);
    json = await r.json();
  } catch (e) {
    return res.status(502).json({ error: "Failed to fetch e-Stat", detail: String(e), upstream: url });
  }

  // 2) クラス情報
  const classIndex = indexClassInfoById(json);

  // 3) レコード群
  const vs = valuesArray(json);
  if (vs.length === 0) return res.status(404).json({ error: "No VALUE records from e-Stat", upstream: url });

  // ageKey がレコードに存在しない場合、自動推測（cat01, cat02, cat03…などから）
  const ageKeyFinal = vs.some(v => v?.[`@${ageKey}`] != null)
    ? ageKey
    : (pickAgeKeyAvailable(vs, ["cat01", "cat02", "cat03", "age"]) || ageKey);

  // 4) 男性だけ抽出し、年齢ビンへ
  const bins = [];
  for (const v of vs) {
    const sex = v?.[`@${sexKey}`];
    const ageCode = v?.[`@${ageKeyFinal}`];
    const area = v?.[`@${areaKey}`];
    const val = Number(v?.["$"]);

    if (sex !== maleCode) continue;
    if (area !== areaCode) continue;
    if (!isFinite(val)) continue;
    if (!ageCode) continue;

    // クラス表から年齢ラベルを取り、from/to を解釈
    const cls = classIndex[ageKeyFinal] || [];
    const ageItem = cls.find(x => x.code === ageCode);
    const range = parseAgeRangeFromName(ageItem?.name);
    if (!range) continue; // “総数”などは飛ばす

    bins.push({ from: range.from, to: range.to, count: val });
  }

  if (bins.length === 0) {
    return res.status(404).json({
      error: "No male age bins found. Check ageKey/sexKey/maleCode/areaKey or cdTime.",
      hint: { ageKeyTried: ageKeyFinal, sexKey, areaKey, maleCode },
      upstream: url
    });
  }

  // 5) 18–35 等へ按分サマリ → 正規上側確率
  const { total: maleInRange, detail } = sumMaleByAgeRange({ age_male: bins }, min, max);
  const upper = normalUpperTail(h, 50, 10);
  const estimate = Math.ceil(maleInRange * upper);

  return res.status(200).json({
    input: {
      region: region ?? null,
      areaCode,
      minAge: min, maxAge: max, hensachi: h,
      keys: { ageKey: ageKeyFinal, sexKey, areaKey, maleCode },
      cd: passCd
    },
    population: { male: Math.round(maleInRange) },
    model: { distribution: "Normal(50,10)", upperTail: upper },
    estimate,
    apportioned: detail,
    updatedAt: new Date().toISOString()
  });
}