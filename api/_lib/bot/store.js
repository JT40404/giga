// Tiny Upstash Redis client over its REST API (no dependency).
// Works with Vercel's Upstash integration (KV_REST_API_*) or a direct Upstash DB.
const URL_ = process.env.KV_REST_API_URL || process.env.UPSTASH_REDIS_REST_URL;
const TOKEN = process.env.KV_REST_API_TOKEN || process.env.UPSTASH_REDIS_REST_TOKEN;

export const storeConfigured = () => Boolean(URL_ && TOKEN);

export async function redis(...cmd) {
  if (!storeConfigured()) throw new Error("Redis is not configured (add Upstash from the Vercel Marketplace)");
  const r = await fetch(URL_, {
    method: "POST",
    headers: { Authorization: `Bearer ${TOKEN}`, "Content-Type": "application/json" },
    body: JSON.stringify(cmd.map(String)),
  });
  const j = await r.json();
  if (j.error) throw new Error(`Redis: ${j.error}`);
  return j.result;
}

// SET key value NX EX ttl -> true if this caller claimed the key
export async function claim(key, ttlSeconds, value = "1") {
  return (await redis("SET", key, value, "NX", "EX", ttlSeconds)) === "OK";
}

export async function pushVerdict(v) {
  await redis("LPUSH", "giga:verdicts", JSON.stringify(v));
  await redis("LTRIM", "giga:verdicts", 0, 199);
}

export async function listVerdicts(limit = 30) {
  const rows = (await redis("LRANGE", "giga:verdicts", 0, limit - 1)) || [];
  return rows.map((r) => { try { return JSON.parse(r); } catch { return null; } }).filter(Boolean);
}
