// api/estimate.ts
import type { VercelRequest, VercelResponse } from '@vercel/node';

export default function handler(req: VercelRequest, res: VercelResponse) {
  // CORS（必要なら調整）
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET,POST,OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') return res.status(200).end();

  const region = (req.query.region as string) ?? '不明';
  const minAge = Number(req.query.minAge ?? 18);
  const maxAge = Number(req.query.maxAge ?? 35);
  const hensachi = Number(req.query.hensachi ?? 65);

  // ダミー計算
  const male = 123456;
  const upperTail = Math.max(0, Math.min(1, (75 - hensachi) / 25));
  const estimate = Math.round(male * upperTail);
  const areaCode = '000000';

  res.status(200).json({
    population: { male },
    model: { upperTail },
    estimate,
    input: { areaCode, region, minAge, maxAge, hensachi },
    error: null,
  });
}