import { spawnSync } from "node:child_process";
import {
  copyFileSync,
  existsSync,
  mkdtempSync,
  readFileSync,
  rmSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const projectRoot = join(__dirname, "../..");

type PackageFile = {
  version: string;
  scripts: { version: string };
};

type PackageLockFile = {
  version: string;
  packages: { "": { version: string } };
};

type ManifestFile = {
  version: string;
  minAppVersion: string;
};

function readJson<T>(path: string): T {
  return JSON.parse(readFileSync(path, "utf8")) as T;
}

function runNpmVersion(cwd: string) {
  const npmCli = process.env.npm_execpath;
  const command = npmCli ? process.execPath : "npm";
  const args = npmCli ? [npmCli, "version", "patch"] : ["version", "patch"];

  return spawnSync(command, args, {
    cwd,
    encoding: "utf8",
    env: {
      ...process.env,
      npm_config_git_tag_version: undefined,
      npm_config_ignore_scripts: undefined,
      npm_config_update_notifier: "false",
    },
  });
}

describe("release version workflow", () => {
  test("disables npm Git commit and tag creation", () => {
    const npmConfig = readFileSync(join(projectRoot, ".npmrc"), "utf8");

    expect(npmConfig).toMatch(/^git-tag-version=false$/m);
  });

  test("limits the version lifecycle to metadata synchronization", () => {
    const packageFile = readJson<PackageFile>(
      join(projectRoot, "package.json"),
    );

    expect(packageFile.scripts.version).toBe("node release.mjs");
  });

  test("synchronizes release metadata without a Git repository", () => {
    const fixtureRoot = mkdtempSync(join(tmpdir(), "bullet-version-"));
    const fixtureFiles = [
      ".npmrc",
      "package.json",
      "package-lock.json",
      "manifest.json",
      "versions.json",
      "release.mjs",
    ];

    try {
      for (const file of fixtureFiles) {
        copyFileSync(join(projectRoot, file), join(fixtureRoot, file));
      }

      const previousVersion = readJson<PackageFile>(
        join(fixtureRoot, "package.json"),
      ).version;
      const result = runNpmVersion(fixtureRoot);

      expect({
        status: result.status,
        stdout: result.stdout,
        stderr: result.stderr,
      }).toMatchObject({ status: 0 });
      expect(existsSync(join(fixtureRoot, ".git"))).toBe(false);

      const packageFile = readJson<PackageFile>(
        join(fixtureRoot, "package.json"),
      );
      const packageLockFile = readJson<PackageLockFile>(
        join(fixtureRoot, "package-lock.json"),
      );
      const manifestFile = readJson<ManifestFile>(
        join(fixtureRoot, "manifest.json"),
      );
      const versionsFile = readJson<Record<string, string>>(
        join(fixtureRoot, "versions.json"),
      );

      expect(packageFile.version).not.toBe(previousVersion);
      expect(packageLockFile.version).toBe(packageFile.version);
      expect(packageLockFile.packages[""].version).toBe(packageFile.version);
      expect(manifestFile.version).toBe(packageFile.version);
      expect(Object.keys(versionsFile)[0]).toBe(packageFile.version);
      expect(versionsFile[packageFile.version]).toBe(
        manifestFile.minAppVersion,
      );
    } finally {
      rmSync(fixtureRoot, { recursive: true, force: true });
    }
  });
});
