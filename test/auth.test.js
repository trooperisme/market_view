import test from "node:test";
import assert from "node:assert/strict";
import { isAuthConfigured, isAuthorizedHeader, parseBasicAuth } from "../src/auth.js";

function basic(user, password) {
  return `Basic ${Buffer.from(`${user}:${password}`).toString("base64")}`;
}

test("parses basic auth credentials", () => {
  assert.deepEqual(parseBasicAuth(basic("admin", "secret")), {
    user: "admin",
    password: "secret",
  });
  assert.equal(parseBasicAuth("Bearer token"), null);
});

test("authorizes only configured matching credentials", () => {
  const oldUser = process.env.MARKET_VIEW_USER;
  const oldPassword = process.env.MARKET_VIEW_PASSWORD;
  process.env.MARKET_VIEW_USER = "admin";
  process.env.MARKET_VIEW_PASSWORD = "secret";

  try {
    assert.equal(isAuthConfigured(), true);
    assert.equal(isAuthorizedHeader(basic("admin", "secret")), true);
    assert.equal(isAuthorizedHeader(basic("admin", "wrong")), false);
  } finally {
    if (oldUser === undefined) delete process.env.MARKET_VIEW_USER;
    else process.env.MARKET_VIEW_USER = oldUser;
    if (oldPassword === undefined) delete process.env.MARKET_VIEW_PASSWORD;
    else process.env.MARKET_VIEW_PASSWORD = oldPassword;
  }
});
