// /api/population.js
export default async function handler(req, res) {
  try {
    const { name } = req.query; // 例: "品川区", "札幌市", "渋谷区"
    if (!name || typeof name !== "string") {
      return res.status(400).json({ error: "name (自治体名) を指定してください" });
    }

    // SPARQL: 日本語ラベルが一致するアイテムで人口(P1082)の最新値を取得
    // 可能な限り最新時点 (P585) 付きの数値を優先 → なければ単純な人口値を拾う
    const sparql = `
SELECT ?item ?itemLabel ?pop ?pointInTime WHERE {
  ?item rdfs:label "${name}"@ja .
  ?item wdt:P31 ?cls .
  FILTER(?cls IN (wd:Q484170, wd:Q149621, wd:Q10864048, wd:Q515, wd:Q70208))
  OPTIONAL {
    ?item p:P1082 ?popStmt .
    ?popStmt ps:P1082 ?pop .
    OPTIONAL { ?popStmt pq:P585 ?pointInTime . }
  }
}
ORDER BY DESC(?pointInTime)
LIMIT 1
    `.trim();

    const url = "https://query.wikidata.org/sparql";
    const r = await fetch(`${url}?query=${encodeURIComponent(sparql)}`, {
      headers: {
        "Accept": "application/sparql-results+json",
        // WG要件に沿って UA を明示（任意の文字列でOK、連絡先URLを付けるのが望ましい）
        "User-Agent": "ikemen-app/1.0 (https://example.com/contact)"
      },
      // Vercel のデフォルトタイムアウト対策（ゆるめ）
      cache: "no-store"
    });

    if (!r.ok) {
      return res.status(r.status).json({ error: `Wikidata SPARQL error ${r.status}` });
    }
    const data = await r.json();
    const rows = data?.results?.bindings ?? [];

    if (rows.length === 0 || !rows[0].pop) {
      return res.status(404).json({ error: `人口が見つかりません: ${name}` });
    }

    const row = rows[0];
    const population = Number(row.pop.value); // 総人口（人）
    const pointInTime = row.pointInTime?.value ?? null; // 例: 2020-10-01T00:00:00Z

    return res.status(200).json({
      name,
      population,
      pointInTime,
      source: "Wikidata (P1082)"
    });
  } catch (e) {
    return res.status(500).json({ error: String(e?.message ?? e) });
  }
}