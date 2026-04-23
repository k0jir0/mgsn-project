# MGSN Strategy Tracker

Live site: https://yezrb-diaaa-aaaah-qugnq-cai.icp0.io/

MGSN Strategy Tracker is a multi-page ICP frontend for the MGSN and BOB ecosystem. It combines live ICPSwap market data, MGSN ledger data, tokenomics-focused calculators, a live-controls drawer for refresh and local defaults, and a revenue-first operating stack across dashboard, trench, strategy, build, subscribe, ops, buyback, staking, and burn pages.

## What Is Live Today

- Dashboard uses live ICPSwap prices and pool stats, plus monthly history with a current live point.
- Trench is a lore-first Maurice landing page with a live proof console that keeps quotes and public proof feeds wired into the larger BOB plan.
- Strategy uses live market inputs for signals, DCA modeling, LP yield estimates, and shareable signal summaries.
- Buyback is live as a calculator and schedule page, and reports an unpublished vault honestly until a public buyback account is published.
- Staking uses live market assumptions and published program status, but needs a public staking canister read interface before live positions can be shown.
- Keep/Burn turns an ICP amount into a guided MGSN support plan with keep and burn splits, simple plain-English outcomes, and direct handoff into ICPSwap plus the burn rail.
- Burn now combines a live ledger-indexed board with an Internet Identity burn console, personal burner stats, proof panels, and companion burn pages.
- Burn Proof exposes receipt-first verification, recent burns, and short-window burn flow.
- Hall of Flame expands the burn leaderboard into all-time and 30-day ranking views.
- Burn Lab is the hard-math planning surface for supply impact, milestone distance, and projected rank movement.
- Protocol Burns tracks treasury, buyback, and trench-linked burn wiring honestly, including staged LP burn receipts.
- Build page turns the lean SNS DAO, treasury, revenue app, and analytics spec into an integrated roadmap tied to current token IDs and public program wiring.
- Subscribe issues real on-chain invoices from a subscriptions canister, verifies invoice balances, and settles paid subscriptions into treasury.
- Ops exposes treasury disbursements, treasury balance snapshots, analytics KPIs, and bootstrap controls for wiring the new canisters together.
- The live-controls drawer persists local calculator defaults across pages and exposes refresh plus cache-clear actions.
- Mobile navigation and scrolling are tuned so the site behaves like a usable platform on phones and tablets.

## Routes

| Route | Purpose |
| --- | --- |
| `/` | Dashboard: charts, live prices, reserve view, volume/liquidity, portfolio context |
| `/trench.html` | Maurice landing page: phase-one trench console, route map, live proof panel, BOB/ICP framing |
| `/strategy.html` | Strategy engine: 6-signal view, Kelly sizing, DCA, LP yield, portfolio tools |
| `/build.html` | Build spec: SNS DAO, treasury logic, revenue app, analytics layer, and reality check |
| `/subscribe.html` | Subscription revenue app: invoice creation, payment reconciliation, treasury settlement |
| `/ops.html` | Treasury and analytics operations: bootstrap wiring, balance snapshots, governance hooks, disbursements |
| `/buyback.html` | Buyback program: schedule, calculator, program status, execution log area |
| `/staking.html` | Staking program: lock tiers, APY estimator, supply impact, live program status |
| `/keep-burn.html` | Guided keep/burn plan: choose ICP, pick a split, buy MGSN, and preload a burn amount |
| `/burn.html` | Community burn: native burn console, personal burner card, proof panel, milestones, and leaderboard |
| `/burn-proof.html` | Burn Proof: receipt-first burn verification, recent receipts, and 14-day burn flow |
| `/hall-of-flame.html` | Hall of Flame: all-time and 30-day burn rankings |
| `/burn-lab.html` | Burn Lab: scenario planning for supply compression, milestone distance, and projected rank |
| `/protocol-burns.html` | Protocol Burns: treasury, buyback, and trench-linked burn source coverage |

## Data Sources

- ICPSwap info API for token and pool snapshots
- ICPSwap NodeIndex and TokenStorage canisters for token history and spot references
- ICPSwap pool daily chart endpoint for pool TVL and rolling volume context
- MGSN ledger and archive scans for supply and burn activity

The market dashboard still reads these sources directly in the browser. The repo now also contains real Motoko canisters for treasury, subscriptions, and analytics so the DAO operating system is no longer just a roadmap page.

## Live UX Notes

- The dashboard now first paints in a `Loading live data` state instead of substituting a bundled market snapshot.
- In-flight ICPSwap info requests are deduplicated so the dashboard is less likely to degrade into partial unavailable states.
- If live pool stats are temporarily unavailable, the UI labels that honestly instead of inventing values.
- The live-controls drawer can refresh live data, clear cached first-paint state, and store local calculator defaults without overriding market data.

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
- Until then, the page reports that the public vault has not been published yet.

