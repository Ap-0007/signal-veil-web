const test = require("node:test");
const assert = require("node:assert/strict");
const { RoomStore } = require("../lib/room-store");

test("room store trims messages to limit", () => {
  const store = new RoomStore({ messageLimit: 2 });
  store.appendMessage("veil-room", { id: "1" });
  store.appendMessage("veil-room", { id: "2" });
  store.appendMessage("veil-room", { id: "3" });

  assert.deepEqual(store.getMessages("veil-room"), [{ id: "2" }, { id: "3" }]);
});

test("room store tracks join and leave counts", () => {
  const store = new RoomStore();
  const sink = () => {};

  assert.equal(store.join("veil-room", "clienta123", sink), 1);
  assert.equal(store.join("veil-room", "clientb456", sink), 2);
  assert.equal(store.leave("veil-room", "clienta123"), 1);
  assert.equal(store.getParticipantCount("veil-room"), 1);
});

test("room store sweeps only expired empty rooms", () => {
  const store = new RoomStore({ roomTtlMs: 1000 });
  store.appendMessage("room-old", { id: "1" });
  store.leave("room-old", "missing");

  store.rooms.set("room-empty", {
    clients: new Map(),
    messages: [],
    lastSeenAt: 1
  });

  const removed = store.sweepExpired(5000);
  assert.equal(removed, 1);
  assert.equal(store.rooms.has("room-empty"), false);
  assert.equal(store.rooms.has("room-old"), true);
});
