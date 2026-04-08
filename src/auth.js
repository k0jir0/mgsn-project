import { AuthClient } from "@dfinity/auth-client";

let authClientPromise;
const listeners = new Set();

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
  return window.localStorage.getItem("MGSN_IDENTITY_PROVIDER") || "https://identity.ic0.app";
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