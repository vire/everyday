import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtemp, rm, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { slugToFile, selectMemoryProvider } from "./memory-provider";

describe("slugToFile", () => {
  it("maps owner/name to owner__name.md", () => {
    expect(slugToFile("octocat/hello-world")).toBe("octocat__hello-world.md");
  });
});

describe("selectMemoryProvider", () => {
  it("returns the gist provider by default and when MEMORY_PROVIDER is not fs", () => {
    // gist provider vs fs provider are distinct object identities
    const gist = selectMemoryProvider({});
    expect(selectMemoryProvider({ MEMORY_PROVIDER: "gist" })).toBe(gist);
    expect(selectMemoryProvider({ MEMORY_PROVIDER: "fs", MEMORY_DIR: "/tmp/x" })).not.toBe(gist);
  });
  it("is case-insensitive for fs", () => {
    const fs = selectMemoryProvider({ MEMORY_PROVIDER: "FS", MEMORY_DIR: "/tmp/x" });
    expect(fs).not.toBe(selectMemoryProvider({}));
  });
});

describe("fs provider", () => {
  let dir: string;
  beforeEach(async () => {
    dir = await mkdtemp(join(tmpdir(), "eve-memtest-"));
  });
  afterEach(async () => {
    await rm(dir, { recursive: true, force: true });
  });

  it("seeds initial memory when the file is missing, then reads it back unchanged", async () => {
    const p = selectMemoryProvider({ MEMORY_PROVIDER: "fs", MEMORY_DIR: dir });

    const first = await p.read(["acme/widgets"]);
    expect(first.ok).toBe(true);
    if (!first.ok) return;
    const seeded = first.memories[0];
    expect(seeded).toMatchObject({ repo: "acme/widgets", ok: true, created: true });
    if (!seeded.ok) return;
    expect(seeded.ref).toBe(join(dir, "acme__widgets.md"));
    expect(seeded.content).toContain("acme/widgets");
    // file actually written
    expect(await readFile(seeded.ref, "utf8")).toBe(seeded.content);

    // second read finds the existing file (created: false), same content
    const second = await p.read(["acme/widgets"]);
    if (!second.ok || !second.memories[0].ok) throw new Error("expected ok read");
    expect(second.memories[0].created).toBe(false);
    expect(second.memories[0].content).toBe(seeded.content);
  });

  it("write round-trips through the ref returned by read", async () => {
    const p = selectMemoryProvider({ MEMORY_PROVIDER: "fs", MEMORY_DIR: dir });
    const read = await p.read(["acme/widgets"]);
    if (!read.ok || !read.memories[0].ok) throw new Error("expected ok read");
    const ref = read.memories[0].ref;

    const res = await p.write([{ ref, content: "updated body" }]);
    expect(res.results[0]).toEqual({ ref, ok: true });
    expect(await readFile(ref, "utf8")).toBe("updated body");
  });

  it("isolates a per-repo failure without sinking the others", async () => {
    const p = selectMemoryProvider({ MEMORY_PROVIDER: "fs", MEMORY_DIR: dir });
    // Pre-create a path where one repo's file should be, but as a directory, so
    // reading it as a file fails while the sibling repo still resolves.
    await writeFile(join(dir, "good__repo.md"), "seed", "utf8");
    const { mkdir } = await import("node:fs/promises");
    await mkdir(join(dir, "bad__repo.md"), { recursive: true });

    const read = await p.read(["good/repo", "bad/repo"]);
    if (!read.ok) throw new Error("expected top-level ok");
    expect(read.memories[0].ok).toBe(true);
    expect(read.memories[1].ok).toBe(false);
  });
});