### Staking

- Live status and reward estimators are available.
- To unlock live staking positions and contract-backed lock tiers, publish `VITE_MGSN_STAKING_CANISTER` and its public read interface.

### Burn

- Burn page is live from ledger/archive data and now includes a direct Internet Identity burn rail for default-account holders.
- Blackhole address is `aaaaa-aa`.
- Burn totals and burn leaderboard are derived from real on-chain activity.
- Burn Proof, Hall of Flame, Burn Lab, and Protocol Burns now extend the burn surface without leaving the burn data spine.

## Stack

- Frontend: Vite 7, vanilla ES modules, Chart.js
- Backend: Motoko canisters for treasury, subscriptions, analytics, plus the legacy sample backend
- Deploy target: ICP asset canister `yezrb-diaaa-aaaah-qugnq-cai`
- Live frontend data path: ICPSwap APIs/canisters plus MGSN ledger/archive queries

## Important Files

```text
src/
  main.js         Dashboard
  trench.js       Maurice landing page and live proof console
  trench.css      Maurice trench-specific visuals
  strategy.js     Strategy page
  build.js        Build-spec roadmap page
  subscribe.js    Subscription billing page
  ops.js          Treasury and analytics operations page
  buyback.js      Buyback page
  staking.js      Staking page
  keep-burn.js    Guided keep/burn support planner
  burn.js         Burn page
  burn-proof.js   Burn receipt and proof page
  hall-of-flame.js Burn ranking page
  burn-lab.js     Burn planning page
  protocol-burns.js Protocol burn source page
  burnSuite.js    Shared burn data, routing, and burn-execution helpers
  burnHub.css     Shared burn ecosystem styling
  auth.js         Internet Identity session helper
  mgsnCanisters.js Manual actor factories for treasury, subscriptions, and analytics
  platformUtils.js Shared bigint, principal, and timestamp formatting helpers
  siteState.js    Shared live-controls drawer, cache, data status chips
  siteChrome.js   Shared top/bottom platform navigation
  liveData.js     Dashboard and market data aggregation
  liveDefaults.js Honest unavailable-state helpers and local calculator defaults
  icpswapInfo.js  ICPSwap info API and pool chart helpers
  onChainData.js  Ledger/archive reads for supply, burns, and program states
  demoData.js     Shared token/program constants and historical reference data
  styles.css      Shared layout and responsive styles

backend/
  main.mo         Legacy sample canister
  backend.did     Candid interface
  treasury/       Treasury canister source and candid
  subscriptions/  Subscription invoice and entitlement canister
  analytics/      Revenue and subscription analytics canister

scripts/
  build-canister.mjs Local/Docker build helper for Motoko canisters

sns/
  README.md       SNS handoff and governance controller plan
```

## Local Development

1. Install dependencies:

```powershell
npm install
```

2. Rebuild Motoko canisters when treasury, subscriptions, analytics, or the legacy backend change.

If Docker Desktop is running, the repo can use the container fallback. If Docker is unavailable, the local helper will attempt to use `mops` directly, but Motoko compilation still requires a Linux-capable runtime on Windows.

On Windows, `mops` is easiest through Docker:

```powershell
docker run --rm -v "${PWD}:/project" -w /project node:22 bash -c 'npm install -g ic-mops 2>/dev/null; mops install 2>/dev/null; MOC=/root/.cache/mops/moc/1.3.0/moc; SOURCES=$(mops sources); $MOC backend/main.mo --omit-metadata candid:service $SOURCES -o backend/backend.wasm'
ic-wasm backend/backend.wasm -o backend/backend.wasm metadata candid:service -f backend/backend.did -v public --keep-name-section
```

The new canisters can be built with the helper script:

```powershell
node scripts/build-canister.mjs treasury
node scripts/build-canister.mjs subscriptions
node scripts/build-canister.mjs analytics
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

When these are unset, the UI reports unpublished program wiring instead of showing fake activity.

## Operational Notes

- The repo may contain an untracked `deploy_out_latest.txt` after deployments; it is not part of the app.
- The production frontend CSP must allow `https://api.icpswap.com` and `https://icp-api.io` for live market data and canister reads.
- The dashboard caches recent live data in local storage for faster first paint, then refreshes live in the browser.
- The live-controls drawer can clear cached first-paint data and store local calculator defaults, but it does not override market, pool, or on-chain program state.
- The treasury canister expects the subscriptions canister to be authorized as a revenue reporter.
- The analytics canister expects treasury and subscriptions to be authorized as reporters.
- Use `/ops.html` after deploy to claim ownership, wire integrations, snapshot balances, and set SNS governance principals.
