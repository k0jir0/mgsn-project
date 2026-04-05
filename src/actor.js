import { safeGetCanisterEnv } from "@icp-sdk/core/agent/canister-env";
import { createActor } from "./bindings/backend";

export function createBackendActor() {
  const canisterEnv = safeGetCanisterEnv();
  const canisterId = canisterEnv?.["PUBLIC_CANISTER_ID:backend"];

  if (!canisterId) {
    return null;
  }

  return createActor(canisterId, {
    agentOptions: {
      host: window.location.origin,
      rootKey: canisterEnv?.IC_ROOT_KEY,
    },
  });
}
