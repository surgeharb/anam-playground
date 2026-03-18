<img width="1341" height="853" alt="Screenshot 2026-03-18 at 18 30 25" src="https://github.com/user-attachments/assets/80840d20-3a82-446d-882d-52bc8b3a30f0" />

# Anam SDK full app example

This repository contains a complete browser-based example app for the Anam SDK,
following the "full application" guide:

- secure server-side session token creation
- chat history updates from Anam events
- live transcript streaming
- talk-command text input
- microphone mute / unmute control
- connection status, loading states, and retry handling
- basic production hardening with rate limiting and origin checks

## Project structure

```text
.
├── public/
│   ├── index.html
│   ├── script.js
│   └── styles.css
├── .env.example
├── package.json
└── server.js
```

## Prerequisites

- Node.js 18+ (Node 22 works well)
- An Anam API key
- A microphone and speakers

## Setup

1. Install dependencies:

   ```bash
   npm install
   ```

2. Copy the example environment file:

   ```bash
   cp .env.example .env
   ```

3. Add your `ANAM_API_KEY` to `.env`.

4. Optional: customize the persona settings in `.env`:

   - `ANAM_PERSONA_NAME`
   - `ANAM_AVATAR_ID`
   - `ANAM_VOICE_ID`
   - `ANAM_LLM_ID`
   - `ANAM_SYSTEM_PROMPT`
   - `ANAM_LANGUAGE_CODE`
   - `ANAM_ZERO_DATA_RETENTION`
   - `ANAM_ALLOWED_ORIGINS`

## Run the app

```bash
npm start
```

Then open:

```text
http://localhost:8000
```

## Server endpoints

- `GET /health` - quick health check
- `GET /api/config` - safe client-side config for UI labels
- `POST /api/session-token` - exchanges your API key for an Anam session token

## Notes

- Keep `.env` out of version control.
- The client SDK is loaded from `esm.sh`, matching the docs approach.
- The server applies rate limiting and can restrict token requests to specific
  origins via `ANAM_ALLOWED_ORIGINS`.
