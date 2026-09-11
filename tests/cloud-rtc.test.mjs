import test from "node:test";
import assert from "node:assert/strict";

import { shouldInitiateCloudRtc } from "../src/cloud-rtc.js";

test("CloudRTC escolhe um único iniciador estável pela identidade do cliente", () => {
  assert.equal(shouldInitiateCloudRtc("client-a", "client-b"), true);
  assert.equal(shouldInitiateCloudRtc("client-b", "client-a"), false);
  assert.equal(shouldInitiateCloudRtc("client-a", "client-a"), false);
});

test("CloudRTC ignora identidades vazias", () => {
  assert.equal(shouldInitiateCloudRtc("", "client-b"), false);
  assert.equal(shouldInitiateCloudRtc("client-a", ""), false);
});
