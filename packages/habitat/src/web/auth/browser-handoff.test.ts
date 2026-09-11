import { describe, expect, it, vi } from "vitest";
import {
  HABITAT_SESSION_COOKIE,
  browserLoginUrl,
  redeemBrowserHandoff,
  safeReturnPath,
  sessionCookie,
} from "./browser-handoff.js";

const config = {
  issuer: "https://habitats.example",
  audience: "https://child.example",
  habitatId: "research",
  credential: "child-secret",
};

describe("browser login handoff", () => {
  it("preserves a deep link but never forwards legacy URL credentials", () => {
    const url = new URL(
      browserLoginUrl(
        config,
        "/shell/solo/status/?panel=usage&token=secret#details",
      )!,
    );
    expect(url.origin + url.pathname).toBe(
      "https://habitats.example/auth/handoff",
    );
    expect(url.searchParams.get("habitat_id")).toBe("research");
    expect(url.searchParams.get("return_to")).toBe(
      "/shell/solo/status/?panel=usage#details",
    );
    expect(url.toString()).not.toContain("secret");
    for (const unsafe of [
      "https://evil.example",
      "//evil.example",
      "/\\evil",
      "relative",
    ]) {
      expect(browserLoginUrl(config, unsafe)).toBeNull();
    }
  });

  it("redeems the opaque code server-to-server with exact child binding", async () => {
    const fetch = vi.fn().mockResolvedValue(
      new Response(
        JSON.stringify({
          access_token: "signed.jwt.value",
          token_type: "Bearer",
          expires_in: 300,
          return_to: "/shell/",
        }),
        { status: 200, headers: { "content-type": "application/json" } },
      ),
    );

    await expect(
      redeemBrowserHandoff("one-time-code", config, fetch),
    ).resolves.toEqual({
      ok: true,
      accessToken: "signed.jwt.value",
      expiresIn: 300,
      returnPath: "/shell/",
    });
    const [url, init] = fetch.mock.calls[0] as [URL, RequestInit];
    expect(url.toString()).toBe(
      "https://habitats.example/api/auth/handoff/exchange",
    );
    expect(init.headers).toMatchObject({
      authorization: "Bearer child-secret",
    });
    expect(JSON.parse(String(init.body))).toEqual({
      code: "one-time-code",
      habitat_id: "research",
      audience: "https://child.example",
    });
  });

  it("rejects unsafe redirects and overlong sessions from the issuer", async () => {
    const fetch = vi.fn().mockResolvedValue(
      new Response(
        JSON.stringify({
          access_token: "signed.jwt.value",
          expires_in: 301,
          return_to: "https://evil.example",
        }),
        { status: 200, headers: { "content-type": "application/json" } },
      ),
    );
    await expect(
      redeemBrowserHandoff("code", config, fetch),
    ).resolves.toMatchObject({
      ok: false,
      status: 502,
    });
  });

  it("uses an HttpOnly secure host cookie and keeps paths same-origin", () => {
    expect(sessionCookie("signed.jwt.value", 300)).toBe(
      `${HABITAT_SESSION_COOKIE}=signed.jwt.value; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=300`,
    );
    expect(safeReturnPath("/shell/?panel=status#top")).toBe(
      "/shell/?panel=status#top",
    );
    for (const unsafe of [
      "https://evil.example",
      "//evil.example",
      "/\\evil",
    ]) {
      expect(safeReturnPath(unsafe)).toBeNull();
    }
  });
});
