// /api/region/candidates.js
export default async function handler(req, res) {
  // CORS（アプリから直接叩けるように許可）
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "GET, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");
  if (req.method === "OPTIONS") return res.status(200).end();

  if (req.method !== "GET") {
    return res.status(405).json({ error: "Method Not Allowed" });
  }

  const kw = (req.query.kw || "").toString().trim();
  if (!kw) {
    return res.status(200).json({ candidates: [] });
  }

  // 日本の都道府県/市区町村など（行政区画）を対象に、日本語ラベルでヒット
  const sparql = `
    SELECT DISTINCT ?item ?itemLabel WHERE {
      ?item rdfs:label ?itemLabel .
      FILTER(LANG(?itemLabel) = "ja") .
      FILTER(CONTAINS(?itemLabel, "${kw}")) .
      ?item wdt:P17 wd:Q17 .                # Japan
      ?item wdt:P31/wdt:P279* ?class .
      VALUES ?class {
        wd:Q515      # city
        wd:Q747074   # ward (special ward)
        wd:Q3032114  # designated city
        wd:Q7016327  # core city
        wd:Q721657   # town
        wd:Q484170   # village
        wd:Q13218630 # municipality
        wd:Q1084     # prefecture
      }
    }
    LIMIT 30
  `;

  try {
    const r = await fetch(
      `https://query.wikidata.org/sparql?query=${encodeURIComponent(sparql)}`,
      { headers: { Accept: "application/sparql-results+json" } }
    );
    if (!r.ok) {
      return res.status(502).json({ error: "Wikidata query failed", status: r.status });
    }
    const data = await r.json();
    const rows = data?.results?.bindings || [];

    const candidates = rows.map((row) => {
      const label = row.itemLabel?.value || "";
      const uri = row.item?.value || "";
      const qid = uri.split("/").pop(); // e.g., https://www.wikidata.org/entity/Q12345 -> Q12345
      return {
        regionName: label,
        areaCode: qid,
      };
    });

    return res.status(200).json({ candidates });
  } catch (e) {
    return res.status(503).json({ error: e?.message || "Wikidata unavailable" });
  }
}