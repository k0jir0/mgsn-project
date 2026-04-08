import { execFileSync } from "node:child_process";
import { existsSync } from "node:fs";
import path from "node:path";

const [, , canisterName, outputArg] = process.argv;

if (!canisterName) {
  throw new Error("Missing canister name. Usage: node scripts/build-canister.mjs <canister> [output.wasm]");
}

const CANISTERS = {
  analytics: {
    source: "backend/analytics/main.mo",
    did: "backend/analytics/analytics.did",
    wasm: "backend/analytics/analytics.wasm",
  },
  subscriptions: {
    source: "backend/subscriptions/main.mo",
    did: "backend/subscriptions/subscriptions.did",
    wasm: "backend/subscriptions/subscriptions.wasm",
  },
  treasury: {
    source: "backend/treasury/main.mo",
    did: "backend/treasury/treasury.did",
    wasm: "backend/treasury/treasury.wasm",
  },
};

const config = CANISTERS[canisterName];

if (!config) {
  throw new Error(`Unsupported canister '${canisterName}'. Expected one of: ${Object.keys(CANISTERS).join(", ")}`);
}

const workspaceRoot = process.cwd();
const sourcePath = path.join(workspaceRoot, config.source);
const didPath = path.join(workspaceRoot, config.did);
const intermediateWasmPath = path.join(workspaceRoot, config.wasm);
const finalOutputPath = path.resolve(workspaceRoot, outputArg ?? config.wasm);

for (const requiredPath of [sourcePath, didPath]) {
  if (!existsSync(requiredPath)) {
    throw new Error(`Missing build input: ${requiredPath}`);
  }
}

const dockerWorkspace = workspaceRoot.replace(/\\/g, "/");
const dockerSource = config.source.replace(/\\/g, "/");
const dockerWasm = config.wasm.replace(/\\/g, "/");
const icWasmArgs = [
  intermediateWasmPath,
  "-o",
  finalOutputPath,
  "metadata",
  "candid:service",
  "-f",
  didPath,
  "-v",
  "public",
  "--keep-name-section",
];

function buildWithLocalMops() {
  execFileSync("npx", ["mops", "install"], { stdio: "inherit" });

  const mocPath = execFileSync("npx", ["mops", "toolchain", "bin", "moc"], {
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"],
  }).trim();
  const sourcesOutput = execFileSync("npx", ["mops", "sources"], {
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"],
  }).trim();
  const sourceArgs = sourcesOutput ? sourcesOutput.split(/\s+/u) : [];

  execFileSync(
    mocPath,
    [config.source, "--omit-metadata", "candid:service", ...sourceArgs, "-o", intermediateWasmPath],
    { stdio: "inherit" }
  );
}

function buildWithDocker() {
  execFileSync(
    "docker",
    [
      "run",
      "--rm",
      "-v",
      `${dockerWorkspace}:/project`,
      "-w",
      "/project",
      "node:22",
      "bash",
      "-lc",
      [
        "npm install -g ic-mops >/dev/null 2>&1",
        "mops install >/dev/null 2>&1",
        "MOC=/root/.cache/mops/moc/1.3.0/moc",
        "SOURCES=$(mops sources)",
        `\"$MOC\" ${dockerSource} --omit-metadata candid:service $SOURCES -o ${dockerWasm}`,
      ].join("; "),
    ],
    { stdio: "inherit" }
  );
}

if (process.platform === "win32") {
  buildWithDocker();
} else {
  try {
    buildWithLocalMops();
  } catch (localError) {
    console.warn(`Local mops build failed for ${canisterName}; falling back to Docker.`);
    buildWithDocker();
  }
}

if (process.platform === "win32") {
  execFileSync("cmd.exe", ["/c", "ic-wasm", ...icWasmArgs], { stdio: "inherit" });
} else {
  execFileSync("ic-wasm", icWasmArgs, { stdio: "inherit" });
}