// /api/estat/proxy.js
const ESTAT_HOST = "https://api.e-stat.go.jp";

function parseParamsList(paramsStr) {
  const out = {};
  if (!paramsStr) return out;
  for (const pair of paramsStr.split(",").map(s => s.trim()).filter(Boolean)) {
    const i = pair.indexOf(":");
    if (i <= 0) continue;
    const k = pair.slice(0, i).trim();
    const v = pair.slice(i + 1).trim();
    if (k) out[k] = v;
  }
  return out;
}

export default async function handler(req, res) {
  if (req.method !== "GET") {
    res.setHeader("Allow", "GET");
    return res.status(405).json({ error: "Method Not Allowed" });
  }

  const appId = process.env.ESTAT_APP_ID;
  if (!appId) return res.status(503).json({ error: "ESTAT_APP_ID is not set" });

  const path = String(req.query.path || "");
  if (!path.startsWith("/rest/")) {
    return res.status(400).json({ error: "Invalid path. Must start with /rest/..." });
  }

  const paramsFromList = parseParamsList(req.query.params);
  const pass = { ...req.query };
  delete pass.path; delete pass.params;

  const finalParams = { ...paramsFromList, ...pass, appId };

  const url = new URL(path, ESTAT_HOST);
  Object.entries(finalParams).forEach(([k, v]) => url.searchParams.set(k, v));

  try {
    const r = await fetch(url, { cache: "no-store" });
    const ct = r.headers.get("content-type") || "";
    const text = await r.text();

    res.setHeader("x-upstream-status", String(r.status));
    res.setHeader("cache-control", "no-store");

    if (ct.includes("json") || text.trim().startsWith("{") || text.trim().startsWith("[")) {
      try { return res.status(r.status).json(JSON.parse(text)); }
      catch { res.setHeader("content-type", "text/plain; charset=utf-8"); return res.status(r.status).send(text); }
    } else {
      res.setHeader("content-type", ct || "text/plain; charset=utf-8");
      return res.status(r.status).send(text);
    }
  } catch (e) {
    return res.status(502).json({ error: "Failed to reach e-Stat", detail: String(e) });
  }
}