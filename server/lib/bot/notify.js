// Optional: posts each verdict to a Telegram channel via the official Bot API.
export async function notifyTelegram(v, siteUrl) {
  const token = process.env.TELEGRAM_BOT_TOKEN;
  const chat = process.env.TELEGRAM_CHAT_ID;
  if (!token || !chat) return;
  const lines = [
    `${v.decision === "BUY" ? "🟢 BOUGHT $" + v.buyUsd : "🔴 PASSED"} on ${v.coin.symbol ? "$" + v.coin.symbol : v.mint}`,
    `Pitched by ${v.author}`,
    "",
    v.reply,
    "",
    v.tx ? `tx: https://solscan.io/tx/${v.tx}` : null,
    v.mint ? `coin: https://pump.fun/coin/${v.mint}` : null,
    siteUrl ? `all calls: ${siteUrl}/#verdicts` : null,
  ].filter((l) => l !== null);
  await fetch(`https://api.telegram.org/bot${token}/sendMessage`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ chat_id: chat, text: lines.join("\n"), disable_web_page_preview: true }),
  }).catch(() => {});
}
