# SelamPath — Accessible Onboarding & AccessPath Careers

**SelamPath** is an open-source, drop-in accessible onboarding and career-gateway platform
for learners in Ethiopia, built for training institutions, NGOs, and inclusive employers.
The career module keeps its established name, **AccessPath**.

Tagline: _A peaceful path from learning to work._

## Key Features

- **Zero-Barrier Entry** — Keyboard-first (`Alt + A`), screen-reader friendly (NVDA / TalkBack),
  and an optional voice assistant.
- **Persistent Low-Vision Engine** — High-contrast presets (dark yellow / black,
  light yellow / black, dark white / black), custom background and text colours, and
  80–200% zoom saved across sessions.
- **Voice-First Registration & Review** — Web Speech API speech recognition and synthesis
  with explicit confirmation, spelling/keypad modes, and an audio/visual review step.
- **Inclusive Identity & Verification** — National/Kebele ID, Refugee ID (UNHCR/RRS),
  alternative documents, and partner referrals. **No medical proof is required.**
- **Server-Verified Contact** — Registration requires a single-use 6-digit code sent to a
  phone number or email. A client-side `otp_verified` flag is ignored.
- **Save & Resume** — Progress persists locally and can be resumed with a server token.
  Passcodes are held in memory only and never written to `localStorage`.
- **AccessPath Career Gateway** — Private "Support I Need" preferences, six career pathways,
  learning roadmaps, accommodation-matched jobs, and employer job posting.
- **AccessPath Career Passport** — A shareable readiness summary that combines career direction,
  verified contact status, completed stages, acquired skills, support preferences, and application
  activity. It can be copied as text or printed/saved as a PDF, and distinguishes SelamPath from a
  standalone screen reader.
- **Plug-and-Play Architecture**
  - **Level 1** — A single web component: `<digital-bridge-onboarding>`.
  - **Level 2** — REST API with an OpenAPI 3.0 specification (`openapi.yaml`).
  - **Level 3** — `schema.org`-shaped job payloads.

## Quick Start

### Option A: Frontend Drop-In

```html
<script src="http://localhost:8080/js/config.js" defer></script>
<script src="http://localhost:8080/js/i18n.js" defer></script>
<script src="http://localhost:8080/js/state-manager.js" defer></script>
<script src="http://localhost:8080/js/voice-engine.js" defer></script>
<script src="http://localhost:8080/js/digital-bridge-onboarding.js" defer></script>

<digital-bridge-onboarding lang="en"></digital-bridge-onboarding>
```

Set `window.SELAMPATH_API_BASE` before the component loads, or pass
`api-base="https://api.example.org/api/v1"` directly.

### Option B: Full Stack with Docker Compose

```bash
cp backend/.env.example backend/.env   # optional; fill in real integrations
docker compose up --build
```

- **Demo host page** — `http://localhost:8080`
- **Backend API** — `http://localhost:8000/api/v1/health`
- **Swagger docs** — `http://localhost:8000/docs` (enabled for the compose demo; set
  `ENABLE_DOCS=false` in production)

The database is stored in the named Docker volume `selampath-data` (mounted at
`/app/data`), so it survives `docker compose down` and remains writable by the
non-root container user. Back it up with `docker compose cp` or a volume snapshot,
and remove it with `docker compose down -v` only when you intend to delete all data.

### Local Development

```bash
cd backend
python -m venv venv
venv/Scripts/activate          # Windows
# source venv/bin/activate     # macOS / Linux
pip install -r requirements.txt
uvicorn app.main:app --reload --port 8000
```

Serve `frontend/` with any static server on port 8080, for example:

```bash
cd frontend
python -m http.server 8080
```

## Configuration

Copy `backend/.env.example` to `backend/.env`. Key settings:

