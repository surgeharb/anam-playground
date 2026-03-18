import { fetchJson } from "./api.js";
import { MAX_RECONNECT_ATTEMPTS } from "./constants.js";
import { elements, state } from "./dom.js";
import { createSessionController } from "./session.js";
import { createUi } from "./ui.js";

export async function initApp() {
  const ui = createUi({
    elements,
    state,
    maxReconnectAttempts: MAX_RECONNECT_ATTEMPTS,
  });

  const session = createSessionController({
    elements,
    state,
    ui,
    maxReconnectAttempts: MAX_RECONNECT_ATTEMPTS,
  });

  function bindEvents() {
    elements.startButton.addEventListener("click", () => session.startSession());
    elements.stopButton.addEventListener("click", session.stopSession);
    elements.retryButton.addEventListener("click", session.resetRetryAndStart);
    elements.muteButton.addEventListener("click", session.toggleMute);
    elements.sendButton.addEventListener("click", session.sendTalkMessage);
    elements.clearHistoryButton.addEventListener("click", ui.clearHistoryPanel);

    elements.messageInput.addEventListener("keydown", (event) => {
      if (event.key === "Enter" && !event.shiftKey) {
        event.preventDefault();
        session.sendTalkMessage();
      }
    });
  }

  async function loadConfig() {
    try {
      const config = await fetchJson("/api/config");
      ui.applyConfig(config);
    } catch (error) {
      ui.appendEvent(
        "warning",
        "Config unavailable",
        error.message || "Could not load the app configuration."
      );
    }
  }

  ui.updateButtons();
  ui.setRetryCountText();
  ui.resetLiveTranscript();
  ui.renderHistory();
  ui.setConnectionChip("Idle", "idle");
  ui.setConnectionText("Disconnected");
  ui.setStatus("Waiting to start a session.");

  bindEvents();
  await loadConfig();
}
