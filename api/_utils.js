// /api/_utils.js

// 正規分布 N(mu, sigma) の上側確率（1 - CDF）
export function normalUpperTail(x, mu = 50, sigma = 10) {
  const z = (Number(x) - mu) / sigma;
  // Abramowitz & Stegun 7.1.26 に基づく近似
  const t = 1 / (1 + 0.2316419 * Math.abs(z));
  const d = Math.exp(-0.5 * z * z) / Math.sqrt(2 * Math.PI);
  const poly = ((((1.330274429 * t - 1.821255978) * t + 1.781477937) * t - 0.356563782) * t + 0.319381530) * t;
  const cdf = z >= 0 ? 1 - d * poly : d * poly;
  return 1 - cdf;
}

// 年齢階級ビン [{from,to,count}] から [minAge,maxAge] へ按分合計
export function sumMaleByAgeRange(pop, minAge, maxAge) {
  const bins = Array.isArray(pop.age_male) ? pop.age_male : [];
  let total = 0;
  const detail = [];

  for (const b of bins) {
    const a = Number(b.from), z = Number(b.to), c = Number(b.count);
    if (!isFinite(a) || !isFinite(z) || !isFinite(c) || z <= a) continue;

    const left = Math.max(a, minAge);
    const right = Math.min(z, maxAge + 1); // 上端含めるため +1 扱い
    const overlap = Math.max(0, right - left);

    if (overlap > 0) {
      const width = z - a;
      const portion = overlap / width;
      const add = c * portion;
      total += add;
      detail.push({ from: a, to: z, overlap, portion, add });
    }
  }
  return { total, detail };
}

// “15～19歳”/“20〜24歳”/“85歳以上”などから {from,to} を推定
export function parseAgeRangeFromName(name) {
  const s = String(name || "");
  const m2 = s.match(/(\d+)\D+(\d+)\D*歳/);          // 15～19歳
  if (m2) return { from: Number(m2[1]), to: Number(m2[2]) + 1 };
  const m1 = s.match(/(\d+)\D*歳以上/);             // 85歳以上
  if (m1) return { from: Number(m1[1]), to: Number(m1[1]) + 100 }; // 上限は適当に大きく
  const m0 = s.match(/(\d+)\D*歳/);                 // 単一（まれ）
  if (m0) return { from: Number(m0[1]), to: Number(m0[1]) + 1 };
  return null;
}