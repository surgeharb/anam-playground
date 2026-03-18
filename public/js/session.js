import { createClient } from "https://esm.sh/@anam-ai/js-sdk@latest";
import { AnamEvent } from "https://esm.sh/@anam-ai/js-sdk@latest/dist/module/types";

import { fetchJson, isRetriableStartError } from "./api.js";
import {
  BASE_RECONNECT_DELAY_MS,
  CONNECTION_CLOSED_CODE_MIC_DENIED,
  CONNECTION_CLOSED_CODE_NORMAL,
  CONNECTION_CLOSED_CODE_SERVER_CLOSED,
  CONNECTION_CLOSED_CODE_SIGNAL_FAILURE,
  CONNECTION_CLOSED_CODE_WEBRTC_FAILURE,
} from "./constants.js";

export function createSessionController({
  elements,
  state,
  ui,
  maxReconnectAttempts,
}) {
  function clearReconnectTimer() {
    if (state.reconnectTimer) {
      window.clearTimeout(state.reconnectTimer);
      state.reconnectTimer = null;
    }
  }

  function isCurrentAttempt(attemptId, client) {
    return attemptId === state.sessionAttempt && client === state.anamClient;
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

  function scheduleReconnect(contextMessage) {
    if (state.manualStop) {
      return;
    }

    if (state.reconnectAttempts >= maxReconnectAttempts) {
      ui.setConnectionChip("Needs retry", "error");
      ui.setStatus(`${contextMessage} Manual retry required.`);
      ui.setConnectionText("Disconnected");
      ui.appendEvent(
        "error",
        "Retry limit reached",
        "Automatic reconnect attempts were exhausted."
      );
      ui.updateButtons();
      return;
    }

    state.reconnectAttempts += 1;
    ui.setRetryCountText();

    const delay = BASE_RECONNECT_DELAY_MS * state.reconnectAttempts;
    ui.setConnectionChip("Reconnecting", "connecting");
    ui.setStatus(`${contextMessage} Retrying in ${delay / 1000}s...`);
    ui.setConnectionText("Recovering session");
    ui.setLoading(true, `Retrying in ${delay / 1000}s...`);
    ui.updateButtons();

    clearReconnectTimer();
    state.reconnectTimer = window.setTimeout(() => {
      state.reconnectTimer = null;
      startSession({ isRetry: true });
    }, delay);
  }

  function registerClientListeners(client, attemptId) {
    client.addListener(AnamEvent.CONNECTION_ESTABLISHED, () => {
      if (!isCurrentAttempt(attemptId, client)) {
        return;
      }

      ui.setConnectionChip("Connecting", "connecting");
      ui.setConnectionText("WebRTC connected");
      ui.setStatus("Connection established. Waiting for session readiness...");
      ui.appendEvent(
        "info",
        "Connection established",
        "WebRTC handshake completed."
      );
    });

    client.addListener(AnamEvent.SESSION_READY, () => {
      if (!isCurrentAttempt(attemptId, client)) {
        return;
      }

      state.isConnecting = false;
      state.isConnected = true;
      state.reconnectAttempts = 0;
      ui.setRetryCountText();
      ui.setConnectionChip("Connected", "connected");
      ui.setConnectionText("Ready");
      ui.setStatus(`${state.personaName} is ready for voice and typed input.`);
      ui.setLoading(false);
      ui.updateButtons();
      ui.syncMuteState(client);
      ui.appendEvent(
        "info",
        "Session ready",
        `${state.personaName} is ready to chat.`
      );
      elements.messageInput.focus();
    });

    client.addListener(AnamEvent.MESSAGE_HISTORY_UPDATED, (messages) => {
      if (!isCurrentAttempt(attemptId, client)) {
        return;
      }

      state.messageHistory = Array.isArray(messages) ? messages : [];
      ui.renderHistory();
    });

    client.addListener(AnamEvent.MESSAGE_STREAM_EVENT_RECEIVED, (event) => {
      if (!isCurrentAttempt(attemptId, client)) {
        return;
      }

      ui.updateLiveTranscript(event);
    });

    client.addListener(AnamEvent.INPUT_AUDIO_STREAM_STARTED, () => {
      if (!isCurrentAttempt(attemptId, client)) {
        return;
      }

      ui.syncMuteState(client);
    });

    client.addListener(AnamEvent.MIC_PERMISSION_PENDING, () => {
      if (!isCurrentAttempt(attemptId, client)) {
        return;
      }

      elements.micStatusText.textContent = "Awaiting permission";
      ui.appendEvent(
        "warning",
        "Microphone permission",
        "The browser is requesting microphone access."
      );
    });

    client.addListener(AnamEvent.MIC_PERMISSION_GRANTED, () => {
      if (!isCurrentAttempt(attemptId, client)) {
        return;
      }

      ui.syncMuteState(client);
      ui.appendEvent("info", "Microphone ready", "Microphone permission granted.");
    });

    client.addListener(AnamEvent.MIC_PERMISSION_DENIED, (error) => {
      if (!isCurrentAttempt(attemptId, client)) {
        return;
      }

      elements.micStatusText.textContent = "Denied";
      ui.setConnectionChip("Permission blocked", "error");
      ui.setStatus("Microphone access is required for voice interaction.");
      ui.setLoading(false);
      ui.appendEvent(
        "error",
        "Microphone denied",
        error || "The browser denied microphone access."
      );
      ui.updateButtons();
    });

    client.addListener(AnamEvent.SERVER_WARNING, (message) => {
      if (!isCurrentAttempt(attemptId, client)) {
        return;
      }

      ui.appendEvent("warning", "Server warning", message);
    });

    client.addListener(AnamEvent.TALK_STREAM_INTERRUPTED, (event) => {
      if (!isCurrentAttempt(attemptId, client)) {
        return;
      }

      ui.appendEvent(
        "warning",
        "Talk interrupted",
        `Talk stream interrupted${
          event?.correlationId ? ` (${event.correlationId})` : ""
        }.`
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
      ui.setLoading(false);
      ui.syncMuteState(null);
      ui.updateButtons();

      if (wasManualStop) {
        ui.setConnectionChip("Idle", "idle");
        ui.setConnectionText("Disconnected");
        ui.setStatus("Session stopped.");
        ui.appendEvent("info", "Session stopped", "Streaming stopped by the user.");
        return;
      }

      ui.setConnectionChip("Disconnected", "error");
      ui.setConnectionText("Disconnected");
      ui.setStatus(reasonText);
      ui.appendEvent("warning", "Connection closed", reasonText);

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
    ui.updateButtons();
    ui.setRetryCountText();
    ui.setLoading(
      true,
      isRetry ? "Retrying connection..." : "Creating session..."
    );
    ui.setConnectionChip(isRetry ? "Retrying" : "Connecting", "connecting");
    ui.setConnectionText("Requesting session token");
    ui.setStatus(
      isRetry
        ? `Retrying connection to ${state.personaName}...`
        : `Creating a secure session for ${state.personaName}...`
    );

    ui.appendEvent(
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

      ui.setConnectionText("Starting media stream");
      ui.setStatus("Connecting the Anam stream to the video element...");
      ui.setLoading(true, "Starting media stream...");
      await state.anamClient.streamToVideoElement("persona-video");
    } catch (error) {
      if (attemptId !== state.sessionAttempt) {
        return;
      }

      state.anamClient = null;
      state.isConnecting = false;
      state.isConnected = false;
      ui.setLoading(false);
      ui.setConnectionChip("Start failed", "error");
      ui.setConnectionText("Disconnected");
      ui.setStatus(error.message || "Failed to start the session.");
      ui.appendEvent(
        "error",
        "Session start failed",
        error.message || "Failed to start the session."
      );
      ui.updateButtons();

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
    ui.updateButtons();
    ui.setLoading(false);
    ui.setConnectionChip("Idle", "idle");
    ui.setConnectionText("Disconnected");
    ui.setStatus("Stopping session...");

    if (hadPendingStart) {
      state.sessionAttempt += 1;
      ui.setStatus("Session stopped.");
      return;
    }

    try {
      await client?.stopStreaming();
    } catch (error) {
      ui.appendEvent(
        "warning",
        "Stop warning",
        error.message || "The session stopped with a warning."
      );
    } finally {
      state.anamClient = null;
      elements.videoElement.srcObject = null;
      ui.syncMuteState(null);
      ui.setStatus("Session stopped.");
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
        ui.appendEvent(
          "info",
          "Microphone unmuted",
          "Input audio is active again."
        );
      } else {
        state.anamClient.muteInputAudio();
        ui.appendEvent("info", "Microphone muted", "Input audio has been muted.");
      }

      ui.syncMuteState(state.anamClient);
    } catch (error) {
      ui.appendEvent(
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
      ui.appendEvent("warning", "Empty message", "Enter a message before sending.");
      return;
    }

    const originalLabel = elements.sendButton.textContent;
    elements.sendButton.disabled = true;
    elements.sendButton.textContent = "Sending...";

    try {
      await state.anamClient.talk(message);
      elements.messageInput.value = "";
      ui.appendEvent(
        "info",
        "Talk command sent",
        `Sent a message to ${state.personaName}.`
      );
    } catch (error) {
      ui.appendEvent(
        "error",
        "Talk command failed",
        error.message || "The talk command could not be sent."
      );
    } finally {
      elements.sendButton.disabled = !state.isConnected;
      elements.sendButton.textContent = originalLabel;
    }
  }

  return {
    startSession,
    stopSession,
    toggleMute,
    sendTalkMessage,
    resetRetryAndStart() {
      state.reconnectAttempts = 0;
      ui.setRetryCountText();
      startSession({ isRetry: true });
    },
  };
}
