export default async function handler(req, res) {
  // CORS（必要ならオリジン絞ってね）
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "GET,OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");
  if (req.method === "OPTIONS") return res.status(204).end();

  const q = (req.query.keyword || "").toString();
  const samples = ["品川区", "渋谷区", "港区", "札幌市", "横浜市", "大阪市", "名古屋市"];
  const list = samples.filter(s => s.includes(q)).map(s => ({ regionName: s }));
  res.status(200).json({ candidates: list });
}