require("dotenv").config();

const path = require("node:path");
const express = require("express");
const helmet = require("helmet");
const { rateLimit } = require("express-rate-limit");

const app = express();
const port = Number.parseInt(process.env.PORT || "8000", 10);

const DEFAULT_PERSONA_CONFIG = {
  name: "Cara",
  avatarId: "30fa96d0-26c4-4e55-94a0-517025942e18",
  voiceId: "6bfbe25a-979d-40f3-a92b-5394170af54b",
  llmId: "0934d97d-0c3a-4f33-91b0-5e136a0ef466",
  systemPrompt:
    "You are Cara, a helpful AI assistant. Be friendly, concise, and helpful in your responses.",
};

function parseBoolean(value, fallback = false) {
  if (value === undefined || value === null || value === "") {
    return fallback;
  }

  return ["1", "true", "yes", "on"].includes(String(value).toLowerCase());
}

function parseAllowedOrigins(value) {
  if (!value) {
    return [];
  }

  return value
    .split(",")
    .map((origin) => origin.trim())
    .filter(Boolean);
}

function buildPersonaConfig() {
  const personaConfig = {
    name: process.env.ANAM_PERSONA_NAME || DEFAULT_PERSONA_CONFIG.name,
    avatarId: process.env.ANAM_AVATAR_ID || DEFAULT_PERSONA_CONFIG.avatarId,
    voiceId: process.env.ANAM_VOICE_ID || DEFAULT_PERSONA_CONFIG.voiceId,
    llmId: process.env.ANAM_LLM_ID || DEFAULT_PERSONA_CONFIG.llmId,
    systemPrompt:
      process.env.ANAM_SYSTEM_PROMPT || DEFAULT_PERSONA_CONFIG.systemPrompt,
    zeroDataRetention: parseBoolean(
      process.env.ANAM_ZERO_DATA_RETENTION,
      false
    ),
  };

  if (process.env.ANAM_LANGUAGE_CODE) {
    personaConfig.languageCode = process.env.ANAM_LANGUAGE_CODE;
  }

  return personaConfig;
}

function validateEnvironment() {
  if (!process.env.ANAM_API_KEY) {
    throw new Error(
      "Missing ANAM_API_KEY. Copy .env.example to .env and add your Anam API key."
    );
  }
}

function createRateLimiter() {
  const windowMs = Number.parseInt(
    process.env.ANAM_RATE_LIMIT_WINDOW_MS || "60000",
    10
  );
  const max = Number.parseInt(process.env.ANAM_RATE_LIMIT_MAX || "20", 10);

  return rateLimit({
    windowMs,
    limit: max,
    standardHeaders: true,
    legacyHeaders: false,
    handler: (req, res) => {
      const resetTime = req.rateLimit?.resetTime
        ? new Date(req.rateLimit.resetTime)
        : new Date(Date.now() + windowMs);
      const retryAfterSeconds = Math.max(
        1,
        Math.ceil((resetTime.getTime() - Date.now()) / 1000)
      );

      res.set("Retry-After", String(retryAfterSeconds));
      res.status(429).json({
        error: "Too many session token requests. Please try again shortly.",
        retryAfterSeconds,
      });
    },
  });
}

async function safeJson(response) {
  try {
    return await response.json();
  } catch {
    return null;
  }
}

function validateRequestOrigin(req, res, next) {
  const allowedOrigins = parseAllowedOrigins(process.env.ANAM_ALLOWED_ORIGINS);

  if (allowedOrigins.length === 0) {
    next();
    return;
  }

  const origin = req.get("origin");
  if (!origin || allowedOrigins.includes(origin)) {
    next();
    return;
  }

  res.status(403).json({
    error: "This origin is not allowed to request Anam session tokens.",
  });
}

validateEnvironment();

app.disable("x-powered-by");
app.use(
  helmet({
    contentSecurityPolicy: false,
    crossOriginEmbedderPolicy: false,
  })
);
app.use(express.json());
app.use(express.static(path.join(__dirname, "public")));

app.get("/health", (_req, res) => {
  res.json({
    ok: true,
    personaName: buildPersonaConfig().name,
  });
});

app.get("/api/config", (_req, res) => {
  const personaConfig = buildPersonaConfig();

  res.json({
    personaName: personaConfig.name,
    zeroDataRetention: personaConfig.zeroDataRetention,
    languageCode: personaConfig.languageCode || null,
  });
});

app.post(
  "/api/session-token",
  validateRequestOrigin,
  createRateLimiter(),
  async (_req, res) => {
    try {
      const response = await fetch("https://api.anam.ai/v1/auth/session-token", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${process.env.ANAM_API_KEY}`,
        },
        body: JSON.stringify({
          personaConfig: buildPersonaConfig(),
        }),
        signal: AbortSignal.timeout(15000),
      });

      const payload = await safeJson(response);

      if (!response.ok) {
        const errorMessage =
          payload?.message ||
          payload?.error ||
          "Failed to create session token from Anam.";

        res.status(response.status).json({ error: errorMessage });
        return;
      }

      if (!payload?.sessionToken) {
        res.status(502).json({
          error: "Anam did not return a session token.",
        });
        return;
      }

      res.json({ sessionToken: payload.sessionToken });
    } catch (error) {
      const message =
        error?.name === "TimeoutError"
          ? "Timed out while creating the Anam session token."
          : "Failed to create session token.";

      console.error("Session token request failed:", error);
      res.status(500).json({ error: message });
    }
  }
);

app.get("/", (_req, res) => {
  res.sendFile(path.join(__dirname, "public", "index.html"));
});

app.listen(port, () => {
  console.log(`Anam example app running on http://localhost:${port}`);
});
