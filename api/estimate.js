// /api/estimate.js
export default function handler(req, res) {
  // CORS（ブラウザ/アプリ両対応）
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');
  if (req.method === 'OPTIONS') return res.status(204).end();

  if (req.method !== 'GET') {
    res.setHeader('Allow', 'GET, OPTIONS');
    return res.status(405).json({ error: 'Method Not Allowed' });
  }

  const { region, minAge, maxAge, hensachi } = req.query;
  if (!region || !minAge || !maxAge || !hensachi) {
    return res.status(400).json({ error: 'Missing query params' });
  }

  // ダミー推定ロジック（固定の適当な値）
  const male = 100000;                 // e-Stat 代替のダミー
  const upperTail = 0.02;              // 2%
  const estimate = Math.ceil(male * upperTail);

  return res.status(200).json({
    input: { region, minAge: +minAge, maxAge: +maxAge, hensachi: +hensachi },
    population: { male },
    model: { upperTail },
    estimate
  });
}
