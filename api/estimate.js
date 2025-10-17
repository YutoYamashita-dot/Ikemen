export default async function handler(req, res) {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "POST,OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");
  if (req.method === "OPTIONS") return res.status(204).end();
  if (req.method !== "POST") return res.status(405).json({ error: "Method Not Allowed" });

  try {
    const { region, minAge, maxAge, hensachi } = req.body || {};
    const male = 120000; // ダミー人口（本番はサーバ側でe-Statなどから取得）
    const h = Number(hensachi ?? 65);
    const upperTail = Math.max(0, Math.min(1, (80 - h) / 100)); // 超ラフなダミー
    const estimate = Math.round(male * upperTail);

    res.status(200).json({
      input: { areaCode: "DUMMY", region, minAge, maxAge, hensachi: h },
      population: { male },
      model: { upperTail },
      estimate
    });
  } catch (e) {
    res.status(500).json({ error: String(e) });
  }
}