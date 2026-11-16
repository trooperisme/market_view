import test from "node:test";
import assert from "node:assert/strict";

test("Vercel API modules import without missing dependencies", async () => {
  const modules = await Promise.all([
    import("../api/app.js"),
    import("../api/health.js"),
    import("../api/market-view/run.js"),
    import("../api/market-view/snapshots.js"),
    import("../api/market-view/snapshots/[id].js"),
    import("../api/market-view/snapshots/[id]/assets/[file].js"),
  ]);

  for (const module of modules) {
    assert.equal(typeof module.default, "function");
  }
});
