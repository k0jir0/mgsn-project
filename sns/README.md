# MGSN SNS Handoff

This repository now contains the ownership and controller hooks needed to hand the operating stack to an SNS after launch, but an actual SNS launch still has to happen through the NNS SNS workflow.

## What Is In Repo

- Treasury governance wiring in the treasury canister via `configureGovernance`
- Ownership transfer hooks in treasury, subscriptions, and analytics
- Ops page bootstrap controls for wiring canister integrations and setting SNS principal placeholders
- Real treasury, subscriptions, and analytics canisters that can be transferred under SNS control after launch

## Expected Launch Sequence

1. Deploy `treasury`, `subscriptions`, `analytics`, and `frontend`.
2. Open `/ops.html` and claim ownership with the intended admin principal.
3. Run the bootstrap flow so subscriptions reports revenue into treasury and both treasury/subscriptions report into analytics.
4. Launch the SNS through the NNS workflow using your finalized tokenomics and decentralization config.
5. After the SNS root and SNS governance principals exist, set them in `/ops.html` or call `treasury.configureGovernance` directly.
6. Transfer ownership/controller authority from the bootstrap admin principal to the SNS-managed principals.

## Important Constraint

The repo cannot unilaterally create a live SNS on your behalf because SNS creation is an on-chain governance process external to this workspace. What it does provide is the operational stack and the canister-level handoff points required to move from bootstrap admin control to SNS control without rewriting the app.