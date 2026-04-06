# MGSN Strategy Tracker

**Live:** https://yezrb-diaaa-aaaah-qugnq-cai.icp0.io/

A full-stack analytics and tokenomics dashboard for the $MGSN / $BOB token pair, deployed as an ICP asset canister. Combines live market data from ICPSwap canisters with four value-support mechanisms: a 6-signal strategy engine, a protocol-funded buyback program, a revenue-share staking program, and a community burn program.

---

## Pages

| Route | Description |
|---|---|
| `/` | Dashboard — BOB/MGSN price charts, portfolio tracker, arbitrage signals, live analytics |
| `/strategy.html` | Strategy Engine — 6-signal composite score, Kelly sizing, DCA backtest, LP yield calculator |
| `/buyback.html` | Buyback Program — 50% of LP fees fund monthly MGSN market buys, schedule and log |
| `/staking.html` | Staking Program — 50% of LP fees distributed to stakers, 4 lock tiers with multipliers, APY calculator |
| `/burn.html` | Community Burn — voluntary permanent supply destruction, leaderboard, Hall of Flame, milestone tracker |

---

## Tokenomics stack

All four mechanisms target a different lever on $MGSN value:

- **Strategy Engine** — timing signal for optimal buy/sell execution
- **Buyback Program** — protocol revenue → market demand → permanent supply removal
- **Staking Program** — protocol revenue → holder yield → float compression (30/90/180/365-day tiers, 1.0–3.0× multipliers)
- **Community Burn** — voluntary irreversible supply destruction by any holder; public leaderboard and milestone badges (Ignition 1% / Combustion 5% / Inferno 10% / Supernova 20%)

The buyback and staking programs together consume **100% of LP fee income** and redirect it back into $MGSN value. Burn adds scarcity pressure at zero protocol cost.

---

## Token identifiers

| Token | Canister ID |
|---|---|
| MGSN | `2rqn6-kiaaa-aaaam-qcuya-cai` |
| BOB | `7pail-xaaaa-aaaas-aabmq-cai` |
| ICP | `ryjl3-tyaaa-aaaaa-aaaba-cai` |

ICPSwap swap URL: https://app.icpswap.com/swap?input=ryjl3-tyaaa-aaaaa-aaaba-cai&output=2rqn6-kiaaa-aaaam-qcuya-cai

---

## Stack

- **Frontend:** Vite 7.x multi-page app, Chart.js, vanilla JS ES modules
- **Backend:** Motoko canister (ICP) — legacy sample canister retained for local experimentation
- **Deploy:** `icp-cli` to ICP asset canister `yezrb-diaaa-aaaah-qugnq-cai`
- **Live data:** ICPSwap NodeIndex + TokenStorage canister queries via `src/liveData.js`, plus MGSN ledger/archive queries via `src/onChainData.js`

---

## Key source files

```
src/
  main.js          — Dashboard (price charts, portfolio tracker, arbitrage, alerts)
  strategy.js      — Strategy Engine (6-signal score, Kelly sizing, DCA, LP yield)
  buyback.js       — Buyback Program page
  staking.js       — Staking Program page (APY calculator, tier cards, supply chart)
  burn.js          — Community Burn page (leaderboard, milestones, impact calculator)
  demoData.js      — Shared constants: BUYBACK_PROGRAM, STAKING_PROGRAM, BURN_PROGRAM
  liveData.js      — Live price + pool stat fetchers (ICPSwap, spot APIs)
  onChainData.js   — MGSN ledger + archive queries (supply, burn history, program status)
  styles.css       — Shared CSS variables and base styles

backend/
  main.mo          — Legacy Motoko sample canister (no longer used for production dashboard data)
  backend.did      — Candid interface for bindgen

paper1.txt         — Strategy Engine technical paper
paper2.txt         — Strategy Engine layman paper
paper3.txt         — Buyback Program paper
paper4.txt         — Staking Program paper
paper5.txt         — Community Burn Program paper
```

---

## Local setup

1. Install dependencies:

   ```powershell
   npm install
   ```

2. **Build the Motoko WASM** (Windows — `mops` requires Linux, use Docker):

   ```powershell
   docker run --rm -v "${PWD}:/project" -w /project node:22 bash -c 'npm install -g ic-mops 2>/dev/null; mops install 2>/dev/null; MOC=/root/.cache/mops/moc/1.3.0/moc; SOURCES=$(mops sources); $MOC backend/main.mo --omit-metadata candid:service $SOURCES -o backend/backend.wasm'
   ic-wasm backend/backend.wasm -o backend/backend.wasm metadata candid:service -f backend/backend.did -v public --keep-name-section
   ```

   On Linux/macOS, `icp deploy` uses the `@dfinity/motoko@v4.1.0` recipe directly.

3. Start project-local ICP network:

   ```powershell
   icp network start -d
   ```

4. Deploy both canisters locally:

   ```powershell
   icp deploy
   ```

5. Optional: Vite dev server (after backend is deployed):

   ```powershell
   npm run dev
   ```

---

## Deploy to mainnet

```powershell
Push-Location "C:\path\to\MGSN"
npx vite build
icp deploy -e ic -y
Pop-Location
```

---

## Optional program addresses

If you want the site to auto-index buyback or staking records from public on-chain program addresses, provide these at build time:

- `VITE_MGSN_BUYBACK_ACCOUNT` — dedicated public MGSN buyback vault owner principal
- `VITE_MGSN_STAKING_CANISTER` — staking canister principal once the contract is published

When those values are unset, the UI reports that the program address is not yet configured instead of showing placeholder logs.

---

## Notes

- The production dashboard now reads ICPSwap directly in the browser; the backend sample canister remains optional.
- The burn page now reads MGSN ledger archives directly and auto-indexes blackhole transfers plus native ledger burn operations.
- On Windows, the `@dfinity/motoko` recipe cannot run because `mops toolchain bin moc` requires Linux. The `icp.yaml` uses a custom build step with a pre-built WASM. Rebuild via Docker whenever `backend/main.mo` changes.
- Canister ID mappings are in `.icp/cache/mappings/local.ids.json` (gitignored). Preserve IDs from `icp canister status backend` if needed across machines.
