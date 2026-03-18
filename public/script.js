import { createClient } from "https://esm.sh/@anam-ai/js-sdk@latest";
import { AnamEvent } from "https://esm.sh/@anam-ai/js-sdk@latest/dist/module/types";

const MAX_RECONNECT_ATTEMPTS = 2;
const BASE_RECONNECT_DELAY_MS = 2000;

const CONNECTION_CLOSED_CODE_NORMAL = "CONNECTION_CLOSED_CODE_NORMAL";
const CONNECTION_CLOSED_CODE_MIC_DENIED =
  "CONNECTION_CLOSED_CODE_MICROPHONE_PERMISSION_DENIED";
const CONNECTION_CLOSED_CODE_SIGNAL_FAILURE =
  "CONNECTION_CLOSED_CODE_SIGNALLING_CLIENT_CONNECTION_FAILURE";
const CONNECTION_CLOSED_CODE_WEBRTC_FAILURE =
  "CONNECTION_CLOSED_CODE_WEBRTC_FAILURE";
const CONNECTION_CLOSED_CODE_SERVER_CLOSED =
  "CONNECTION_CLOSED_CODE_SERVER_CLOSED_CONNECTION";

const AUDIO_PERMISSION_DENIED = "denied";
const AUDIO_PERMISSION_GRANTED = "granted";
const AUDIO_PERMISSION_PENDING = "pending";
const AUDIO_PERMISSION_NOT_REQUESTED = "not_requested";

const USER_TRANSCRIPT_IDLE = "Waiting for microphone input...";

const elements = {
  appTitle: document.getElementById("app-title"),
  personaLabel: document.getElementById("persona-label"),
  startButton: document.getElementById("start-button"),
  stopButton: document.getElementById("stop-button"),
  retryButton: document.getElementById("retry-button"),
  muteButton: document.getElementById("mute-button"),
  sendButton: document.getElementById("send-message"),
  clearHistoryButton: document.getElementById("clear-history"),
  messageInput: document.getElementById("message-input"),
  videoElement: document.getElementById("persona-video"),
  chatHistory: document.getElementById("chat-history"),
  eventLog: document.getElementById("event-log"),
  loadingOverlay: document.getElementById("loading-overlay"),
  statusText: document.getElementById("status-text"),
  micStatusText: document.getElementById("mic-status-text"),
  connectionText: document.getElementById("connection-text"),
  retryCountText: document.getElementById("retry-count-text"),
  connectionChip: document.getElementById("connection-chip"),
  privacyChip: document.getElementById("privacy-chip"),
  languageChip: document.getElementById("language-chip"),
  userTranscript: document.getElementById("user-transcript"),
  personaTranscript: document.getElementById("persona-transcript"),
};

const state = {
  anamClient: null,
  personaName: "Cara",
  isConnecting: false,
  isConnected: false,
  manualStop: false,
  reconnectAttempts: 0,
  reconnectTimer: null,
  sessionAttempt: 0,
  messageHistory: [],
  activeUserMessageId: null,
  activePersonaMessageId: null,
  partialUserText: "",
  partialPersonaText: "",
  eventCounter: 0,
};

function getPersonaIdleText() {
  return `${state.personaName} transcript will appear here.`;
}

function setLoading(isVisible, message = "Connecting to Anam...") {
  elements.loadingOverlay.textContent = message;
  elements.loadingOverlay.classList.toggle("hidden", !isVisible);
}

function setConnectionChip(text, visualState) {
  elements.connectionChip.textContent = text;
  elements.connectionChip.dataset.state = visualState;
}

function setStatus(message) {
  elements.statusText.textContent = message;
}

function setConnectionText(message) {
  elements.connectionText.textContent = message;
}

function setRetryCountText() {
  elements.retryCountText.textContent = `${state.reconnectAttempts} / ${MAX_RECONNECT_ATTEMPTS}`;
}

function appendEvent(level, title, message) {
  if (!elements.eventLog) {
    return;
  }

  const emptyState = elements.eventLog.querySelector(".empty-state");
  if (emptyState) {
    emptyState.remove();
  }

  state.eventCounter += 1;

  const item = document.createElement("article");
  item.className = "event-item";
  item.dataset.level = level;

  const meta = document.createElement("div");
  meta.className = "event-meta";
  meta.innerHTML = `<strong>${title}</strong><span>#${state.eventCounter}</span>`;

  const content = document.createElement("p");
  content.textContent = message;

  item.append(meta, content);
  elements.eventLog.prepend(item);

  while (elements.eventLog.children.length > 25) {
    elements.eventLog.removeChild(elements.eventLog.lastElementChild);
  }
}

