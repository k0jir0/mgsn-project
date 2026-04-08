# MGSN Strategy Tracker

Live site: https://yezrb-diaaa-aaaah-qugnq-cai.icp0.io/

MGSN Strategy Tracker is a multi-page ICP frontend for the MGSN and BOB ecosystem. It combines live ICPSwap market data, MGSN ledger data, a scenario studio for demos, tokenomics-focused calculators, and a revenue-first operating blueprint across dashboard, strategy, build, buyback, staking, and burn pages.

## What Is Live Today

- Dashboard uses live ICPSwap prices and pool stats, plus monthly history with a current live point.
- Strategy uses live market inputs for signals, DCA modeling, LP yield estimates, and shareable signal summaries.
- Buyback is live as a calculator and schedule page, and stays in an honest prelaunch state until a public buyback vault is published.
- Staking is live in launch-preview mode with real market assumptions, but needs a public staking canister to show live positions.
- Burn reads live MGSN ledger and archive data to show supply, burn totals, leaderboard, and burn milestones.
- Build page turns the lean SNS DAO, treasury, revenue app, and analytics spec into an integrated roadmap tied to current token IDs and public program wiring.
- Scenario Studio persists across pages so one demo state can drive the full site consistently.
- Mobile navigation and scrolling are tuned so the site behaves like a usable platform on phones and tablets.

## Routes

| Route | Purpose |
| --- | --- |
| `/` | Dashboard: charts, live prices, reserve view, volume/liquidity, portfolio context |
| `/strategy.html` | Strategy engine: 6-signal view, Kelly sizing, DCA, LP yield, portfolio tools |
| `/build.html` | Build spec: SNS DAO, treasury logic, revenue app, analytics layer, and reality check |
| `/buyback.html` | Buyback program: schedule, calculator, program status, execution log area |
| `/staking.html` | Staking program: lock tiers, APY estimator, supply impact, launch-preview state |
| `/burn.html` | Community burn: ledger-indexed burns, leaderboard, milestones, impact calculator |

## Data Sources

- ICPSwap info API for token and pool snapshots
- ICPSwap NodeIndex and TokenStorage canisters for token history and spot references
- ICPSwap pool daily chart endpoint for pool TVL and rolling volume context
- MGSN ledger and archive scans for supply and burn activity

The production dashboard reads these sources directly in the browser. The Motoko backend in this repo is retained for local experimentation and bindgen compatibility, but it is not the production source of truth for dashboard data.

## Live UX Notes

- The dashboard now first paints in a `Loading live data` state instead of pretending fallback data is final.
- In-flight ICPSwap info requests are deduplicated so the dashboard is less likely to degrade into partial fallback states.
- If live pool stats are temporarily unavailable, the UI labels that honestly instead of inventing values.
- Scenario overrides are clearly labeled across all pages.

## Token IDs

| Token | Canister ID |
| --- | --- |
| MGSN | `2rqn6-kiaaa-aaaam-qcuya-cai` |
| BOB | `7pail-xaaaa-aaaas-aabmq-cai` |
| ICP | `ryjl3-tyaaa-aaaaa-aaaba-cai` |

ICPSwap swap URL:

`https://app.icpswap.com/swap?input=ryjl3-tyaaa-aaaaa-aaaba-cai&output=2rqn6-kiaaa-aaaam-qcuya-cai`

## Current Program Status

### Buyback

- Program page and calculator are live.
- Auto-indexing of real buyback executions is ready.
- To unlock live execution logs, publish `VITE_MGSN_BUYBACK_ACCOUNT`.
- Until then, the page stays in a truthful prelaunch state.

### Staking

- Launch-preview page and estimator are live.
- To unlock live staking positions and contract-backed lock tiers, publish `VITE_MGSN_STAKING_CANISTER` and its public read interface.

### Burn

- Burn page is fully live from ledger/archive data.
- Blackhole address is `aaaaa-aa`.
- Burn totals and burn leaderboard are derived from real on-chain activity.

## Stack

- Frontend: Vite 7, vanilla ES modules, Chart.js
- Backend: Motoko sample canister for local workflows only
- Deploy target: ICP asset canister `yezrb-diaaa-aaaah-qugnq-cai`
- Live frontend data path: ICPSwap APIs/canisters plus MGSN ledger/archive queries

## Important Files

```text
src/
  main.js         Dashboard
  strategy.js     Strategy page
  build.js        Build-spec roadmap page
  buyback.js      Buyback page
  staking.js      Staking page
  burn.js         Burn page
  siteState.js    Shared scenario studio, cache, data status chips
  siteChrome.js   Shared top/bottom platform navigation
  liveData.js     Dashboard and market data aggregation
  icpswapInfo.js  ICPSwap info API and pool chart helpers
  onChainData.js  Ledger/archive reads for supply, burns, and program states
  demoData.js     Shared constants and fallback values
  styles.css      Shared layout and responsive styles

backend/
  main.mo         Legacy sample canister
  backend.did     Candid interface
```

## Local Development

1. Install dependencies:

```powershell
npm install
```

2. Optional: rebuild the Motoko backend WASM if `backend/main.mo` changed.

On Windows, `mops` is easiest through Docker:

```powershell
docker run --rm -v "${PWD}:/project" -w /project node:22 bash -c 'npm install -g ic-mops 2>/dev/null; mops install 2>/dev/null; MOC=/root/.cache/mops/moc/1.3.0/moc; SOURCES=$(mops sources); $MOC backend/main.mo --omit-metadata candid:service $SOURCES -o backend/backend.wasm'
ic-wasm backend/backend.wasm -o backend/backend.wasm metadata candid:service -f backend/backend.did -v public --keep-name-section
```

3. Start the local ICP network:

```powershell
icp network start -d
```

4. Deploy locally:

```powershell
icp deploy
```

5. Run the frontend dev server if needed:

```powershell
npm run dev
```

6. Preview a production build locally:

```powershell
npm run build
npm run preview
```

## Mainnet Deploy

Standard path:

```powershell
npm run build
icp deploy -e ic -y
```

If the asset canister hits the known `Failed to list assets` sync problem, use the working fallback:

```powershell
icp sync frontend -e ic --debug
```

## Optional Environment Variables

- `VITE_MGSN_BUYBACK_ACCOUNT`
  Public MGSN buyback vault owner/account for auto-indexing buyback fills
- `VITE_MGSN_STAKING_CANISTER`
  Public staking canister principal for live staking state

When these are unset, the UI stays in a truthful prelaunch or launch-preview state instead of showing fake activity.

## Operational Notes

- The repo may contain an untracked `deploy_out_latest.txt` after deployments; it is not part of the app.
- The production frontend CSP must allow `https://api.icpswap.com` and `https://icp-api.io` for live market data and canister reads.
- The dashboard caches recent live data in local storage for faster first paint, then refreshes live in the browser.
- Scenario Studio can intentionally override live prices, volume, and liquidity for demos; those overrides are labeled in the UI.
