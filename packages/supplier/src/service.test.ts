/**
 * The service unit. Text in, text out — the value is in what it does not omit.
 */

import { describe, it, expect } from "vitest";
import { defaultServiceKind, launchdPlist, renderService, systemdUnit } from "./service.js";

const OPTS = { command: "/usr/local/bin/umwelten", supplierDir: "/var/lib/umwelten/supplier" };

describe("systemdUnit", () => {
  it("resumes rather than expecting someone to pass a credential at boot", () => {
    // A machine coming back from a power cut has nobody at the keyboard.
    expect(systemdUnit(OPTS)).toContain("supplier serve --resume");
  });

  it("waits for the network", () => {
    // The agent talks to the Exchange and may pull weights. Starting first
    // costs a failed start and a restart delay.
    expect(systemdUnit(OPTS)).toContain("After=network-online.target");
  });

  it("gives the agent time to withdraw before the machine goes down", () => {
    // A supplier that vanishes leaves the Exchange routing into nothing until
    // its Offers expire.
    const unit = systemdUnit(OPTS);
    expect(unit).toContain("KillSignal=SIGTERM");
    expect(unit).toMatch(/TimeoutStopSec=\d+/);
  });

  it("restarts on failure, with a delay so a broken agent does not spin", () => {
    const unit = systemdUnit(OPTS);
    expect(unit).toContain("Restart=always");
    expect(unit).toMatch(/RestartSec=[1-9]\d*/);
  });

  it("points the agent at the directory holding its configuration", () => {
    expect(systemdUnit(OPTS)).toContain("UMWELTEN_SUPPLIER_DIR=/var/lib/umwelten/supplier");
  });

  it("only sets a user when asked", () => {
    expect(systemdUnit(OPTS)).not.toContain("User=");
    expect(systemdUnit({ ...OPTS, user: "umwelten" })).toContain("User=umwelten");
  });
});

describe("launchdPlist", () => {
  it("resumes and comes back at load", () => {
    const plist = launchdPlist(OPTS);
    expect(plist).toContain("<string>--resume</string>");
    expect(plist).toContain("<key>RunAtLoad</key>");
    expect(plist).toContain("<key>KeepAlive</key>");
  });

  it("splits a multi-word command into separate arguments", () => {
    // `pnpm run cli` is three arguments, and launchd does not run a shell.
    const plist = launchdPlist({ ...OPTS, command: "node /opt/umwelten/cli.js" });
    expect(plist).toContain("<string>node</string>");
    expect(plist).toContain("<string>/opt/umwelten/cli.js</string>");
  });

  it("throttles restarts and allows time to withdraw", () => {
    const plist = launchdPlist(OPTS);
    expect(plist).toMatch(/<key>ThrottleInterval<\/key>\s*<integer>[1-9]\d*<\/integer>/);
    expect(plist).toMatch(/<key>ExitTimeOut<\/key>\s*<integer>[1-9]\d*<\/integer>/);
  });
});

describe("defaultServiceKind", () => {
  it("picks what the platform actually has", () => {
    expect(defaultServiceKind("linux")).toBe("systemd");
    expect(defaultServiceKind("darwin")).toBe("launchd");
  });

  it("declines to guess elsewhere", () => {
    expect(defaultServiceKind("win32")).toBeUndefined();
  });
});

describe("renderService", () => {
  it("dispatches on the kind", () => {
    expect(renderService("systemd", OPTS)).toContain("[Unit]");
    expect(renderService("launchd", OPTS)).toContain("<plist");
  });
});