function resetLiveTranscript() {
  state.activeUserMessageId = null;
  state.activePersonaMessageId = null;
  state.partialUserText = "";
  state.partialPersonaText = "";
  elements.userTranscript.textContent = USER_TRANSCRIPT_IDLE;
  elements.personaTranscript.textContent = getPersonaIdleText();
}

function updateLiveTranscript(event) {
  if (!event) {
    return;
  }

  if (event.role === "user") {
    if (state.activeUserMessageId !== event.id) {
      state.activeUserMessageId = event.id;
      state.partialUserText = "";
      elements.personaTranscript.textContent = `${state.personaName} is listening...`;
    }

    state.partialUserText += event.content || "";
    elements.userTranscript.textContent = state.partialUserText || USER_TRANSCRIPT_IDLE;
    return;
  }

  if (event.role === "persona") {
    if (state.activePersonaMessageId !== event.id) {
      state.activePersonaMessageId = event.id;
      state.partialPersonaText = "";
    }

    state.partialPersonaText += event.content || "";
    elements.personaTranscript.textContent =
      state.partialPersonaText || getPersonaIdleText();
  }
}

function formatHistoryRole(role) {
  if (role === "user") {
    return "You";
  }

  if (role === "assistant" || role === "persona") {
    return state.personaName;
  }

  return role || "Unknown";
}

function renderHistory(messages = state.messageHistory) {
  if (!elements.chatHistory) {
    return;
  }

  elements.chatHistory.innerHTML = "";

  if (!messages.length) {
    const empty = document.createElement("p");
    empty.className = "empty-state";
    empty.textContent = "Start a conversation to see your chat history.";
    elements.chatHistory.append(empty);
    return;
  }

  messages.forEach((message, index) => {
    const role = message.role === "user" ? "user" : "persona";
    const item = document.createElement("article");
    item.className = `history-item history-item-${role}`;

    const meta = document.createElement("div");
    meta.className = "history-meta";
    meta.innerHTML = `<strong>${formatHistoryRole(message.role)}</strong><span>Turn ${index + 1}</span>`;

    const content = document.createElement("p");
    content.textContent = message.content || "";

    item.append(meta, content);
    elements.chatHistory.append(item);
  });

  elements.chatHistory.scrollTop = elements.chatHistory.scrollHeight;
}

function updateTalkControls() {
  const enabled = state.isConnected;
  elements.sendButton.disabled = !enabled;
  elements.messageInput.disabled = !enabled;
  elements.messageInput.placeholder = enabled
    ? `Type a message for ${state.personaName}...`
    : `Connect first, then type a message for ${state.personaName}...`;
}

function updateButtons() {
  elements.startButton.disabled = state.isConnecting || state.isConnected;
  elements.stopButton.disabled = !state.isConnecting && !state.isConnected;
  elements.retryButton.disabled = state.isConnecting || state.isConnected;
  updateTalkControls();
}

function formatPermissionState(permissionState, isMuted = false) {
  switch (permissionState) {
    case AUDIO_PERMISSION_GRANTED:
      return isMuted ? "Granted (muted)" : "Granted";
    case AUDIO_PERMISSION_PENDING:
      return "Awaiting permission";
    case AUDIO_PERMISSION_DENIED:
      return "Denied";
    case AUDIO_PERMISSION_NOT_REQUESTED:
    default:
      return "Not requested";
  }
}

function syncMuteState() {
  if (!state.anamClient || !state.isConnected) {
    elements.muteButton.disabled = true;
    elements.muteButton.textContent = "Mute mic";
    elements.muteButton.setAttribute("aria-pressed", "false");
    elements.micStatusText.textContent = "Not requested";
    return;
  }

  const audioState = state.anamClient.getInputAudioState?.();
  const permissionState =
    audioState?.permissionState || AUDIO_PERMISSION_NOT_REQUESTED;
  const isMuted = Boolean(audioState?.isMuted);

  elements.muteButton.disabled = permissionState === AUDIO_PERMISSION_DENIED;
  elements.muteButton.textContent = isMuted ? "Unmute mic" : "Mute mic";
  elements.muteButton.setAttribute("aria-pressed", String(isMuted));
  elements.micStatusText.textContent = formatPermissionState(
    permissionState,
    isMuted
  );
}

