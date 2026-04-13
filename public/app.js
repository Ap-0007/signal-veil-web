const aliasInput = document.getElementById("aliasInput");
const roomInput = document.getElementById("roomInput");
const secretInput = document.getElementById("secretInput");
const statusText = document.getElementById("statusText");
const presenceText = document.getElementById("presenceText");
const roomTitle = document.getElementById("roomTitle");
const inviteHint = document.getElementById("inviteHint");
const messages = document.getElementById("messages");
const messageInput = document.getElementById("messageInput");
const sendButton = document.getElementById("sendButton");
const joinRoomButton = document.getElementById("joinRoomButton");
const createRoomButton = document.getElementById("createRoomButton");
const copyInviteButton = document.getElementById("copyInviteButton");
const rotateAliasButton = document.getElementById("rotateAliasButton");
const composer = document.getElementById("composer");
const messageTemplate = document.getElementById("messageTemplate");

const state = {
  alias: window.localStorage.getItem("signal-veil-alias") || generateAlias(),
  clientId: randomHex(10),
  roomId: "",
  roomSecret: "",
  cryptoKey: null,
  eventSource: null,
  seenMessages: new Set()
};

aliasInput.value = state.alias;
hydrateFromHash();
bindEvents();
renderStatus("Idle. Create or join a room.");
renderPresence(0);
if (state.roomId && state.roomSecret) {
  joinCurrentRoom();
}

function bindEvents() {
  createRoomButton.addEventListener("click", () => {
    roomInput.value = generateRoomCode();
    secretInput.value = generateSecret();
    joinCurrentRoom();
  });

  joinRoomButton.addEventListener("click", () => {
    joinCurrentRoom();
  });

  copyInviteButton.addEventListener("click", async () => {
    syncAlias();
    const roomId = normalizedRoom();
    const roomSecret = normalizedSecret();
    if (!roomId || !roomSecret) {
      renderStatus("Set a room code and room secret first.", true);
      return;
    }
    const inviteUrl = buildInviteUrl(roomId, roomSecret);
    await navigator.clipboard.writeText(inviteUrl);
    renderStatus("Invite link copied. The secret is kept in the URL fragment.");
  });

  rotateAliasButton.addEventListener("click", () => {
    state.alias = generateAlias();
    aliasInput.value = state.alias;
    syncAlias();
    renderStatus("Alias rotated locally.");
  });

  aliasInput.addEventListener("change", syncAlias);
  composer.addEventListener("submit", async (event) => {
    event.preventDefault();
    await sendMessage();
  });
}

async function joinCurrentRoom() {
  syncAlias();
  const roomId = normalizedRoom();
  const roomSecret = normalizedSecret();
  if (!roomId || !roomSecret) {
    renderStatus("Room code and room secret are required.", true);
    return;
  }

  state.roomId = roomId;
  state.roomSecret = roomSecret;
  state.cryptoKey = await deriveRoomKey(roomSecret, roomId);
  state.seenMessages.clear();
  messages.replaceChildren();
  setComposerEnabled(true);
  roomTitle.textContent = `Room ${roomId}`;
  inviteHint.textContent = "Invite link ready. The hash carries the room secret.";
  window.location.hash = new URLSearchParams({ room: roomId, key: roomSecret }).toString();
  await loadHistory(roomId);
  openStream(roomId);
  renderStatus("Secure room joined. Messages will decrypt locally.");
}

function openStream(roomId) {
  if (state.eventSource) {
    state.eventSource.close();
  }
  const streamUrl = `/api/rooms/${encodeURIComponent(roomId)}/stream?clientId=${encodeURIComponent(state.clientId)}`;
  state.eventSource = new EventSource(streamUrl);

  state.eventSource.addEventListener("welcome", (event) => {
    const payload = JSON.parse(event.data);
    renderPresence(payload.participantCount);
  });

  state.eventSource.addEventListener("presence", (event) => {
    const payload = JSON.parse(event.data);
    renderPresence(payload.participantCount);
  });

  state.eventSource.addEventListener("message", async (event) => {
    const envelope = JSON.parse(event.data);
    await renderEnvelope(envelope);
  });

  state.eventSource.onerror = () => {
    renderStatus("Realtime link interrupted. Reconnecting…", true);
  };
}

async function loadHistory(roomId) {
  const response = await fetch(`/api/rooms/${encodeURIComponent(roomId)}/history`);
  if (!response.ok) {
    renderStatus("Could not load room history.", true);
    return;
  }
  const payload = await response.json();
  renderPresence(payload.participantCount);
  for (const envelope of payload.messages) {
    await renderEnvelope(envelope);
  }
}

async function sendMessage() {
  const text = messageInput.value.trim();
  if (!text || !state.cryptoKey || !state.roomId) {
    return;
  }

  const plaintext = JSON.stringify({
    alias: state.alias,
    text,
    sentAt: new Date().toISOString()
  });
  const encrypted = await encryptMessage(plaintext, state.cryptoKey);

  const response = await fetch(`/api/rooms/${encodeURIComponent(state.roomId)}/messages`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json"
    },
    body: JSON.stringify({
      clientId: state.clientId,
      nonce: encrypted.nonce,
      ciphertext: encrypted.ciphertext
    })
  });

  if (!response.ok) {
    renderStatus("Message relay failed.", true);
    return;
  }

  messageInput.value = "";
  renderStatus("Encrypted message sent.");
}