| Variable | Default | Purpose |
| --- | --- | --- |
| `ENV` | `development` | Set to `production` to hide docs by default |
| `ENABLE_DOCS` | true outside production | Serves `/docs` and `/openapi.json` |
| `CORS_ORIGINS` | `http://localhost:8080,...` | Comma-separated allowlist; never `*` in production |
| `DB_PATH` | `backend/digital_bridge.db` | SQLite location; `/app/data/...` in Docker |
| `SESSION_TTL_DAYS` | `7` | Session lifetime |
| `OTP_COOLDOWN_SECONDS` | `60` | Minimum delay between verification-code sends |
| `OTP_MAX_PER_HOUR` | `5` | Verification codes per contact per hour |
| `PARTNER_API_KEY` | unset | When set, `/referrals/partner` requires `X-Partner-Key` |
| `TRUST_PROXY` | `false` | Trust `X-Forwarded-For` only behind a known proxy |

## Security Notes

- Accounts are insert-only from public onboarding; an existing name cannot be taken over.
- Registration requires a server-side, single-use contact verification.
- Job posting and job applications require a bearer session.
- Login, OTP, draft, referral, AI, TTS, and STT endpoints are rate-limited.
- Responses include `X-Content-Type-Options`, `X-Frame-Options`, `Referrer-Policy`,
  `Permissions-Policy`, and `Cache-Control: no-store`.
- The frontend escapes all dynamic values before inserting HTML and never persists passcodes.
- The bundled nginx config adds a Content-Security-Policy and related headers.

See `SECURITY.md` for the threat model and deployment checklist.

## Tests

```bash
cd backend
pip install -r requirements-dev.txt
python -m pytest tests -q
```

The suite covers OTP enforcement, duplicate-name protection, authorization on job
endpoints, session revocation, validation, security headers, and OTP single-use behaviour.

## Folder Structure

```text
digital-bridge-onboarding/
├── docker-compose.yml
├── openapi.yaml
├── SECURITY.md
├── WCAG_2.2_AA_CONFORMANCE_REPORT.md
├── frontend/
│   ├── index.html
│   ├── nginx.conf
│   ├── css/accessibility-themes.css
│   ├── js/
│   │   ├── config.js
│   │   ├── i18n.js
│   │   ├── voice-engine.js
│   │   ├── state-manager.js
│   │   └── digital-bridge-onboarding.js
│   └── tests/axe-audit.html
└── backend/
    ├── Dockerfile
    ├── requirements.txt
    ├── requirements-dev.txt
    ├── .env.example
    ├── app/
    │   ├── main.py
    │   ├── models.py
    │   ├── storage.py
    │   └── addis_ai_service.py
    └── tests/test_security.py
```

## Languages

English and Amharic are currently shipped. Additional languages can be added in
`frontend/js/i18n.js`; Amharic copy should be reviewed by a native speaker before release.

## License

Open source. Add the project's chosen license here before publishing.


## Deployment

The frontend is a static site (Vercel) and the backend is a FastAPI service (Render).

### Frontend (Vercel)
- Vercel serves the `frontend/` folder as a static site (configured via `vercel.json`, no build step).
- After deploying the backend, set the API URL in `frontend/index.html`:
  `<meta name="selampath-api-base" content="https://selampath-api.onrender.com/api/v1" />`
- Commit and push; Vercel redeploys automatically.

### Backend (Render)
1. Push this repo to GitHub.
2. On render.com: **New +** -> **Blueprint**, select this repository (uses `render.yaml`).
3. When prompted, set `CORS_ORIGINS` to your frontend URL(s), comma-separated,
   e.g. `https://your-app.vercel.app`.
4. Deploy. Health check: `https://<service-url>/api/v1/health`.

> Note: the free Render plan has an ephemeral disk, so SQLite data resets on redeploy.
> Upgrade to Starter and add a persistent disk (mount `/app/data`) to keep data.

### Local development
- Backend: `cd backend && venv/Scripts/python -m uvicorn app.main:app --port 8000 --reload`
- Frontend: serve `frontend/` on port 8080 (e.g. `python -m http.server 8080 --directory frontend`).
- The frontend auto-targets `http://localhost:8000/api/v1` on localhost.
