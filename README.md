# BOB / MGSN Strategy Tracker

## About

MGSN Strategy Tracker is a SaylorTracker-inspired analytics dashboard built on the Internet Computer Protocol (ICP). It tracks BOB and MGSN token performance over time, presenting market snapshots, derived metrics, and strategy insights through a clean, responsive frontend. The backend is powered by a Motoko canister that stores and serves token timeline data, while the frontend is a Vite-based asset canister deployed directly on ICP. The project is designed to evolve from seeded historical data toward live on-chain feeds — either via ICP HTTPS outcalls to external data sources or direct integration with ledger and DEX analytics once the BOB and MGSN token identifiers are finalized.

SaylorTracker-inspired dashboard built for the Internet Computer with:

- a Motoko backend canister for seeded token snapshots
- a Vite frontend deployed as an ICP asset canister
- modern `icp` configuration instead of legacy `dfx`

## Stack

- `icp-cli` for project lifecycle and deployment
- Motoko with `mo:core`
- Vite with `@icp-sdk/bindgen`
- ICP asset canister for frontend hosting

## Files that matter

- `backend/main.mo`: Motoko canister and seeded BOB/MGSN timeline
- `backend/backend.did`: committed Candid file for bindgen
- `src/main.js`: dashboard rendering and derived analytics
- `public/.ic-assets.json5`: asset canister routing and security headers
- `icp.yaml`: canister definitions using the current ICP recipes

## Local setup

1. Install frontend dependencies:

   ```powershell
   npm install
   ```

2. **Build the Motoko WASM** (Windows — `mops` requires Linux, so use Docker):

   ```powershell
   docker run --rm -v "${PWD}:/project" -w /project node:22 bash -c 'npm install -g ic-mops 2>/dev/null; mops install 2>/dev/null; MOC=/root/.cache/mops/moc/1.3.0/moc; SOURCES=$(mops sources); $MOC backend/main.mo --omit-metadata candid:service $SOURCES -o backend/backend.wasm'
   ic-wasm backend/backend.wasm -o backend/backend.wasm metadata candid:service -f backend/backend.did -v public --keep-name-section
   ```

   On Linux/macOS `icp deploy` uses the `@dfinity/motoko@v4.1.0` recipe directly and this step is not needed.

3. Start the project-local ICP network:

   ```powershell
   icp network start -d
   ```

4. Deploy both canisters locally:

   ```powershell
   icp deploy
   ```

5. Optional: run the Vite dev server after the backend is deployed:

   ```powershell
   npm run dev
   ```

The Vite config follows the current ICP guidance and injects the `ic_env` cookie during local development so the frontend can discover the backend canister ID.

## Data model

This first version uses seeded BOB/MGSN market snapshots from `backend/main.mo`. That gives you a working Motoko-backed dashboard immediately while the real token source IDs and feed strategy are still undefined.

To swap in live data later, the cleanest next step is one of these:

1. replace the seed series directly in `backend/main.mo`
2. wire a trusted HTTPS data source into the canister with ICP HTTPS outcalls
3. replace the seed model with direct ledger or DEX-derived analytics once the BOB and MGSN identifiers are finalized

## Notes

- The backend is query-only right now, which keeps the first deployment path simple and safe.
- Canister ID mappings are stored in `.icp/cache/mappings/local.ids.json`. The `.gitignore` excludes `.icp/cache/` — if you need to preserve IDs across machines, note them from `icp canister status backend` / `icp canister status frontend`.
- On Windows the `@dfinity/motoko` recipe cannot run because `mops toolchain bin moc` requires a Linux shell. The `icp.yaml` uses a custom build step that copies a pre-built WASM instead. Rebuild it via the Docker step above whenever `backend/main.mo` changes.