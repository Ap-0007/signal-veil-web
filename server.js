const http = require("node:http");
const fs = require("node:fs");
const path = require("node:path");
const crypto = require("node:crypto");
const { URL } = require("node:url");
const { RoomStore } = require("./lib/room-store");

const PORT = parseInt(process.env.PORT || "8080", 10);
const HOST = process.env.HOST || "127.0.0.1";
const PUBLIC_DIR = path.join(__dirname, "public");
const roomStore = new RoomStore();
const staticCache = new Map();

const CONTENT_TYPES = {
  ".css": "text/css; charset=utf-8",
  ".html": "text/html; charset=utf-8",
  ".js": "application/javascript; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".svg": "image/svg+xml"
};

const server = http.createServer(async (req, res) => {
  try {
    const requestUrl = new URL(req.url, `http://${req.headers.host || "localhost"}`);
    const pathname = requestUrl.pathname;

    if (req.method === "GET" && pathname === "/health") {
      return sendJson(res, 200, {
        ok: true,
        uptimeSeconds: Math.round(process.uptime()),
        rooms: roomStore.rooms.size
      });
    }

    const roomHistoryMatch = pathname.match(/^\/api\/rooms\/([^/]+)\/history$/);
    if (req.method === "GET" && roomHistoryMatch) {
      const roomId = normalizeRoomId(roomHistoryMatch[1]);
      return sendJson(res, 200, {
        roomId,
        participantCount: roomStore.getParticipantCount(roomId),
        messages: roomStore.getMessages(roomId)
      });
    }

    const roomStreamMatch = pathname.match(/^\/api\/rooms\/([^/]+)\/stream$/);
    if (req.method === "GET" && roomStreamMatch) {
      const roomId = normalizeRoomId(roomStreamMatch[1]);
      const clientId = normalizeClientId(requestUrl.searchParams.get("clientId"));
      return openEventStream(roomId, clientId, req, res);
    }

    const roomMessagesMatch = pathname.match(/^\/api\/rooms\/([^/]+)\/messages$/);
    if (req.method === "POST" && roomMessagesMatch) {
      const roomId = normalizeRoomId(roomMessagesMatch[1]);
      const body = await readJson(req);
      return acceptMessage(roomId, body, res);
    }

    if (req.method === "GET") {
      return serveStatic(pathname, res);
    }

    sendJson(res, 404, { error: "Not found" });
  } catch (error) {
    sendJson(res, error.statusCode || 500, {
      error: error.expose ? error.message : "Internal server error"
    });
  }
});

setInterval(() => {
  roomStore.sweepExpired();
}, 60 * 1000).unref();

function openEventStream(roomId, clientId, req, res) {
  res.writeHead(200, {
    "Content-Type": "text/event-stream; charset=utf-8",
    "Cache-Control": "no-cache, no-transform",
    Connection: "keep-alive",
    "X-Accel-Buffering": "no"
  });

  const sink = (event, payload) => {
    res.write(`event: ${event}\n`);
    res.write(`data: ${JSON.stringify(payload)}\n\n`);
  };

  const participantCount = roomStore.join(roomId, clientId, sink);
  sink("welcome", {
    clientId,
    roomId,
    participantCount,
    serverTime: new Date().toISOString()
  });
  roomStore.broadcast(roomId, "presence", {
    participantCount
  });

  const heartbeat = setInterval(() => {
    res.write(": keep-alive\n\n");
  }, 25 * 1000);

  req.on("close", () => {
    clearInterval(heartbeat);
    const nextCount = roomStore.leave(roomId, clientId);
    roomStore.broadcast(roomId, "presence", {
      participantCount: nextCount
    });
  });
}

function acceptMessage(roomId, body, res) {
  const clientId = normalizeClientId(body?.clientId);
  const ciphertext = normalizePayloadField(body?.ciphertext, "ciphertext");
  const nonce = normalizePayloadField(body?.nonce, "nonce");

  const envelope = {
    id: crypto.randomUUID(),
    clientId,
    ciphertext,
    nonce,
    createdAt: new Date().toISOString()
  };

  roomStore.appendMessage(roomId, envelope);
  roomStore.broadcast(roomId, "message", envelope);
  return sendJson(res, 202, {
    accepted: true,
    id: envelope.id
  });
}

function serveStatic(pathname, res) {
  const normalizedPath = pathname === "/" ? "/index.html" : pathname;
  const targetPath = path.join(PUBLIC_DIR, normalizedPath);
  if (!targetPath.startsWith(PUBLIC_DIR)) {
    return sendJson(res, 403, { error: "Forbidden" });
  }

  let payload = staticCache.get(targetPath);
  if (!payload) {
    if (!fs.existsSync(targetPath) || fs.statSync(targetPath).isDirectory()) {
      return sendJson(res, 404, { error: "Not found" });
    }
    payload = fs.readFileSync(targetPath);
    staticCache.set(targetPath, payload);
  }

  const ext = path.extname(targetPath);
  res.writeHead(200, {
    "Content-Type": CONTENT_TYPES[ext] || "application/octet-stream"
  });
  res.end(payload);
}

function sendJson(res, statusCode, payload) {
  res.writeHead(statusCode, {
    "Content-Type": "application/json; charset=utf-8"
  });
  res.end(JSON.stringify(payload));
}

function readJson(req) {
  return new Promise((resolve, reject) => {
    let raw = "";
    req.on("data", (chunk) => {
      raw += chunk;
      if (raw.length > 1024 * 1024) {
        reject(createHttpError(413, "Payload too large"));
        req.destroy();
      }
    });
    req.on("end", () => {
      try {
        resolve(raw ? JSON.parse(raw) : {});
      } catch {
        reject(createHttpError(400, "Malformed JSON"));
      }
    });
    req.on("error", reject);
  });
}

function normalizeRoomId(roomId) {
  const value = String(roomId || "").trim().toLowerCase();
  if (!/^[a-z0-9-]{4,40}$/.test(value)) {
    throw createHttpError(400, "Invalid room code");
  }
  return value;
}

function normalizeClientId(clientId) {
  const value = String(clientId || "").trim().toLowerCase();
  if (!/^[a-z0-9]{8,64}$/.test(value)) {
    throw createHttpError(400, "Invalid client id");
  }
  return value;
}

function normalizePayloadField(value, label) {
  const normalized = String(value || "").trim();
  if (!/^[A-Za-z0-9_-]{8,4000}$/.test(normalized)) {
    throw createHttpError(400, `Invalid ${label}`);
  }
  return normalized;
}

function createHttpError(statusCode, message) {
  const error = new Error(message);
  error.statusCode = statusCode;
  error.expose = true;
  return error;
}

server.listen(PORT, HOST, () => {
  console.log(`anon-web-chat listening on http://${HOST}:${PORT}`);
});

module.exports = {
  server,
  roomStore
};
