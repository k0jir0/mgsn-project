import { execSync } from "node:child_process";
import { defineConfig } from "vite";
import { icpBindgen } from "@icp-sdk/bindgen/plugins/vite";

const environment = process.env.ICP_ENVIRONMENT ?? "local";
const canisterNames = ["backend"];

function getCanisterId(name) {
  return execSync(`icp canister status ${name} -e ${environment} -i`, {
    encoding: "utf8",
    stdio: "pipe",
  }).trim();
}

function getDevServerConfig() {
  const networkStatus = JSON.parse(
    execSync(`icp network status -e ${environment} --json`, {
      encoding: "utf8",
      stdio: "pipe",
    })
  );

  const canisterParams = canisterNames
    .map((name) => `PUBLIC_CANISTER_ID:${name}=${getCanisterId(name)}`)
    .join("&");

  return {
    headers: {
      "Set-Cookie": `ic_env=${encodeURIComponent(`${canisterParams}&ic_root_key=${networkStatus.root_key}`)}; SameSite=Lax;`,
    },
    proxy: {
      "/api": {
        target: networkStatus.api_url,
        changeOrigin: true,
      },
    },
  };
}

export default defineConfig(({ command }) => ({
  plugins: [
    icpBindgen({
      didFile: "./backend/backend.did",
      outDir: "./src/bindings",
    }),
  ],
  base: command === "build" && process.env.GITHUB_PAGES ? "/mgsn-project/" : "/",
  build: {
    assetsDir: "",
    rollupOptions: {
      input: {
        main:     "./index.html",
        strategy: "./strategy.html",
        build:    "./build.html",
        buyback:  "./buyback.html",
        staking:  "./staking.html",
        burn:     "./burn.html",
      },
    },
  },
  ...(command === "serve" ? { server: getDevServerConfig() } : {}),
}));
