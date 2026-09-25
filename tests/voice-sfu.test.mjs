import test from "node:test";
import assert from "node:assert/strict";

import { normalizeVoiceTargets } from "../src/voice-sfu.js";

test("VoiceSFU mantém somente membros remotos ativos na call", () => {
  const result = normalizeVoiceTargets([
    { clientId: "client-self", peerId: "peer-self", inVoice: true },
    { clientId: "client-b", peerId: "peer-b", name: "B", inVoice: true },
    { clientId: "client-b", peerId: "peer-b-new", name: "B2", inVoice: true },
    { clientId: "client-c", peerId: "peer-c", inVoice: false },
    { clientId: "client-d", peerId: "peer-d", inVoice: true, offlineSnapshot: true },
  ], "client-self");

  assert.deepEqual(result.map((item) => item.clientId), ["client-b"]);
  assert.equal(result[0].peerId, "peer-b-new");
});
