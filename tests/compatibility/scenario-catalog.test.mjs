import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

const directory = path.join(path.dirname(fileURLToPath(import.meta.url)), "fixtures", "reference-v0.4.0");
const catalog = JSON.parse(await readFile(path.join(directory, "scenario-catalog.json"), "utf8"));

test("Packet 000 catalogs every golden scenario exactly once", () => {
  assert.equal(catalog.fixtureVersion, "packet-000/1");
  assert.equal(catalog.referenceVersion, "0.4.0");
  assert.equal(catalog.scenarios.length, 28);
  assert.deepEqual(
    catalog.scenarios.map(({ id }) => id),
    Array.from({ length: 28 }, (_, index) => `G-${String(index + 1).padStart(3, "0")}`),
  );
  assert.equal(new Set(catalog.scenarios.map(({ id }) => id)).size, 28);
});

test("every catalog entry names evidence and does not fabricate successor-only observations", () => {
  const allowed = new Set([
    "oracle-api-automated",
    "reference-suite-observed",
    "documented-not-api-observed",
    "successor-contract-only",
    "documentation-observed",
  ]);
  for (const scenario of catalog.scenarios) {
    assert.ok(allowed.has(scenario.disposition), `${scenario.id} has an unknown disposition`);
    assert.ok(scenario.evidence.length > 20, `${scenario.id} needs a concrete evidence note`);
    if (scenario.disposition === "successor-contract-only") assert.equal(scenario.fixture, null);
  }
});

test("every referenced API fixture exists and identifies its golden scenarios", async () => {
  const fixtureNames = [...new Set(catalog.scenarios.map(({ fixture }) => fixture).filter(Boolean))];
  for (const fixtureName of fixtureNames) {
    const fixture = JSON.parse(await readFile(path.join(directory, fixtureName), "utf8"));
    assert.equal(fixture.fixtureVersion, "packet-000/1");
    assert.equal(fixture.referenceVersion, "0.4.0");
    assert.ok(fixture.requests.length > 0);
    assert.ok(fixture.goldenScenarios.length > 0);
    for (const goldenId of fixture.goldenScenarios) {
      assert.ok(catalog.scenarios.some(({ id }) => id === goldenId), `${fixtureName} refers to unknown ${goldenId}`);
    }
  }
});
