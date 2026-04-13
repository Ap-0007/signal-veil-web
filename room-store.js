class RoomStore {
  constructor({ messageLimit = 100, roomTtlMs = 6 * 60 * 60 * 1000 } = {}) {
    this.messageLimit = messageLimit;
    this.roomTtlMs = roomTtlMs;
    this.rooms = new Map();
  }

  join(roomId, clientId, sink) {
    const room = this.#getOrCreate(roomId);
    room.clients.set(clientId, sink);
    room.lastSeenAt = Date.now();
    return room.clients.size;
  }

  leave(roomId, clientId) {
    const room = this.rooms.get(roomId);
    if (!room) {
      return 0;
    }
    room.clients.delete(clientId);
    room.lastSeenAt = Date.now();
    if (room.clients.size === 0 && room.messages.length === 0) {
      this.rooms.delete(roomId);
      return 0;
    }
    return room.clients.size;
  }

  appendMessage(roomId, envelope) {
    const room = this.#getOrCreate(roomId);
    room.messages.push(envelope);
    if (room.messages.length > this.messageLimit) {
      room.messages.splice(0, room.messages.length - this.messageLimit);
    }
    room.lastSeenAt = Date.now();
    return envelope;
  }

  getMessages(roomId) {
    const room = this.rooms.get(roomId);
    if (!room) {
      return [];
    }
    room.lastSeenAt = Date.now();
    return room.messages.slice();
  }

  getParticipantCount(roomId) {
    const room = this.rooms.get(roomId);
    return room ? room.clients.size : 0;
  }

  broadcast(roomId, event, payload) {
    const room = this.rooms.get(roomId);
    if (!room) {
      return 0;
    }
    let delivered = 0;
    for (const sink of room.clients.values()) {
      sink(event, payload);
      delivered += 1;
    }
    room.lastSeenAt = Date.now();
    return delivered;
  }

  sweepExpired(now = Date.now()) {
    let removed = 0;
    for (const [roomId, room] of this.rooms.entries()) {
      const isExpired = now - room.lastSeenAt > this.roomTtlMs;
      if (isExpired && room.clients.size === 0) {
        this.rooms.delete(roomId);
        removed += 1;
      }
    }
    return removed;
  }

  #getOrCreate(roomId) {
    let room = this.rooms.get(roomId);
    if (!room) {
      room = {
        clients: new Map(),
        messages: [],
        lastSeenAt: Date.now()
      };
      this.rooms.set(roomId, room);
    }
    return room;
  }
}

module.exports = {
  RoomStore
};
