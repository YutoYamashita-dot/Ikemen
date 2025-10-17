// /api/region/candidates.js
export default function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');
  if (req.method === 'OPTIONS') return res.status(204).end();

  if (req.method !== 'GET') {
    res.setHeader('Allow', 'GET, OPTIONS');
    return res.status(405).json({ error: 'Method Not Allowed' });
  }

  const kw = (req.query.kw || '').toString();
  const all = ['品川区','渋谷区','港区','札幌市','新宿区','世田谷区'];
  const list = all.filter(n => n.includes(kw));
  return res.status(200).json({
    candidates: list.map(n => ({ regionName: n }))
  });
}
