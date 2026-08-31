import { readdir, readFile } from "node:fs/promises";
import { describe, expect, it } from "vitest";

describe("the Habitat image workspace install", () => {
  it("installs every workspace before copying source", async () => {
    const packagesDir = new URL("../../", import.meta.url);
    const dockerfile = await readFile(
      new URL("../Dockerfile", import.meta.url),
      "utf8",
    );
    const packageDirectories = (
      await readdir(packagesDir, { withFileTypes: true })
    )
      .filter((entry) => entry.isDirectory())
      .map((entry) => entry.name)
      .sort();

    for (const directory of packageDirectories) {
      expect(dockerfile, directory).toContain(
        `COPY packages/${directory}/package.json ./packages/${directory}/`,
      );
    }
  });
});
