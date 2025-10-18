import type { VercelRequest, VercelResponse } from '@vercel/node';
import OpenAI from 'openai';

const client = new OpenAI({ apiKey: process.env.OPENAI_API_KEY! });

// AndroidのApiModels.ktと鍵名を合わせる（snake_case）
const jsonSchema = {
  name: "EstimateResponse",
  schema: {
    type: "object",
    additionalProperties: false,
    properties: {
      region: { type: ["string", "null"] },
      prefecture: { type: ["string", "null"] },
      male_in_range: { type: ["integer", "null"] },
      population: {
        type: ["object", "null"],
        additionalProperties: false,
        properties: {
          male: { type: ["integer", "null"] },
          total: { type: ["integer", "null"] },
          area_km2: { type: ["number", "null"] }
        }
      },
      model: {
        type: ["object", "null"],
        additionalProperties: false,
        properties: {
          upper_tail: { type: ["number", "null"] }
        }
      },
      note: { type: ["string", "null"] },
      error: { type: ["string", "null"] }
    },
    required: ["region", "male_in_range", "population", "model", "note", "error"]
  }
} as const;

const SYSTEM_PROMPT =
  "You are a Japanese municipal demographics estimation engine.\n" +
  "Estimate conservatively using credible priors when exact statistics are unavailable.\n" +
  "Rules:\n" +
  "- Keep values realistic; avoid extreme outputs.\n" +
  "- Male share typically ~48-50% of total population.\n" +
  "- Age bands: 15-64 ~58-60%, 65+ ~28-30% nationally; adjust lightly by urban cues.\n" +
  "- 'hensachi' is a selectivity factor; do NOT change totals, only scale male_in_range modestly.\n" +
  "- Always return JSON matching the provided schema (snake_case); no extra fields.\n" +
  "- Include a short 'note' of assumptions.";

export default async function handler(req: VercelRequest, res: VercelResponse) {
  try {
    const region = String((req.query.region ?? req.body?.region ?? "")).trim();
    const prefectureRaw = (req.query.prefecture ?? req.body?.prefecture);
    const prefecture = (prefectureRaw === undefined || prefectureRaw === null || String(prefectureRaw).trim() === "")
      ? null : String(prefectureRaw).trim();
    const minAge = Number(req.query.minAge ?? req.body?.minAge ?? 15);
    const maxAge = Number(req.query.maxAge ?? req.body?.maxAge ?? 99);
    const hensachi = Number(req.query.hensachi ?? req.body?.hensachi ?? 50);

    if (!region) return res.status(400).json({ error: "region is required" });
    if (Number.isNaN(minAge) || Number.isNaN(maxAge) || minAge < 0 || maxAge > 120 || minAge > maxAge)
      return res.status(400).json({ error: "invalid age range" });
    if (Number.isNaN(hensachi) || hensachi < 1 || hensachi > 80)
      return res.status(400).json({ error: "invalid hensachi (1-80)" });

    const completion = await client.chat.completions.create({
      model: "gpt-4.1",
      temperature: 0.1,
      messages: [
        { role: "system", content: SYSTEM_PROMPT },
        {
          role: "user",
          content:
            `Estimate male population for region="${region}"` +
            (prefecture ? `, prefecture="${prefecture}"` : "") +
            ` in ages ${minAge}-${maxAge} with hensachi=${hensachi}. Return JSON only.`
        }
      ],
      response_format: { type: "json_schema", json_schema: jsonSchema }
    });

    const text = completion.choices[0]?.message?.content ?? "{}";
    let obj: any;
    try {
      obj = JSON.parse(text);
    } catch {
      obj = {
        region, prefecture,
        male_in_range: null,
        population: { male: null, total: null, area_km2: null },
        model: { upper_tail: null },
        note: null,
        error: "parse_error"
      };
    }

    // サニタイズ（負値・矛盾の補正）
    const clampInt = (v: any) => (Number.isFinite(v) ? Math.max(0, Math.round(v)) : null);
    const clampFloat = (v: any) => (Number.isFinite(v) ? Math.max(0, v) : null);

    if (obj.population) {
      obj.population.male = clampInt(obj.population.male);
      obj.population.total = clampInt(obj.population.total);
      obj.population.area_km2 = clampFloat(obj.population.area_km2);
      if (obj.population.male != null && obj.population.total != null &&
          obj.population.male > obj.population.total) {
        obj.population.male = Math.floor(obj.population.total * 0.49);
      }
    }
    obj.male_in_range = clampInt(obj.male_in_range);
    if (obj.male_in_range != null && obj.population?.male != null) {
      obj.male_in_range = Math.min(obj.male_in_range, obj.population.male);
    }

    return res.status(200).json(obj);
  } catch (e: any) {
    return res.status(500).json({
      region: null, prefecture: null, male_in_range: null,
      population: { male: null, total: null, area_km2: null },
      model: { upper_tail: null }, note: null,
      error: e?.message ?? "internal_error"
    });
  }
}