import { describe, it, expect, vi } from "vitest";
import type { IncomingMessage } from "node:http";
import type { AuthProvider, UserContext } from "../types.js";
import { compositeAuth } from "./composite-auth.js";

function provider(name: string, user: UserContext | null): AuthProvider {
  return { name, authenticate: vi.fn(async () => user) };
}
const req = {} as IncomingMessage;

describe("compositeAuth", () => {
  it("returns the first provider's user when it authenticates", async () => {
    const jwtUser = { userId: "sub-1", provider: "oauth" as const };
    const auth = compositeAuth("jwt+bearer", [
      provider("jwt", jwtUser),
      provider("bearer", { userId: "bearer-user" }),
    ]);
    expect(await auth.authenticate(req)).toEqual(jwtUser);
  });

  it("falls through to the next provider when the first declines", async () => {
    const bearerUser = { userId: "bearer-user", provider: "oauth" as const };
    const second = provider("bearer", bearerUser);
    const auth = compositeAuth("jwt+bearer", [provider("jwt", null), second]);
    expect(await auth.authenticate(req)).toEqual(bearerUser);
    expect(second.authenticate).toHaveBeenCalled();
  });

  it("returns null when every provider declines", async () => {
    const auth = compositeAuth("x", [provider("a", null), provider("b", null)]);
    expect(await auth.authenticate(req)).toBeNull();
  });

  it("does not call later providers once one succeeds", async () => {
    const second = provider("bearer", { userId: "bearer-user" });
    const auth = compositeAuth("x", [
      provider("jwt", { userId: "sub-1" }),
      second,
    ]);
    await auth.authenticate(req);
    expect(second.authenticate).not.toHaveBeenCalled();
  });
});
