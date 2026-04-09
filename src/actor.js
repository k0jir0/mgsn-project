import { safeGetCanisterEnv } from "@icp-sdk/core/agent/canister-env";
import { createActor } from "./bindings/backend";

const IC_API_HOST = "https://icp-api.io";

function getBackendHost() {
  return window.location.hostname.includes("localhost")
    ? window.location.origin
    : IC_API_HOST;
}

export function createBackendActor() {
  const canisterEnv = safeGetCanisterEnv();
  const canisterId = canisterEnv?.["PUBLIC_CANISTER_ID:backend"];

  if (!canisterId) {
    return null;
  }

  return createActor(canisterId, {
    agentOptions: {
      host: getBackendHost(),
      rootKey: canisterEnv?.IC_ROOT_KEY,
    },
  });
}