function describeConnectionReason(reason, details) {
  switch (reason) {
    case CONNECTION_CLOSED_CODE_NORMAL:
      return "Session ended normally.";
    case CONNECTION_CLOSED_CODE_MIC_DENIED:
      return "Microphone permission was denied.";
    case CONNECTION_CLOSED_CODE_SIGNAL_FAILURE:
      return "The signaling service could not establish the session.";
    case CONNECTION_CLOSED_CODE_WEBRTC_FAILURE:
      return "The WebRTC connection failed.";
    case CONNECTION_CLOSED_CODE_SERVER_CLOSED:
      return details
        ? `The server closed the connection: ${details}`
        : "The server closed the connection.";
    default:
      return details
        ? `Connection closed: ${reason || "unknown"} (${details})`
        : `Connection closed: ${reason || "unknown"}`;
  }
}

function shouldRetry(reason) {
  return [
    CONNECTION_CLOSED_CODE_SIGNAL_FAILURE,
    CONNECTION_CLOSED_CODE_WEBRTC_FAILURE,
    CONNECTION_CLOSED_CODE_SERVER_CLOSED,
    undefined,
  ].includes(reason);
}

function clearReconnectTimer() {
  if (state.reconnectTimer) {
    window.clearTimeout(state.reconnectTimer);
    state.reconnectTimer = null;
  }
}

function scheduleReconnect(contextMessage) {
  if (state.manualStop) {
    return;
  }

  if (state.reconnectAttempts >= MAX_RECONNECT_ATTEMPTS) {
    setConnectionChip("Needs retry", "error");
    setStatus(`${contextMessage} Manual retry required.`);
    setConnectionText("Disconnected");
    appendEvent(
      "error",
      "Retry limit reached",
      "Automatic reconnect attempts were exhausted."
    );
    updateButtons();
    return;
  }

  state.reconnectAttempts += 1;
  setRetryCountText();

  const delay = BASE_RECONNECT_DELAY_MS * state.reconnectAttempts;
  setConnectionChip("Reconnecting", "connecting");
  setStatus(`${contextMessage} Retrying in ${delay / 1000}s...`);
  setConnectionText("Recovering session");
  setLoading(true, `Retrying in ${delay / 1000}s...`);
  updateButtons();

  clearReconnectTimer();
  state.reconnectTimer = window.setTimeout(() => {
    state.reconnectTimer = null;
    startSession({ isRetry: true });
  }, delay);
}

async function fetchJson(url, options = {}) {
  const response = await fetch(url, options);
  const payload = await response.json().catch(() => null);

  if (!response.ok) {
    const error = new Error(
      payload?.error || `Request failed with status ${response.status}`
    );
    error.status = response.status;
    throw error;
  }

  return payload;
}

function isRetriableStartError(error) {
  if (typeof error?.status === "number") {
    return error.status >= 500 || error.status === 429;
  }

  return true;
}

function isCurrentAttempt(attemptId, client) {
  return attemptId === state.sessionAttempt && client === state.anamClient;
}