async function renderEnvelope(envelope) {
  if (state.seenMessages.has(envelope.id)) {
    return;
  }
  state.seenMessages.add(envelope.id);

  try {
    const decrypted = await decryptMessage(envelope, state.cryptoKey);
    const payload = JSON.parse(decrypted);
    renderMessageCard({
      alias: payload.alias || "Anonymous",
      text: payload.text || "",
      time: payload.sentAt || envelope.createdAt,
      isSystem: false
    });
  } catch {
    renderMessageCard({
      alias: "Cipher",
      text: "Unable to decrypt this message with the current room secret.",
      time: envelope.createdAt,
      isSystem: true
    });
  }
}

function renderMessageCard({ alias, text, time, isSystem }) {
  const fragment = messageTemplate.content.cloneNode(true);
  const card = fragment.querySelector(".message-card");
  const aliasNode = fragment.querySelector(".message-alias");
  const timeNode = fragment.querySelector(".message-time");
  const bodyNode = fragment.querySelector(".message-body");

  aliasNode.textContent = alias;
  timeNode.textContent = new Date(time).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
  bodyNode.textContent = text;
  if (isSystem) {
    card.classList.add("system");
  }
  messages.appendChild(fragment);
  messages.scrollTop = messages.scrollHeight;
}

function renderStatus(text, isWarning = false) {
  statusText.textContent = text;
  statusText.style.color = isWarning ? "var(--danger)" : "var(--ink)";
}

function renderPresence(participantCount) {
  const noun = participantCount === 1 ? "participant" : "participants";
  presenceText.textContent = `${participantCount} ${noun}`;
}

function setComposerEnabled(enabled) {
  messageInput.disabled = !enabled;
  sendButton.disabled = !enabled;
}

function syncAlias() {
  const alias = aliasInput.value.trim() || generateAlias();
  state.alias = alias;
  aliasInput.value = alias;
  window.localStorage.setItem("signal-veil-alias", alias);
}

function normalizedRoom() {
  const roomId = roomInput.value.trim().toLowerCase().replace(/[^a-z0-9-]/g, "");
  roomInput.value = roomId;
  return roomId;
}

function normalizedSecret() {
  const secret = secretInput.value.trim();
  secretInput.value = secret;
  return secret;
}

function buildInviteUrl(roomId, roomSecret) {
  const hash = new URLSearchParams({ room: roomId, key: roomSecret }).toString();
  return `${window.location.origin}${window.location.pathname}#${hash}`;
}

function hydrateFromHash() {
  if (!window.location.hash) {
    roomInput.value = generateRoomCode();
    secretInput.value = generateSecret();
    return;
  }
  const params = new URLSearchParams(window.location.hash.slice(1));
  roomInput.value = params.get("room") || generateRoomCode();
  secretInput.value = params.get("key") || generateSecret();
}

function generateAlias() {
  const prefixes = ["Silent", "Amber", "Velvet", "Cipher", "Lunar", "Drift", "Onyx", "Mellow"];
  const suffixes = ["Harbor", "Signal", "Comet", "Otter", "Beacon", "Quartz", "Nova", "Echo"];
  const prefix = prefixes[Math.floor(Math.random() * prefixes.length)];
  const suffix = suffixes[Math.floor(Math.random() * suffixes.length)];
  return `${prefix} ${suffix}-${randomHex(2).toUpperCase()}`;
}

function generateRoomCode() {
  return `veil-${randomHex(3)}`;
}

function generateSecret() {
  const bytes = new Uint8Array(18);
  crypto.getRandomValues(bytes);
  return toBase64Url(bytes);
}

function randomHex(byteCount) {
  const bytes = new Uint8Array(byteCount);
  crypto.getRandomValues(bytes);
  return Array.from(bytes, (value) => value.toString(16).padStart(2, "0")).join("");
}

async function deriveRoomKey(secret, roomId) {
  const encoder = new TextEncoder();
  const baseKey = await crypto.subtle.importKey(
    "raw",
    encoder.encode(secret),
    { name: "PBKDF2" },
    false,
    ["deriveKey"]
  );
  return crypto.subtle.deriveKey(
    {
      name: "PBKDF2",
      salt: encoder.encode(roomId),
      iterations: 250000,
      hash: "SHA-256"
    },
    baseKey,
    {
      name: "AES-GCM",
      length: 256
    },
    false,
    ["encrypt", "decrypt"]
  );
}

async function encryptMessage(plaintext, cryptoKey) {
  const encoder = new TextEncoder();
  const nonce = new Uint8Array(12);
  crypto.getRandomValues(nonce);
  const ciphertext = await crypto.subtle.encrypt(
    {
      name: "AES-GCM",
      iv: nonce
    },
    cryptoKey,
    encoder.encode(plaintext)
  );
  return {
    nonce: toBase64Url(nonce),
    ciphertext: toBase64Url(new Uint8Array(ciphertext))
  };
}

async function decryptMessage(envelope, cryptoKey) {
  const plaintext = await crypto.subtle.decrypt(
    {
      name: "AES-GCM",
      iv: fromBase64Url(envelope.nonce)
    },
    cryptoKey,
    fromBase64Url(envelope.ciphertext)
  );
  return new TextDecoder().decode(plaintext);
}

function toBase64Url(bytes) {
  const binary = Array.from(bytes, (byte) => String.fromCharCode(byte)).join("");
  return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/g, "");
}

function fromBase64Url(value) {
  const base64 = value.replace(/-/g, "+").replace(/_/g, "/");
  const padding = "=".repeat((4 - (base64.length % 4)) % 4);
  const binary = atob(base64 + padding);
  return Uint8Array.from(binary, (char) => char.charCodeAt(0));
}
