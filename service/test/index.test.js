import assert from "node:assert/strict";
import { test } from "node:test";

import { createHealthHandler } from "../index.js";

const resSpy = () => {
  const res = {
    statusCode: null,
    body: null,
    status(code) {
      this.statusCode = code;
      return this;
    },
    json(payload) {
      this.body = payload;
      return this;
    },
  };
  return res;
};

test("createHealthHandler returns 200 when all namespaces are healthy", async () => {
  const handler = createHealthHandler({
    config: () => ({ storefront: { endpoints: [] }, search: { endpoints: [] } }),
    checker: async (namespaces) => ({
      status: "healthy",
      upPercentage: 100,
      timestamp: "2026-01-01T00:00:00.000Z",
      namespaces,
    }),
  });

  const res = resSpy();
  const returned = await handler({ method: "GET" }, res);

  assert.equal(returned.statusCode, 200);
  assert.equal(res.statusCode, 200);
  assert.equal(res.body.status, "healthy");
  assert.equal(res.body.upPercentage, 100);
});

test("createHealthHandler returns 503 when any namespace is unhealthy", async () => {
  const handler = createHealthHandler({
    config: () => ({ storefront: { endpoints: [] }, search: { endpoints: [] } }),
    checker: async () => ({
      status: "unhealthy",
      upPercentage: 50,
      timestamp: "2026-01-01T00:00:00.000Z",
      namespaces: {},
    }),
  });

  const res = resSpy();
  await handler({ method: "GET" }, res);

  assert.equal(res.statusCode, 503);
  assert.equal(res.body.status, "unhealthy");
});

test("createHealthHandler rejects non-GET methods with 405", async () => {
  let checkerCalled = false;
  const handler = createHealthHandler({
    config: () => ({}),
    checker: async () => {
      checkerCalled = true;
      return {};
    },
  });

  const res = resSpy();
  const returned = await handler({ method: "POST" }, res);

  assert.equal(returned.statusCode, 405);
  assert.deepEqual(res.body, { error: "Method not allowed" });
  assert.equal(checkerCalled, false);
});

test("createHealthHandler passes the config into the checker", async () => {
  const config = () => ({ storefront: { endpoints: ["http://a"] }, search: { endpoints: [] } });
  let received;
  const handler = createHealthHandler({
    config,
    checker: async (namespaces) => {
      received = namespaces;
      return {
        status: "healthy",
        upPercentage: 100,
        timestamp: "2026-01-01T00:00:00.000Z",
        namespaces,
      };
    },
  });

  const res = resSpy();
  await handler({ method: "GET" }, res);

  assert.deepEqual(received, config());
});