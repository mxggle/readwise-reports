import { mkdtemp, readFile, rm, stat } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { strToU8, zipSync } from "fflate";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { importFromZip, isSafeEntryPath } from "../src/server/services/importer.js";

let root: string;
beforeEach(async () => {
  root = await mkdtemp(path.join(os.tmpdir(), "import-test-"));
});
afterEach(async () => {
  await rm(root, { recursive: true, force: true });
});

const INDEX = "export default async function run() { return { itemsProcessed: 0, itemsSkipped: 0 }; }\n";

describe("isSafeEntryPath", () => {
  it("accepts normal nested paths", () => {
    expect(isSafeEntryPath("skill/index.ts")).toBe(true);
    expect(isSafeEntryPath("skill.json")).toBe(true);
  });
  it("rejects traversal and absolute paths", () => {
    expect(isSafeEntryPath("../evil.txt")).toBe(false);
    expect(isSafeEntryPath("a/../../b")).toBe(false);
    expect(isSafeEntryPath("/etc/passwd")).toBe(false);
  });
});

describe("importFromZip", () => {
  it("imports a well-formed zip into the target root", async () => {
    const zip = zipSync({
      "pkg/skill.json": strToU8(JSON.stringify({ id: "zipped", title: "Zipped" })),
      "pkg/index.ts": strToU8(INDEX),
    });
    const result = await importFromZip(zip, root);
    expect(result.id).toBe("zipped");
    expect((await stat(path.join(root, "zipped", "index.ts"))).isFile()).toBe(true);
    const manifest = JSON.parse(await readFile(path.join(root, "zipped", "skill.json"), "utf8"));
    expect(manifest.id).toBe("zipped");
  });

  it("rejects a zip-slip archive before writing anything", async () => {
    const zip = zipSync({
      "skill.json": strToU8(JSON.stringify({ id: "evil", title: "Evil" })),
      "index.ts": strToU8(INDEX),
      "../escape.txt": strToU8("pwned"),
    });
    await expect(importFromZip(zip, root)).rejects.toMatchObject({ status: 400 });
  });

  it("rejects a zip without a skill.json", async () => {
    const zip = zipSync({ "readme.txt": strToU8("nope") });
    await expect(importFromZip(zip, root)).rejects.toMatchObject({ status: 400 });
  });
});
