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

    const levelClasses = {
      info: "border-sky-100 bg-sky-50/80",
      warning: "border-amber-100 bg-amber-50/80",
      error: "border-red-100 bg-red-50/80",
    };

    const item = document.createElement("article");
    item.className = `rounded-2xl border p-4 ${levelClasses[level] ?? "border-slate-100 bg-slate-50/80"}`;
    item.dataset.level = level;

    const meta = document.createElement("div");
    meta.className = "flex justify-between items-center gap-3 mb-2";
    meta.innerHTML = `<strong class="text-[10px] font-extrabold uppercase tracking-widest text-slate-700">${title}</strong><span class="text-[11px] text-slate-400 tabular-nums">#${state.eventCounter}</span>`;

    const content = document.createElement("p");
    content.className = "m-0 text-sm text-slate-600 leading-relaxed";
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
      empty.className = "empty-state m-0 text-sm text-slate-400 text-center py-10";
      empty.textContent = "Start a conversation to see your chat history.";
      elements.chatHistory.append(empty);
      return;
    }

    messages.forEach((message, index) => {
      const role = message.role === "user" ? "user" : "persona";
      const roleCardClass = role === "user"
        ? "border-sky-100 bg-sky-50/80"
        : "border-violet-100 bg-violet-50/80";
      const roleLabelClass = role === "user" ? "text-sky-500" : "text-violet-500";

      const item = document.createElement("article");
      item.className = `rounded-2xl border p-4 ${roleCardClass}`;

      const meta = document.createElement("div");
      meta.className = "flex justify-between items-center gap-3 mb-2";
      meta.innerHTML = `<strong class="text-[10px] font-extrabold uppercase tracking-widest ${roleLabelClass}">${formatHistoryRole(message.role)}</strong><span class="text-[11px] text-slate-400">Turn ${index + 1}</span>`;

      const content = document.createElement("p");
      content.className = "m-0 text-sm text-slate-700 leading-relaxed";
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
      ? `Say something to ${state.personaName}…`
      : `Connect first, then say something to ${state.personaName}…`;
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
      elements.messageInput.placeholder = `Connect first, then say something to ${state.personaName}…`;
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
