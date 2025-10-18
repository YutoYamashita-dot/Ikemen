// /api/region/candidates.js
// 文字列を含む日本の自治体（市/区/町/村など）候補を Wikidata から取得
// 返却: { candidates: [{ regionName, qid }] }

const { fetchWithRetry } = require('./_lib/fetchWithRetry');

module.exports = async (req, res) => {
  res.setHeader('Cache-Control', 'public, max-age=300, s-maxage=300'); // 5分キャッシュ
  if (req.method !== 'GET') return res.status(405).json({ error: 'Method Not Allowed' });

  const kw = (req.query.kw || '').toString().trim();
  if (!kw) return res.status(200).json({ candidates: [] });

  const userAgent =
    process.env.WIKIDATA_USER_AGENT ||
    'CoolGuysApp/1.0 (+https://example.com; contact: dev@example.com)';

  // SPARQL: 日本（Q17）内の行政区画ラベルに kw を含むもの
  const sparql = `
SELECT ?item ?itemLabel WHERE {
  ?item wdt:P31 ?class .
  VALUES ?class { wd:Q515 wd:Q532 wd:Q70208 wd:Q15284 wd:Q484170 }  # city/ward/town/village/municipality 等
  ?item wdt:P17 wd:Q17 .                                          # country = Japan
  SERVICE wikibase:label { bd:serviceParam wikibase:language "ja,en". }
  FILTER(CONTAINS(LCASE(?itemLabel), LCASE("${kw}")))
}
LIMIT 20
  `.trim();

  const url = 'https://query.wikidata.org/sparql?format=json&query=' + encodeURIComponent(sparql);

  try {
    const r = await fetchWithRetry(url, {
      headers: {
        'User-Agent': userAgent,
        'Accept': 'application/sparql-results+json',
      },
    });
    if (!r.ok) {
      return res.status(502).json({ candidates: [], warning: `Wikidata error ${r.status}` });
    }
    const json = await r.json();
    const candidates = (json.results?.bindings || []).map((b) => {
      const qid = (b.item?.value || '').split('/').pop();
      const regionName = b.itemLabel?.value || qid;
      return { regionName, qid };
    });
    return res.status(200).json({ candidates });
  } catch (e) {
    return res.status(502).json({ candidates: [], warning: String(e) });
  }
};