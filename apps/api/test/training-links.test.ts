import assert from "node:assert/strict";
import test from "node:test";
import { prepareTrainingBroadcast, trainingBroadcastMessage, trainingLinkReply, trainingUrl } from "../src/training-links.js";

test("guide commands route public, role-specific, combined and admin training", () => {
  assert.equal(trainingLinkReply("add guide book"), null);
  assert.match(trainingLinkReply(" GUIDE ")!, /\/guide\/retailer/);
  assert.match(trainingLinkReply("/guide", ["Warehouse Manager"])!, /\/guide\/warehouse-manager/);
  assert.match(trainingLinkReply("guide sell", ["Sales"])!, /\/guide\/sales/);
  assert.doesNotMatch(trainingLinkReply("guide admin", ["Sales"])!, /https:/);
  assert.doesNotMatch(trainingLinkReply("guide delivery+collection", ["Delivery"])!, /https:/);
  assert.match(trainingLinkReply("guide delivery+collection", ["Delivery", "Collection Agent"])!, /\/guide\/delivery-collection/);
  assert.match(trainingLinkReply("guide", ["Sales"], true)!, /\/guide\n/);
  assert.match(trainingLinkReply("guide", ["Admin"])!, /\/guide\n/);
  assert.match(trainingLinkReply("guide retailer", ["Accounts"])!, /\/guide\/retailer/);
});

test("training broadcasts cannot silently send templates without the training URL", () => {
  assert.equal(prepareTrainingBroadcast({ training: true, message: "ignored" }).message, trainingBroadcastMessage());
  assert.throws(() => prepareTrainingBroadcast({ training: true, message: "", templateName: "festival", templateParameters: ["{retailer}"] }), /guide_link/);
  assert.throws(() => prepareTrainingBroadcast({ training: true, message: "", templateName: "festival", templateParameters: [] }), /guide_link/);
  assert.throws(() => prepareTrainingBroadcast({ training: true, message: "", templateName: "training", templateParameters: ["x".repeat(1024) + "{guide_link}"] }), /guide_link/);
  const result = prepareTrainingBroadcast({ training: true, message: "", templateName: "training", templateParameters: ["{retailer}", "{guide_link}"] });
  assert.deepEqual(result.parameters, ["{retailer}", trainingUrl("retailer")]);
  assert.equal(prepareTrainingBroadcast({ message: " Regular announcement " }).message, "Regular announcement");
});
