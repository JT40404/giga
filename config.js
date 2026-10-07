// Fallback settings. On Vercel, the environment variables (TOKEN_MINT,
// BOT_NAME, TOKEN_TICKER) override these, so you don't need to edit code at launch.
export const SITE = {
  name: "Find Oscar",
  ticker: "OSCAR
",
  mint: "JBssdt4vBK5RZJyiWtJndGrMkiP4CMFhLAsCkZ52dw8G",              // optional fallback contract address
  marketPollMs: 30000,   // CoinGecko refresh (edge-cached for 20s)
  calloutPollMs: 20000,  // pump.fun thread refresh
  tipPresets: ["1000", "10000", "100000"],
};
