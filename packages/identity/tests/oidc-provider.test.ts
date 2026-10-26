import http from "node:http";
import { afterEach, describe, expect, it } from "vitest";
import { exportJWK, generateKeyPair, SignJWT } from "jose";
import {
  createOidcJwtIdentityProviderFromEnv,
  OidcJwtIdentityProvider,
  tokenFromRequest
} from "../src/oidc-provider.js";

const servers: http.Server[] = [];

afterEach(async () => {
  await Promise.all(
    servers.map(
      (server) =>
        new Promise<void>((resolve) => {
          server.close(() => resolve());
        })
    )
  );
  servers.length = 0;
});

describe("OidcJwtIdentityProvider", () => {
  it("verifies a standard OIDC JWT from a JWKS endpoint", async () => {
    const issuer = "https://issuer.example.test";
    const audience = "operator-web";
    const { publicKey, privateKey } = await generateKeyPair("RS256", { extractable: true });
    const publicJwk = await exportJWK(publicKey);
    const keyId = "operator-test-key";
    const jwksUri = await serveJwks({ keys: [{ ...publicJwk, kid: keyId, alg: "RS256", use: "sig" }] });
    const token = await new SignJWT({
      email: "owner@example.com",
      name: "Owner User",
      picture: "https://example.test/avatar.png"
    })
      .setProtectedHeader({ alg: "RS256", kid: keyId })
      .setIssuer(issuer)
      .setAudience(audience)
      .setSubject("oidc-subject-1")
      .setExpirationTime("1h")
      .sign(privateKey);

    const provider = new OidcJwtIdentityProvider({ issuer, audience, jwksUri });
    const session = await provider.getSession(new Request("https://operator.test", { headers: { authorization: `Bearer ${token}` } }));

    expect(session?.user).toMatchObject({
      id: "oidc-subject-1",
      email: "owner@example.com",
      displayName: "Owner User",
      avatarUrl: "https://example.test/avatar.png"
    });
  });

  it("extracts bearer and cookie tokens from requests", () => {
    expect(tokenFromRequest(new Request("https://operator.test", { headers: { authorization: "Bearer abc" } }))).toBe("abc");
    expect(tokenFromRequest(new Request("https://operator.test", { headers: { cookie: "operator_identity_token=xyz" } }))).toBe("xyz");
  });

  it("creates a provider only when OIDC configuration is complete", () => {
    expect(createOidcJwtIdentityProviderFromEnv({})).toBeNull();
    expect(
      createOidcJwtIdentityProviderFromEnv({
        OPERATOR_OIDC_ISSUER: "https://issuer.example.test",
        OPERATOR_OIDC_AUDIENCE: "operator-web",
        OPERATOR_OIDC_JWKS_URI: "https://issuer.example.test/.well-known/jwks.json"
      })
    ).toBeInstanceOf(OidcJwtIdentityProvider);
  });
});

function serveJwks(jwks: { keys: unknown[] }): Promise<string> {
  const server = http.createServer((_req, res) => {
    const body = JSON.stringify(jwks);
    res.writeHead(200, {
      "content-type": "application/json",
      "content-length": Buffer.byteLength(body)
    });
    res.end(body);
  });
  servers.push(server);
  return new Promise((resolve) => {
    server.listen(0, "127.0.0.1", () => {
      const address = server.address();
      if (!address || typeof address === "string") throw new Error("Failed to bind JWKS test server.");
      resolve(`http://127.0.0.1:${address.port}/jwks.json`);
    });
  });
}
