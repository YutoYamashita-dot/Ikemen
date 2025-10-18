// /api/estimate.js
// 入力: region(名称), minAge, maxAge, hensachi
// 出力: EstimateResponse（Android側のモデルに合わせる）
// population は { total?: number, male?: number, value?: number } のいずれかを返す
// ※ Wikidata は男女別・年齢別を直接は返しにくいので、ここでは「総人口」を取得し、
//   男性・年齢レンジはクライアントでスケーリング（既に MainActivity で対応）
// 503対策: リトライ/タイムアウト/短期キャッシュ

const { fetchWithRetry } = require('./_lib/fetchWithRetry');

module.exports = async (req, res) => {
  res.setHeader('Cache-Control', 'public, max-age=300, s-maxage=300'); // 5分キャッシュ
  if (req.method !== 'GET') return res.status(405).json({ error: 'Method Not Allowed' });

  const region = (req.query.region || '').toString().trim();
  const minAge = Number(req.query.minAge || 18);
  const maxAge = Number(req.query.maxAge || 35);
  const hensachi = Number(req.query.hensachi || 65);

  if (!region) {
    return res.status(400).json({ error: 'region is required' });
  }

  const userAgent =
    process.env.WIKIDATA_USER_AGENT ||
    'CoolGuysApp/1.0 (+https://example.com; contact: dev@example.com)';

  // region ラベル完全一致優先で最新の人口(P1082)を取得
  const sparql = `
SELECT ?item ?itemLabel ?pop ?popTime WHERE {
  ?item wdt:P31 ?class .
  VALUES ?class { wd:Q515 wd:Q532 wd:Q70208 wd:Q15284 wd:Q484170 } # city/ward/town/village/municipality
  ?item wdt:P17 wd:Q17 .
  ?item p:P1082 ?popStmt .
  ?popStmt ps:P1082 ?pop .
  OPTIONAL { ?popStmt pq:P585 ?popTime. }
  SERVICE wikibase:label { bd:serviceParam wikibase:language "ja,en". }
  FILTER(STR(?itemLabel) = "${region}" || CONTAINS(?itemLabel, "${region}"))
}
ORDER BY DESC(?popTime)
LIMIT 1
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
      return res.status(502).json({ error: `Wikidata error ${r.status}` });
    }
    const json = await r.json();
    const b = json.results?.bindings?.[0];

    // population が取れなかった場合は 0 を返す（クライアントで 0 ハンドリング）
    const total = b?.pop?.value ? Number(b.pop.value) : 0;
    const qid = b?.item?.value ? b.item.value.split('/').pop() : null;

    // Android側で使う型に合わせる
    const response = {
      areaCode: qid || null, // 厳密な行政コードではないが識別子として QID を返す
      population: {
        total: Number.isFinite(total) && total > 0 ? Math.round(total) : 0,
      },
      model: {
        // 上位割合はクライアントで計算可能だが、ここでもダミーを返す（0は返さない）
        upperTail: 0, // クライアントが hensachi から算出するため 0 を明示
      },
      estimate: null, // 人数の推定はクライアントが計算
      estimatedCoolGuys: null,
      input: {
        region,
        minAge,
        maxAge,
        hensachi,
      },
    };

    return res.status(200).json(response);
  } catch (e) {
    // Wikidata 側で不安定なときのフォールバック（503回避）
    return res.status(200).json({
      areaCode: null,
      population: { total: 0 },
      model: { upperTail: 0 },
      estimate: null,
      estimatedCoolGuys: null,
      warning: String(e),
      input: { region, minAge, maxAge, hensachi },
    });
  }
};