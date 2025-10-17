// /api/estimate
export default function handler(req, res) {
  // --- CORS ---
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "GET,OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type, Authorization, x-vercel-protection-bypass");
  if (req.method === "OPTIONS") return res.status(204).end();

  if (req.method !== "GET") {
    return res.status(405).json({ error: "Method Not Allowed" });
  }

  const region = (req.query.region || "").toString();
  const minAge = Number(req.query.minAge);
  const maxAge = Number(req.query.maxAge);
  const hensachi = Number(req.query.hensachi);

  if (!region || Number.isNaN(minAge) || Number.isNaN(maxAge) || Number.isNaN(hensachi)) {
    return res.status(400).json({ error: "Bad Request: invalid query params" });
  }

  // --- 簡易モデル（エンタメ用のダミー推定） ---
  // 18–35歳男性人口のテキトーな地域別係数
  const baseMaleByRegion = (() => {
    if (region.includes("区")) return 180000;
    if (region.includes("市")) return 120000;
    if (region.includes("町") || region.includes("村")) return 40000;
    return 80000;
  })();

  // 年齢レンジ係数（18–35を100%として単純スケール）
  const ageSpan = Math.max(0, maxAge - minAge);
  const ageFactor = Math.min(1, Math.max(0, ageSpan / (35 - 18)));

  const male = Math.round(baseMaleByRegion * ageFactor);

  // 顔面偏差値の上位割合の超ラフ近似（65で約上位16%くらいに見せる）
  const upperTail = (() => {
    // 60～75 を対象。60→0.3、65→0.16、70→0.07、75→0.03 くらいで線形補間
    const clamp = (x, a, b) => Math.max(a, Math.min(b, x));
    const h = clamp(hensachi, 60, 75);
    const p60 = 0.30, p65 = 0.16, p70 = 0.07, p75 = 0.03;
    if (h <= 65) {
      // 60→65 区間
      const t = (h - 60) / 5;
      return p60 + (p65 - p60) * t;
    } else if (h <= 70) {
      // 65→70 区間
      const t = (h - 65) / 5;
      return p65 + (p70 - p65) * t;
    } else {
      // 70→75 区間
      const t = (h - 70) / 5;
      return p70 + (p75 - p70) * t;
    }
  })();

  const estimate = Math.max(0, Math.round(male * upperTail));

  return res.status(200).json({
    estimate,
    population: { male },
    model: { upperTail },
    input: { areaCode: "DUMMY" }
  });
}