function registerClientListeners(client, attemptId) {
  client.addListener(AnamEvent.CONNECTION_ESTABLISHED, () => {
    if (!isCurrentAttempt(attemptId, client)) {
      return;
    }

    setConnectionChip("Connecting", "connecting");
    setConnectionText("WebRTC connected");
    setStatus("Connection established. Waiting for session readiness...");
    appendEvent("info", "Connection established", "WebRTC handshake completed.");
  });

  client.addListener(AnamEvent.SESSION_READY, () => {
    if (!isCurrentAttempt(attemptId, client)) {
      return;
    }

    state.isConnecting = false;
    state.isConnected = true;
    state.reconnectAttempts = 0;
    setRetryCountText();
    setConnectionChip("Connected", "connected");
    setConnectionText("Ready");
    setStatus(`${state.personaName} is ready for voice and typed input.`);
    setLoading(false);
    updateButtons();
    syncMuteState();
    appendEvent("info", "Session ready", `${state.personaName} is ready to chat.`);
    elements.messageInput.focus();
  });

  client.addListener(AnamEvent.MESSAGE_HISTORY_UPDATED, (messages) => {
    if (!isCurrentAttempt(attemptId, client)) {
      return;
    }

    state.messageHistory = Array.isArray(messages) ? messages : [];
    renderHistory();
  });

  client.addListener(AnamEvent.MESSAGE_STREAM_EVENT_RECEIVED, (event) => {
    if (!isCurrentAttempt(attemptId, client)) {
      return;
    }

    updateLiveTranscript(event);
  });

  client.addListener(AnamEvent.INPUT_AUDIO_STREAM_STARTED, () => {
    if (!isCurrentAttempt(attemptId, client)) {
      return;
    }

    syncMuteState();
  });

  client.addListener(AnamEvent.MIC_PERMISSION_PENDING, () => {
    if (!isCurrentAttempt(attemptId, client)) {
      return;
    }

    elements.micStatusText.textContent = "Awaiting permission";
    appendEvent(
      "warning",
      "Microphone permission",
      "The browser is requesting microphone access."
    );
  });

  client.addListener(AnamEvent.MIC_PERMISSION_GRANTED, () => {
    if (!isCurrentAttempt(attemptId, client)) {
      return;
    }

    syncMuteState();
    appendEvent("info", "Microphone ready", "Microphone permission granted.");
  });

  client.addListener(AnamEvent.MIC_PERMISSION_DENIED, (error) => {
    if (!isCurrentAttempt(attemptId, client)) {
      return;
    }

    elements.micStatusText.textContent = "Denied";
    setConnectionChip("Permission blocked", "error");
    setStatus("Microphone access is required for voice interaction.");
    setLoading(false);
    appendEvent(
      "error",
      "Microphone denied",
      error || "The browser denied microphone access."
    );
    updateButtons();
  });

  client.addListener(AnamEvent.SERVER_WARNING, (message) => {
    if (!isCurrentAttempt(attemptId, client)) {
      return;
    }

    appendEvent("warning", "Server warning", message);
  });

  client.addListener(AnamEvent.TALK_STREAM_INTERRUPTED, (event) => {
    if (!isCurrentAttempt(attemptId, client)) {
      return;
    }

    appendEvent(
      "warning",
      "Talk interrupted",
      `Talk stream interrupted${event?.correlationId ? ` (${event.correlationId})` : ""}.`
    );
  });

  client.addListener(AnamEvent.CONNECTION_CLOSED, (reason, details) => {
    if (!isCurrentAttempt(attemptId, client)) {
      return;
    }

    const wasManualStop = state.manualStop;
    const reasonText = describeConnectionReason(reason, details);

    state.anamClient = null;
    state.isConnected = false;
    state.isConnecting = false;
    elements.videoElement.srcObject = null;
    setLoading(false);
    syncMuteState();
    updateButtons();

    if (wasManualStop) {
      setConnectionChip("Idle", "idle");
      setConnectionText("Disconnected");
      setStatus("Session stopped.");
      appendEvent("info", "Session stopped", "Streaming stopped by the user.");
      return;
    }

    setConnectionChip("Disconnected", "error");
    setConnectionText("Disconnected");
    setStatus(reasonText);
    appendEvent("warning", "Connection closed", reasonText);

    if (shouldRetry(reason)) {
      scheduleReconnect(reasonText);
    }
  });
}

async function startSession({ isRetry = false } = {}) {
  clearReconnectTimer();

  const attemptId = state.sessionAttempt + 1;
  state.sessionAttempt = attemptId;
  state.manualStop = false;
  state.isConnecting = true;
  state.isConnected = false;
  updateButtons();
  setRetryCountText();
  setLoading(true, isRetry ? "Retrying connection..." : "Creating session...");
  setConnectionChip(isRetry ? "Retrying" : "Connecting", "connecting");
  setConnectionText("Requesting session token");
  setStatus(
    isRetry
      ? `Retrying connection to ${state.personaName}...`
      : `Creating a secure session for ${state.personaName}...`
  );

  appendEvent(
    "info",
    isRetry ? "Retrying session" : "Starting session",
    isRetry
      ? "Attempting to recover the connection."
      : "Fetching a new Anam session token from the server."
  );

  try {
    const { sessionToken } = await fetchJson("/api/session-token", {
      method: "POST",
    });

    if (attemptId !== state.sessionAttempt) {
      return;
    }

    state.anamClient = createClient(sessionToken);
    registerClientListeners(state.anamClient, attemptId);

    setConnectionText("Starting media stream");
    setStatus("Connecting the Anam stream to the video element...");
    setLoading(true, "Starting media stream...");
    await state.anamClient.streamToVideoElement("persona-video");
  } catch (error) {
    if (attemptId !== state.sessionAttempt) {
      return;
    }

    state.anamClient = null;
    state.isConnecting = false;
    state.isConnected = false;
    setLoading(false);
    setConnectionChip("Start failed", "error");
    setConnectionText("Disconnected");
    setStatus(error.message || "Failed to start the session.");
    appendEvent(
      "error",
      "Session start failed",
      error.message || "Failed to start the session."
    );
    updateButtons();

    if (isRetriableStartError(error)) {
      scheduleReconnect(error.message || "Could not start the Anam session.");
    }
  }
}

