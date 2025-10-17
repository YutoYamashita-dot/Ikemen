import { VercelRequest, VercelResponse } from '@vercel/node';

export default function handler(req: VercelRequest, res: VercelResponse) {
  const kw = (req.query.kw as string) ?? '';
  // ダミー候補（まずは 200 を返す目的）
  const ALL = [
    { regionName: '渋谷区' },
    { regionName: '港区' },
    { regionName: '品川区' },
    { regionName: '札幌市' },
  ];
  const candidates = kw ? ALL.filter(x => x.regionName.includes(kw)) : ALL;
  res.status(200).json({ candidates });
}