import {
  AUDIO_PERMISSION_DENIED,
  AUDIO_PERMISSION_GRANTED,
  AUDIO_PERMISSION_NOT_REQUESTED,
  AUDIO_PERMISSION_PENDING,
  USER_TRANSCRIPT_IDLE,
} from "./constants.js";

export function createUi({ elements, state, maxReconnectAttempts }) {
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
    elements.retryCountText.textContent = `${state.reconnectAttempts} / ${maxReconnectAttempts}`;
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
      elements.userTranscript.textContent =
        state.partialUserText || USER_TRANSCRIPT_IDLE;
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

  function syncMuteState(client) {
    if (!client || !state.isConnected) {
      elements.muteButton.disabled = true;
      elements.muteButton.textContent = "Mute mic";
      elements.muteButton.setAttribute("aria-pressed", "false");
      elements.micStatusText.textContent = "Not requested";
      return;
    }

    const audioState = client.getInputAudioState?.();
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

  function clearHistoryPanel() {
    state.messageHistory = [];
    renderHistory();
    appendEvent("info", "History cleared", "The local history panel was cleared.");
  }

  function applyConfig(config) {
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
  }

  return {
    appendEvent,
    applyConfig,
    clearHistoryPanel,
    renderHistory,
    resetLiveTranscript,
    setConnectionChip,
    setConnectionText,
    setLoading,
    setRetryCountText,
    setStatus,
    syncMuteState,
    updateButtons,
    updateLiveTranscript,
  };
}