async function stopSession() {
  clearReconnectTimer();
  state.manualStop = true;

  const client = state.anamClient;
  const hadPendingStart = state.isConnecting && !client;

  state.isConnecting = false;
  state.isConnected = false;
  updateButtons();
  setLoading(false);
  setConnectionChip("Idle", "idle");
  setConnectionText("Disconnected");
  setStatus("Stopping session...");

  if (hadPendingStart) {
    state.sessionAttempt += 1;
    setStatus("Session stopped.");
    return;
  }

  try {
    await client?.stopStreaming();
  } catch (error) {
    appendEvent(
      "warning",
      "Stop warning",
      error.message || "The session stopped with a warning."
    );
  } finally {
    state.anamClient = null;
    elements.videoElement.srcObject = null;
    syncMuteState();
    setStatus("Session stopped.");
  }
}

async function toggleMute() {
  if (!state.anamClient || !state.isConnected) {
    return;
  }

  try {
    const audioState = state.anamClient.getInputAudioState?.();
    if (audioState?.isMuted) {
      state.anamClient.unmuteInputAudio();
      appendEvent("info", "Microphone unmuted", "Input audio is active again.");
    } else {
      state.anamClient.muteInputAudio();
      appendEvent("info", "Microphone muted", "Input audio has been muted.");
    }

    syncMuteState();
  } catch (error) {
    appendEvent(
      "error",
      "Audio control failed",
      error.message || "Failed to toggle the input microphone."
    );
  }
}

async function sendTalkMessage() {
  if (!state.anamClient || !state.isConnected) {
    return;
  }

  const message = elements.messageInput.value.trim();
  if (!message) {
    appendEvent("warning", "Empty message", "Enter a message before sending.");
    return;
  }

  const originalLabel = elements.sendButton.textContent;
  elements.sendButton.disabled = true;
  elements.sendButton.textContent = "Sending...";

  try {
    await state.anamClient.talk(message);
    elements.messageInput.value = "";
    appendEvent("info", "Talk command sent", `Sent a message to ${state.personaName}.`);
  } catch (error) {
    appendEvent(
      "error",
      "Talk command failed",
      error.message || "The talk command could not be sent."
    );
  } finally {
    elements.sendButton.disabled = !state.isConnected;
    elements.sendButton.textContent = originalLabel;
  }
}

function clearHistoryPanel() {
  state.messageHistory = [];
  renderHistory();
  appendEvent("info", "History cleared", "The local history panel was cleared.");
}

async function loadConfig() {
  try {
    const config = await fetchJson("/api/config");
    if (config.personaName) {
      state.personaName = config.personaName;
      elements.appTitle.textContent = `Chat with ${state.personaName}`;
      elements.personaLabel.textContent = state.personaName;
      elements.messageInput.placeholder = `Connect first, then type a message for ${state.personaName}...`;
      elements.personaTranscript.textContent = getPersonaIdleText();
    }

    elements.privacyChip.textContent = `Zero data retention: ${
      config.zeroDataRetention ? "on" : "off"
    }`;
    elements.languageChip.textContent = `Language: ${
      config.languageCode || "default"
    }`;
  } catch (error) {
    appendEvent(
      "warning",
      "Config unavailable",
      error.message || "Could not load the app configuration."
    );
  }
}

function bindEvents() {
  elements.startButton.addEventListener("click", () => startSession());
  elements.stopButton.addEventListener("click", stopSession);
  elements.retryButton.addEventListener("click", () => {
    state.reconnectAttempts = 0;
    setRetryCountText();
    startSession({ isRetry: true });
  });
  elements.muteButton.addEventListener("click", toggleMute);
  elements.sendButton.addEventListener("click", sendTalkMessage);
  elements.clearHistoryButton.addEventListener("click", clearHistoryPanel);

  elements.messageInput.addEventListener("keydown", (event) => {
    if (event.key === "Enter" && !event.shiftKey) {
      event.preventDefault();
      sendTalkMessage();
    }
  });
}

async function init() {
  updateButtons();
  setRetryCountText();
  resetLiveTranscript();
  renderHistory();
  setConnectionChip("Idle", "idle");
  setConnectionText("Disconnected");
  setStatus("Waiting to start a session.");
  bindEvents();
  await loadConfig();
}

init();
