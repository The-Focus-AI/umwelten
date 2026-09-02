import { afterEach, describe, expect, it } from "vitest";
import {
  childBaseUrl,
  resolveChildAddress,
  resolveChildAddressMode,
} from "./docker.js";

const previousMode = process.env.GAIA_CHILD_ADDRESS_MODE;

afterEach(() => {
  if (previousMode === undefined) delete process.env.GAIA_CHILD_ADDRESS_MODE;
  else process.env.GAIA_CHILD_ADDRESS_MODE = previousMode;
});

describe("Gaia child addressing", () => {
  it("auto-selects Docker DNS in a container and loopback on a host", () => {
    delete process.env.GAIA_CHILD_ADDRESS_MODE;
    expect(resolveChildAddressMode(true)).toBe("network");
    expect(resolveChildAddressMode(false)).toBe("loopback");
  });

  it("allows the runtime to override auto-detection", () => {
    process.env.GAIA_CHILD_ADDRESS_MODE = "loopback";
    expect(resolveChildAddressMode(true)).toBe("loopback");
    process.env.GAIA_CHILD_ADDRESS_MODE = "network";
    expect(resolveChildAddressMode(false)).toBe("network");
  });

  it("rejects an unknown explicit mode rather than guessing", () => {
    process.env.GAIA_CHILD_ADDRESS_MODE = "public";
    expect(() => resolveChildAddressMode(false)).toThrow(
      /must be "network" or "loopback"/,
    );
  });

  it("resolves both transports from the same registry entry", () => {
    const entry = { id: "twitter", containerPort: 7440 };
    expect(resolveChildAddress(entry, "network")).toEqual({
      hostname: "gaia-twitter",
      port: 8080,
    });
    expect(resolveChildAddress(entry, "loopback")).toEqual({
      hostname: "127.0.0.1",
      port: 7440,
    });
  });

  it("builds host-run base URLs through the shared resolver", () => {
    process.env.GAIA_CHILD_ADDRESS_MODE = "loopback";
    expect(childBaseUrl({ id: "twitter", containerPort: 7440 })).toBe(
      "http://127.0.0.1:7440",
    );
  });

  it("requires the child's published port as its running marker", () => {
    expect(() =>
      resolveChildAddress({ id: "twitter", containerPort: undefined }, "network"),
    ).toThrow(/not running/);
  });
});
