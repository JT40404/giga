// The bot's heartbeat. Call it every minute (Vercel Cron on Pro, or a free
// external scheduler like cron-job.org) with: Authorization: Bearer <CRON_SECRET>
import { getMint } from "../lib/env.js";
import { fetchReplies, pick } from "../lib/replies.js";
import { redis, claim, pushVerdict, storeConfigured } from "../lib/bot/store.js";
import { analyzeCoin } from "../lib/bot/analyze.js";
import { judge } from "../lib/bot/brain.js";
import { buyUsd } from "../lib/bot/trade.js";
import { notifyTelegram } from "../lib/bot/notify.js";

const BASE58_G = /[1-9A-HJ-NP-Za-km-z]{32,44}/g;
const env = (k, d) => process.env[k] ?? d;

export default async function handler(req, res) {
  res.setHeader("Cache-Control", "no-store");
  const secret = process.env.CRON_SECRET;
  if (!secret || req.headers.authorization !== `Bearer ${secret}`) return res.status(401).json({ error: "unauthorized" });
  if (env("BOT_ENABLED", "false") !== "true") return res.json({ ok: true, skipped: "BOT_ENABLED is not true" });
  if (!storeConfigured()) return res.status(500).json({ error: "Redis not configured" });

  const gigaMint = getMint();
  if (!gigaMint) return res.json({ ok: true, skipped: "TOKEN_MINT not set yet" });

  const name = env("BOT_NAME", "GIGAFUNBOT");
  const handle = env("BOT_HANDLE", name).replace(/^@/, "");
  const mention = new RegExp(`@${handle.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\b`, "i");
  const buyAmount = Number(env("BOT_BUY_USD", "2"));
  const dryRun = env("BOT_DRY_RUN", "true") !== "false";
  const maxPerTick = Number(env("BOT_MAX_PER_TICK", "3"));
  const maxBuysPerDay = Number(env("BOT_MAX_BUYS_PER_DAY", "10"));
  const cooldownMin = Number(env("BOT_USER_COOLDOWN_MINUTES", "60"));

  // Only respond to mentions posted after the bot was first switched on.
  await redis("SET", "giga:since", Date.now(), "NX");
  const since = Number(await redis("GET", "giga:since"));

  let list;
  try {
    ({ list } = await fetchReplies(gigaMint, { limit: 50, offset: 0 }));
  } catch (e) {
    return res.json({ ok: false, skipped: `Can't read @mentions: ${e.message}` });
  }
  const replies = list
    .map(pick)
    .filter((r) => !r.hidden && r.text && mention.test(r.text) && r.ts >= since)
    .sort((a, b) => a.ts - b.ts)
    .slice(0, maxPerTick);

  const results = [];
  for (const r of replies) {
    const id = r.id;
    if (!(await claim(`giga:seen:${id}`, 60 * 60 * 24 * 30))) continue;

    const author = r.username || (r.user ? `${r.user.slice(0, 4)}…${r.user.slice(-4)}` : "anon");
    const verdict = {
      id, at: Date.now(), postedAt: r.ts, author, authorWallet: r.user || null,
      thesis: String(r.text).slice(0, 1000), buyUsd: buyAmount, dryRun,
      threadUrl: `https://pump.fun/coin/${gigaMint}`,
      mint: null, coin: {}, stats: null, decision: "PASS", score: 0, reasons: [], reply: "", executed: false, tx: null, note: null,
    };

    try {
      if (r.user && !(await claim(`giga:cool:${r.user}`, cooldownMin * 60))) {
        results.push({ id, skipped: "author on cooldown" });
        continue;
      }

      const ca = (r.text.match(BASE58_G) || []).find((m) => m !== gigaMint);
      if (!ca) {
        verdict.reply = `You summoned me with no contract address? Bold. Tag me again with the CA and an actual thesis. NFA`;
        verdict.reasons = ["no contract address in the post"];
      } else {
        verdict.mint = ca;
        const { stats, fails } = await analyzeCoin(ca);
        if (await redis("EXISTS", `giga:bought:${ca}`)) fails.push("GIGA already bought this coin once");
        verdict.stats = stats;
        verdict.coin = { name: stats.name, symbol: stats.symbol };

        const j = await judge({ name, buyUsd: buyAmount, author, thesis: verdict.thesis, stats, forcedPass: fails });
        Object.assign(verdict, { decision: j.decision, score: j.score, reasons: fails.length ? fails : j.reasons, reply: j.reply });

        if (j.decision === "BUY") {
          const day = new Date().toISOString().slice(0, 10);
          const count = await redis("INCR", `giga:buys:${day}`);
          await redis("EXPIRE", `giga:buys:${day}`, 60 * 60 * 48);
          if (count > maxBuysPerDay) {
            await redis("DECR", `giga:buys:${day}`);
            verdict.note = "Liked it, but today's buy budget is spent.";
          } else if (!(await claim(`giga:bought:${ca}`, 60 * 60 * 24 * 90))) {
            await redis("DECR", `giga:buys:${day}`);
            verdict.note = "Already bought this coin.";
          } else if (dryRun) {
            verdict.note = "Dry run: no real trade was made.";
          } else {
            try {
              const t = await buyUsd(ca, buyAmount);
              verdict.executed = true;
              verdict.tx = t.signature;
            } catch (e) {
              await redis("DEL", `giga:bought:${ca}`);
              await redis("DECR", `giga:buys:${day}`);
              verdict.note = `Buy failed: ${e.message}`;
            }
          }
        }
      }
    } catch (e) {
      verdict.note = `Couldn't finish the analysis: ${e.message}`;
      if (!verdict.reply) verdict.reply = "My circuits overheated reading this one. PASS for now. NFA";
    }

    await pushVerdict(verdict);
    const site = process.env.SITE_URL || (process.env.VERCEL_PROJECT_PRODUCTION_URL ? `https://${process.env.VERCEL_PROJECT_PRODUCTION_URL}` : "");
    await notifyTelegram(verdict, site);
    results.push({ id, decision: verdict.decision, executed: verdict.executed, note: verdict.note });
  }

  res.json({ ok: true, dryRun, checked: replies.length, results });
}
