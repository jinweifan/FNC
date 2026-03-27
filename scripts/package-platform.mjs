import { spawn } from "node:child_process";
import { accessSync, constants, cpSync, existsSync, mkdirSync, readFileSync, rmSync, symlinkSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const BUILD_PLANS = {
  linux: {
    target: "x86_64-unknown-linux-gnu",
    bundles: "appimage,deb",
    hostPlatforms: ["linux"],
  },
  mac: {
    target: "aarch64-apple-darwin",
    bundles: "app,dmg",
    hostPlatforms: ["darwin"],
  },
  "mac:intel": {
    target: "x86_64-apple-darwin",
    bundles: "app,dmg",
    hostPlatforms: ["darwin"],
  },
  win: {
    target: "x86_64-pc-windows-msvc",
    bundles: "nsis,msi",
    hostPlatforms: ["win32"],
  },
};

export function resolveBuildPlan(name) {
  const plan = BUILD_PLANS[name];
  if (!plan) {
    throw new Error(
      `Unsupported package target "${name}". Supported targets: ${Object.keys(BUILD_PLANS).join(", ")}.`,
    );
  }

  return {
    target: plan.target,
    bundles: plan.bundles,
  };
}

export function resolveExecutionPlan(name) {
  const plan = resolveBuildPlan(name);
  const createPlainDmg = name === "mac" || name === "mac:intel";
  return {
    ...plan,
    tauriBundles: createPlainDmg ? "app" : plan.bundles,
    createPlainDmg,
  };
}

function assertHostPlatform(name) {
  const supported = BUILD_PLANS[name].hostPlatforms;
  if (supported.includes(process.platform)) {
    return;
  }

  const labels = supported.map((platform) => {
    if (platform === "darwin") return "macOS";
    if (platform === "linux") return "Linux";
    if (platform === "win32") return "Windows";
    return platform;
  });

  throw new Error(
    `Package target "${name}" must be built on ${labels.join(" or ")}. Current host platform is ${process.platform}.`,
  );
}

export function buildEnvForPlatform(baseEnv, platform) {
  const env = { ...baseEnv };
  if (platform === "linux") {
    env.APPIMAGE_EXTRACT_AND_RUN = env.APPIMAGE_EXTRACT_AND_RUN || "1";
  }
  if (platform !== "win32" && env.HOME) {
    const cargoBin = path.join(env.HOME, ".cargo", "bin");
    try {
      accessSync(cargoBin, constants.X_OK);
      env.PATH = env.PATH ? `${cargoBin}:${env.PATH}` : cargoBin;
    } catch {
      // Ignore when Cargo is already on PATH or rustup is installed elsewhere.
    }
  }
  return env;
}

function buildEnv() {
  return buildEnvForPlatform(process.env, process.platform);
}

function runCommand(command, args, options) {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, {
      ...options,
      stdio: "inherit",
    });

    child.on("error", reject);
    child.on("exit", (code, signal) => {
      if (signal) {
        reject(new Error(`Command "${command}" terminated by signal ${signal}.`));
        return;
      }
      if (code !== 0) {
        reject(new Error(`Command "${command}" exited with code ${code}.`));
        return;
      }
      resolve();
    });
  });
}

function readTauriMetadata(repoRoot) {
  const tauriConfigPath = path.join(repoRoot, "src-tauri", "tauri.conf.json");
  const tauriConfig = JSON.parse(readFileSync(tauriConfigPath, "utf8"));
  return {
    productName: tauriConfig.productName,
    version: tauriConfig.version,
  };
}

function archLabelForTarget(target) {
  if (target.startsWith("aarch64-")) return "aarch64";
  if (target.startsWith("x86_64-")) return "x64";
  return target.split("-")[0];
}

function bundleRoot(repoRoot, target) {
  return path.join(repoRoot, "src-tauri", "target", target, "release", "bundle");
}

async function reSignMacAppBundle(repoRoot, appBundlePath) {
  await runCommand(
    "codesign",
    ["--force", "--deep", "--sign", "-", appBundlePath],
    { cwd: repoRoot, env: buildEnv() },
  );
}

async function createPlainMacDmg(repoRoot, target) {
  const { productName, version } = readTauriMetadata(repoRoot);
  const appBundlePath = path.join(bundleRoot(repoRoot, target), "macos", `${productName}.app`);
  if (!existsSync(appBundlePath)) {
    throw new Error(`Expected app bundle at ${appBundlePath}, but it was not found.`);
  }

  await reSignMacAppBundle(repoRoot, appBundlePath);

  const dmgDir = path.join(bundleRoot(repoRoot, target), "dmg");
  mkdirSync(dmgDir, { recursive: true });

  const stagingDir = path.join(dmgDir, `.plain-dmg-${process.pid}`);
  rmSync(stagingDir, { recursive: true, force: true });
  mkdirSync(stagingDir, { recursive: true });

  const stagedAppPath = path.join(stagingDir, `${productName}.app`);
  cpSync(appBundlePath, stagedAppPath, { recursive: true });
  symlinkSync("/Applications", path.join(stagingDir, "Applications"));

  const dmgPath = path.join(dmgDir, `${productName}_${version}_${archLabelForTarget(target)}.dmg`);
  rmSync(dmgPath, { force: true });

  return runCommand(
    "hdiutil",
    [
      "create",
      "-volname",
      productName,
      "-srcfolder",
      stagingDir,
      "-ov",
      "-format",
      "UDZO",
      dmgPath,
    ],
    { cwd: repoRoot, env: buildEnv() },
  ).finally(() => {
    rmSync(stagingDir, { recursive: true, force: true });
  });
}

async function runBuild(name) {
  assertHostPlatform(name);
  const { target, tauriBundles, createPlainDmg } = resolveExecutionPlan(name);
  const scriptDir = path.dirname(fileURLToPath(import.meta.url));
  const repoRoot = path.resolve(scriptDir, "..");
  const tauriCli = path.join(repoRoot, "node_modules", "@tauri-apps", "cli", "tauri.js");

  await runCommand(
    process.execPath,
    [tauriCli, "build", "--target", target, "--bundles", tauriBundles],
    {
      cwd: repoRoot,
      env: buildEnv(),
    },
  );

  if (createPlainDmg) {
    await createPlainMacDmg(repoRoot, target);
  }
}

const isMainModule = process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);

if (isMainModule) {
  const targetName = process.argv[2];
  if (!targetName) {
    console.error(`Usage: node ./scripts/package-platform.mjs <${Object.keys(BUILD_PLANS).join("|")}>`);
    process.exit(1);
  }

  try {
    await runBuild(targetName);
  } catch (error) {
    console.error(error instanceof Error ? error.message : String(error));
    process.exit(1);
  }
}
