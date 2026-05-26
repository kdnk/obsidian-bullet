import { readFileSync, writeFileSync } from "node:fs";

function readJson(path) {
  return JSON.parse(readFileSync(path, "utf8"));
}

function writeJson(path, value) {
  writeFileSync(path, JSON.stringify(value, null, 2) + "\n");
}

function parseMinAppVersionArg() {
  const minAppVersionArg = process.argv.find((arg) =>
    arg.startsWith("--min-app-version="),
  );

  if (!minAppVersionArg) {
    return process.env.MIN_APP_VERSION;
  }

  return minAppVersionArg.slice("--min-app-version=".length);
}

function main() {
  const packageFile = readJson("package.json");
  const manifestFile = readJson("manifest.json");
  const versionsFile = readJson("versions.json");
  const previousVersions = Object.fromEntries(
    Object.entries(versionsFile).filter(
      ([version]) => version !== packageFile.version,
    ),
  );
  const minAppVersion =
    parseMinAppVersionArg() ?? manifestFile.minAppVersion;

  manifestFile.version = packageFile.version;
  manifestFile.minAppVersion = minAppVersion;
  writeJson("manifest.json", manifestFile);

  writeJson("versions.json", {
    [packageFile.version]: minAppVersion,
    ...previousVersions,
  });

  console.log(
    `Synced manifest.json and versions.json to ${packageFile.version} (minAppVersion: ${minAppVersion})`,
  );
}

main();
