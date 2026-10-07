# GIGA site

Live market data, the token's pump.fun callout thread, and wallet-to-wallet tipping for the GIGA bot.

No build step: static HTML/CSS/JS plus four Vercel serverless functions in `/api`.

```
index.html, styles.css, app.js   the page
config.js                        fallback name/ticker/tip presets
assets/                          GIGA artwork and favicon
api/config.js                    public settings (name, ticker, contract address)
api/market.js                    CoinGecko on-chain data + pump.fun coin info
api/callouts.js                  the coin's pump.fun reply thread
api/rpc.js                       locked-down Solana RPC proxy used for tipping
```

## Deploy

1. Create a new GitHub repo and push this folder to it:
   ```bash
   git init && git add . && git commit -m "GIGA site"
   git branch -M main
   git remote add origin https://github.com/YOUR_NAME/giga-site.git
   git push -u origin main
   ```
2. In Vercel, choose **Add New → Project**, import the repo, keep the framework preset as **Other**, and deploy.
3. In **Project → Settings → Environment Variables**, add the values from `.env.example`:
   - `COINGECKO_API_KEY` and `COINGECKO_PLAN` (`demo` or `pro`, matching your key)
   - `RPC_URL`: a Solana mainnet RPC URL. A free Helius or QuickNode key is strongly recommended; the public endpoint rate-limits.
   - `TOKEN_MINT`: leave empty until launch.
4. Redeploy after changing variables (Deployments → ⋯ → Redeploy).

## At launch

Set `TOKEN_MINT` to the contract address in Vercel and redeploy. Before that, the site shows a pre-launch state with tipping disabled. To rename the bot later, set `BOT_NAME` and `TOKEN_TICKER`, and replace the images in `assets/`.

## How the pieces work

**Market data.** `api/market.js` calls CoinGecko's on-chain endpoints (token price, market cap, volume, liquidity, 24h buys/sells, and 15-minute candles for the chart). Responses are edge-cached for 20 seconds so visitors don't burn your quota. A brand-new pump.fun token may take a little while to show up in CoinGecko; until then the site falls back to pump.fun's own market cap.

**Callouts.** `api/callouts.js` reads the coin's reply thread from pump.fun's frontend API. That API is unofficial and undocumented, so it can change or block requests without notice. If the thread stops loading, check the function logs in Vercel first.

**Tipping.** Each pump.fun reply is tied to the wallet that posted it. Pressing Tip builds a transaction in the visitor's browser that sends GIGA from their wallet straight to that caller's wallet; the site never holds funds or keys. It creates the caller's token account if needed (the tipper pays about 0.002 SOL rent the first time) and attaches a memo naming the callout, so tips are traceable on-chain. Classic SPL and Token-2022 mints are both handled.

## Local testing

```bash
npm i -g vercel
vercel dev
```
Put your variables in a `.env` file (already git-ignored) for local runs.
