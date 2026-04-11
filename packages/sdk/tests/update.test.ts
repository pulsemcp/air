import { describe, it, expect, afterEach } from "vitest";
import { resolve, join } from "path";
import {
  mkdirSync,
  writeFileSync,
  rmSync,
  existsSync,
} from "fs";
import { execFileSync } from "child_process";
import { tmpdir } from "os";
import { updateProviderCaches } from "../src/update.js";

const tempDirs: string[] = [];
let origHome: string | undefined;

afterEach(() => {
  if (origHome !== undefined) {
    process.env.HOME = origHome;
    origHome = undefined;
  }
  for (const dir of tempDirs) {
    if (existsSync(dir)) {
      rmSync(dir, { recursive: true, force: true });
    }
  }
  tempDirs.length = 0;
});

function createTempDir(): string {
  const dir = resolve(
    tmpdir(),
    `air-sdk-update-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`
  );
  mkdirSync(dir, { recursive: true });
  tempDirs.push(dir);
  return dir;
}

/**
 * Create a bare git repo and a shallow clone of it in the cache directory.
 * This simulates a cached GitHub clone at ~/.air/cache/github/{owner}/{repo}/{ref}.
 */
function createCachedClone(
  fakeHome: string,
  owner: string,
  repo: string,
  ref: string
): string {
  const gitEnv = {
    ...process.env,
    GIT_AUTHOR_NAME: "test",
    GIT_AUTHOR_EMAIL: "test@test.com",
    GIT_COMMITTER_NAME: "test",
    GIT_COMMITTER_EMAIL: "test@test.com",
  };

  // Create a "remote" repo with the desired branch name and one commit
  const remoteDir = join(fakeHome, ".air-remotes", owner, repo);
  mkdirSync(remoteDir, { recursive: true });
  execFileSync("git", ["init", "--initial-branch", ref], { cwd: remoteDir, stdio: "pipe", env: gitEnv });
  writeFileSync(join(remoteDir, "README.md"), "test");
  execFileSync("git", ["add", "."], { cwd: remoteDir, stdio: "pipe", env: gitEnv });
  execFileSync("git", ["commit", "-m", "init"], { cwd: remoteDir, stdio: "pipe", env: gitEnv });

  // Clone into the cache directory structure
  const cacheDir = join(fakeHome, ".air", "cache", "github", owner, repo, ref);
  mkdirSync(join(fakeHome, ".air", "cache", "github", owner, repo), { recursive: true });
  execFileSync("git", ["clone", "--depth", "1", "--branch", ref, remoteDir, cacheDir], { stdio: "pipe", env: gitEnv });

  return cacheDir;
}

function setFakeHome(dir: string): void {
  origHome = process.env.HOME;
  process.env.HOME = dir;
}

describe("updateProviderCaches", () => {
  it("discovers providers from cache directory when air.json has no extensions", async () => {
    const fakeHome = createTempDir();
    setFakeHome(fakeHome);

    // Create air.json with empty extensions
    const airDir = join(fakeHome, ".air");
    mkdirSync(airDir, { recursive: true });
    writeFileSync(
      join(airDir, "air.json"),
      JSON.stringify({ name: "test", extensions: [] })
    );

    // Create a cached clone
    createCachedClone(fakeHome, "test-owner", "test-repo", "main");

    const { results } = await updateProviderCaches({
      config: join(airDir, "air.json"),
    });

    // Provider should be discovered from cache directory
    expect(results).toHaveProperty("github");
    expect(results.github.length).toBeGreaterThan(0);

    const entry = results.github.find((r) =>
      r.label.includes("test-owner/test-repo@main")
    );
    expect(entry).toBeDefined();
    expect(typeof entry!.updated).toBe("boolean");
  }, 30000);

  it("discovers providers from cache directory when air.json does not exist", async () => {
    const fakeHome = createTempDir();
    setFakeHome(fakeHome);

    // Create a cached clone but no air.json
    createCachedClone(fakeHome, "test-owner", "test-repo", "main");

    const { results } = await updateProviderCaches();

    // Provider should be discovered from cache directory even without air.json
    expect(results).toHaveProperty("github");
    expect(results.github.length).toBeGreaterThan(0);
  }, 30000);

  it("returns empty results when no cache directory exists", async () => {
    const fakeHome = createTempDir();
    setFakeHome(fakeHome);

    // No cache directory and no air.json
    const { results } = await updateProviderCaches();

    expect(Object.keys(results)).toEqual([]);
  });

  it("returns empty results when cache directory has no known provider schemes", async () => {
    const fakeHome = createTempDir();
    setFakeHome(fakeHome);

    // Create a cache directory with an unknown scheme
    mkdirSync(join(fakeHome, ".air", "cache", "unknown-provider"), { recursive: true });

    const { results } = await updateProviderCaches();

    expect(Object.keys(results)).toEqual([]);
  });

  it("refreshes cached clone and reports update status", async () => {
    const fakeHome = createTempDir();
    setFakeHome(fakeHome);

    const owner = "test-owner";
    const repo = "test-repo";
    const ref = "main";

    // Create a cached clone
    createCachedClone(fakeHome, owner, repo, ref);

    // Push a new commit to the remote so the clone is stale
    const remoteDir = join(fakeHome, ".air-remotes", owner, repo);
    const gitEnv = {
      ...process.env,
      HOME: fakeHome,
      GIT_AUTHOR_NAME: "test",
      GIT_AUTHOR_EMAIL: "test@test.com",
      GIT_COMMITTER_NAME: "test",
      GIT_COMMITTER_EMAIL: "test@test.com",
    };
    writeFileSync(join(remoteDir, "new-file.txt"), "new content");
    execFileSync("git", ["add", "."], { cwd: remoteDir, stdio: "pipe", env: gitEnv });
    execFileSync("git", ["commit", "-m", "update"], { cwd: remoteDir, stdio: "pipe", env: gitEnv });

    const { results } = await updateProviderCaches();

    expect(results).toHaveProperty("github");
    const entry = results.github.find((r) =>
      r.label.includes(`${owner}/${repo}@${ref}`)
    );
    expect(entry).toBeDefined();
    expect(entry!.updated).toBe(true);
    expect(entry!.message).toContain("→");
  }, 30000);

  it("reports already up-to-date when clone matches remote", async () => {
    const fakeHome = createTempDir();
    setFakeHome(fakeHome);

    // Create a cached clone (no new commits pushed)
    createCachedClone(fakeHome, "test-owner", "test-repo", "main");

    const { results } = await updateProviderCaches();

    expect(results).toHaveProperty("github");
    const entry = results.github.find((r) =>
      r.label.includes("test-owner/test-repo@main")
    );
    expect(entry).toBeDefined();
    expect(entry!.updated).toBe(false);
    expect(entry!.message).toContain("up-to-date");
  }, 30000);

  it("skips immutable refs (full SHA)", async () => {
    const fakeHome = createTempDir();
    setFakeHome(fakeHome);

    // Use a 40-char hex string as the ref (simulates a commit SHA)
    const sha = "a".repeat(40);
    createCachedClone(fakeHome, "test-owner", "test-repo", sha);

    const { results } = await updateProviderCaches();

    expect(results).toHaveProperty("github");
    const entry = results.github.find((r) =>
      r.label.includes(`test-owner/test-repo@${sha}`)
    );
    expect(entry).toBeDefined();
    expect(entry!.updated).toBe(false);
    expect(entry!.message).toContain("immutable");
  }, 30000);
});
