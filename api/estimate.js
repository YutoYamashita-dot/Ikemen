// routes/estimate.js
app.get("/estimate", async (req, res) => {
  const { region, minAge, maxAge, hensachi } = req.query;
  if (!region) return res.status(400).json({ error: "region required" });

  const min = Math.max(0, parseInt(minAge ?? "18", 10));
  const max = Math.min(99, parseInt(maxAge ?? "35", 10));
  const years = Math.max(1, max - min + 1);

  // 1) 地域名正規化＆候補生成
  const norm = normalizeRegion(region);
  const cand = expandCandidates(norm);

  // 2) Wikidata から 男性人口/総人口/女性/面積 を取得（最初にヒットしたもの）
  const stats = await fetchMaleTotalAreaFromWikidata(cand); // { male, total, female, areaKm2 }

  // 3) 男性総数の決定
  let male = stats.male ?? (stats.total && stats.female ? stats.total - stats.female : null);
  if (!male && stats.total) male = Math.round(stats.total * 0.50); // 最低限

  // 4) 年齢レンジ分配（サーバ側でやる）
  const share = jpAgeShare(min, max); // 0..1
  const maleInRange = Math.max(1, Math.round((male ?? 0) * share));

  // 5) 偏差値→上位割合（任意：サーバが提供するなら）
  const upperTail = hensachi ? upperTailFromHensachi(parseFloat(hensachi)) : null;

  // 6) 返却（0を返さない。最低1を担保）
  return res.json({
    region: region,
    maleInRange,
    population: {
      male: male ?? 0,
      total: stats.total ?? 0,
      areaKm2: stats.areaKm2 ?? null
    },
    model: upperTail ? { upperTail } : null
  });
});