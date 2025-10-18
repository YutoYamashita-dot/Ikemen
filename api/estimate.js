// /api/estimate.js

import fetch from "node-fetch";

export default async function handler(req, res) {
  if (req.method !== "GET") {
    return res.status(405).json({ error: "Method Not Allowed" });
  }

  const { region, minAge, maxAge, hensachi } = req.query;

  if (!region || !minAge || !maxAge || !hensachi) {
    return res.status(400).json({ error: "Missing query parameters" });
  }

  try {
    // ---------------------------
    // 1. 地域ごとの人口データ（仮: 手動辞書 or 簡易APIで将来拡張可）
    // ---------------------------
    // 単位：男性18歳以上の総人口（概算）
    const basePopulationMap = {
      "品川区": 210000,
      "渋谷区": 160000,
      "新宿区": 180000,
      "港区": 150000,
      "中央区": 130000,
      "千代田区": 80000,
      "横浜市": 1600000,
      "大阪市": 1200000,
    };

    const totalMale18Plus = basePopulationMap[region] || 300000;

    // ---------------------------
    // 2. 年齢レンジを反映
    // ---------------------------
    const min = Math.max(parseInt(minAge), 18);
    const max = Math.min(parseInt(maxAge), 99);
    const totalSpan = 82; // 18〜99歳
    const selectedSpan = max >= min ? max - min + 1 : 0;
    const maleInRange = Math.ceil(totalMale18Plus * (selectedSpan / totalSpan));

    // ---------------------------
    // 3. 偏差値から上位割合を計算
    // ---------------------------
    const z = (hensachi - 50.0) / 10.0;
    const upperTail = 1 - stdNormCdf(z);

    // ---------------------------
    // 4. 地域全体の「イケメン人数」計算
    // ---------------------------
    const estimatedIkemen = Math.ceil(maleInRange * upperTail);

    return res.status(200).json({
      region,
      minAge: min,
      maxAge: max,
      population: {
        male18Plus: totalMale18Plus,
        maleInRange: maleInRange,
      },
      model: {
        upperTail: upperTail,
      },
      estimatedCoolGuys: estimatedIkemen,
    });
  } catch (e) {
    console.error(e);
    return res.status(500).json({ error: "Server error", message: e.message });
  }
}

// ------------------------
// 標準正規分布CDF（近似）
// ------------------------
function stdNormCdf(x) {
  const t = 1.0 / (1.0 + 0.2316419 * Math.abs(x));
  const d = 0.3989422804014327 * Math.exp(-(x * x) / 2.0);
  let p =
    d *
    (((((1.330274429 * t - 1.821255978) * t + 1.781477937) * t -
      0.356563782) *
      t +
      0.31938153) *
      t);
  p = 1.0 - p;
  return x >= 0 ? p : 1.0 - p;
}