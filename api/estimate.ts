// Vercel Serverless Function (Node.js)
// これを /api/estimate にデプロイします。
// AndroidアプリからのHTTPクライアントはCORS対象外ですが、ブラウザ検証もしやすいようにCORSヘッダも付けています。

import type { VercelRequest, VercelResponse } from '@vercel/node';

export default function handler(req: VercelRequest, res: VercelResponse) {
  // CORS (ブラウザ確認用)
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET,POST,OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') return res.status(200).end();

  try {
    // クエリ受け取り（AndroidのRetrofitからGET/POST どちらでもOK）
    const region = (req.query.region as string) ?? '不明';
    const minAge = Number(req.query.minAge ?? 18);
    const maxAge = Number(req.query.maxAge ?? 35);
    const hensachi = Number(req.query.hensachi ?? 65);

    // --- ダミー計算（まず通ることが最優先） ---
    // 実際はe-Stat等から取得して計算してください。
    const male = 123456;                       // 地域の男性人口（18–35）ダミー
    const upperTail = Math.max(0, Math.min(1, (75 - hensachi) / 25)); // 適当な上位割合のダミー
    const estimate = Math.round(male * upperTail);
    const areaCode = '000000';                 // ダミー地域コード

    // アプリの期待に合わせたJSON形（これまでやり取りした構造）
    return res.status(200).json({
      population: { male },
      model: { upperTail },
      estimate,
      input: { areaCode, region, minAge, maxAge, hensachi },
      error: null
    });
  } catch (e: any) {
    return res.status(500).json({
      error: e?.message ?? 'unknown error'
    });
  }
}