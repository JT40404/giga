// Fallback settings. On Vercel, the environment variables (TOKEN_MINT,
// BOT_NAME, TOKEN_TICKER) override these, so you don't need to edit code at launch.
export const SITE = {
  name: "GIGA",
  ticker: "GIGA",
  mint: "",              // optional fallback contract address
  marketPollMs: 30000,   // $GIGA readout refresh
  boardPollMs: 120000,   // trending board refresh (edge-cached for 2 minutes)
};
