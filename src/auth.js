import { AuthClient } from "@dfinity/auth-client";

let authClientPromise;
const listeners = new Set();
const DEFAULT_MAINNET_IDENTITY_PROVIDER = "https://id.ai";
const LOCAL_IDENTITY_PROVIDER = "http://id.ai.localhost:8000";
const EIGHT_HOURS_NS = 8n * 3_600_000_000_000n;

async function getAuthClient() {
  if (!authClientPromise) {
    authClientPromise = AuthClient.create({
      idleOptions: {
        disableIdle: true,
      },
    });
  }

  return authClientPromise;
}

function getIdentityProvider() {
  const overriddenProvider = window.localStorage.getItem("MGSN_IDENTITY_PROVIDER");
  if (overriddenProvider) {
    return overriddenProvider;
  }

  const host = window.location.hostname;
  const isLocal =
    host === "localhost" ||
    host === "127.0.0.1" ||
    host.endsWith(".localhost");

  return isLocal ? LOCAL_IDENTITY_PROVIDER : DEFAULT_MAINNET_IDENTITY_PROVIDER;
}

async function broadcastAuthState() {
  const state = await getAuthState();

  for (const listener of listeners) {
    listener(state);
  }
}

export async function getAuthState() {
  const client = await getAuthClient();
  const authenticated = await client.isAuthenticated();
  const identity = client.getIdentity();
  const principal = identity.getPrincipal().toText();

  return {
    authenticated,
    identity,
    principal,
  };
}

export async function login() {
  const client = await getAuthClient();

  await new Promise((resolve, reject) => {
    client.login({
      identityProvider: getIdentityProvider(),
      maxTimeToLive: EIGHT_HOURS_NS,
      onSuccess: resolve,
      onError: reject,
    });
  });

  await broadcastAuthState();
  return getAuthState();
}

export async function logout() {
  const client = await getAuthClient();
  await client.logout();
  await broadcastAuthState();
  return getAuthState();
}

export function subscribeAuth(listener) {
  listeners.add(listener);
  void getAuthState().then(listener);

  return () => {
    listeners.delete(listener);
  };
}
