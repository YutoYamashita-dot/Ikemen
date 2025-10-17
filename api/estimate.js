// api/estimate.js

export default async function handler(req, res) {
  const { region, minAge, maxAge, hensachi } = req.query;

  if (!region) {
    return res.status(400).json({ error: "region is required" });
  }

  // ====== ① Wikidataへ人口を問い合わせるSPARQLクエリ ======
  const sparql = `
    SELECT ?item ?itemLabel ?population ?time WHERE {
      ?item rdfs:label "${region}"@ja.
      ?item wdt:P1082 ?population.
      OPTIONAL { ?item p:P1082 ?popStatement. ?popStatement pq:P585 ?time. }
    }
    ORDER BY DESC(?time)
    LIMIT 1
  `;

  try {
    // ====== ② SPARQL APIリクエスト ======
    const url = "https://query.wikidata.org/sparql?query=" + encodeURIComponent(sparql);
    const response = await fetch(url, {
      headers: {
        "Accept": "application/sparql-results+json",
        "User-Agent": "CoolGuysApp/1.0 (https://yourapp.example.com)"
      }
    });

    if (!response.ok) {
      throw new Error(`Wikidata API error: ${response.status}`);
    }

    const data = await response.json();
    const bindings = data.results.bindings;

    if (bindings.length === 0) {
      return res.status(404).json({ error: "Population data not found for this region" });
    }

    // ====== ③ 人口データ抽出 ======
    const population = parseInt(bindings[0].population.value, 10);

    // ====== ④ イケメン人数の推定 ======
    // ※ここは自由に調整可能（例としてシンプルな式を使用）
    const ageFactor = (maxAge - minAge) / 100;
    const hensachiFactor = hensachi / 100;
    const estimatedCoolGuys = Math.floor(population * ageFactor * hensachiFactor * 0.15);

    // ====== ⑤ JSONレスポンス ======
    return res.status(200).json({
  region,
  population: { value: population }, // ← ★ここをオブジェクトに
  estimatedCoolGuys,
  note: "人口データはWikidataから自動取得しています"
});
  } catch (error) {
    console.error("Error fetching population:", error);
    return res.status(500).json({ error: "Failed to fetch population data" });
  }
}