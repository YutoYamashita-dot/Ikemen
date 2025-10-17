// /api/region/candidates
export default function handler(req, res) {
  // --- CORS ---
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "GET,OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type, Authorization, x-vercel-protection-bypass");
  if (req.method === "OPTIONS") return res.status(204).end();

  if (req.method !== "GET") {
    return res.status(405).json({ error: "Method Not Allowed" });
  }

  const kw = (req.query.kw || "").toString().trim();
  if (!kw) {
    return res.status(200).json({ candidates: [] });
  }

  // 超簡易ダミーデータ（必要なら増やしてください）
  const ALL = [
    "品川区", "渋谷区", "新宿区", "港区", "目黒区",
    "札幌市", "仙台市", "さいたま市", "横浜市", "名古屋市",
    "京都市", "大阪市", "神戸市", "福岡市", "那覇市"
  ];

  const list = ALL
    .filter((n) => n.includes(kw))
    .slice(0, 10)
    .map((n) => ({ regionName: n, areaCode: "DUMMY" }));

  return res.status(200).json({ candidates: list });
}
