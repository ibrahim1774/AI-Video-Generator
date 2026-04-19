# FaceForge

A luxury, minimal face-swap SaaS built on **Next.js 14** (Pages Router) and the **Magic Hour** AI face-swap API.

Upload a source video + a reference face photo, and FaceForge hands both off to Magic Hour, polls for completion, and gives you back a finished MP4 — wrapped in a dark, premium UI.

---

## Quick start

1. Grab a Magic Hour API key at <https://magichour.ai/developer>.
2. Install dependencies:
   ```bash
   npm install
   ```
3. Configure the environment:
   ```bash
   cp .env.example .env.local
   # then edit .env.local and set MAGIC_HOUR_API_KEY
   ```
4. Run the dev server:
   ```bash
   npm run dev
   ```
5. Open <http://localhost:3000>.

To build for production:

```bash
npm run build
npm run start
```

---

## How it works

### User flow

1. **Upload** — user drops in a source video and a reference face photo, checks the consent box, and hits *Create face swap*.
2. **Processing** — the UI shows a gold progress ring with live status labels while the backend polls Magic Hour every 3 s.
3. **Result** — on completion, the finished MP4 plays inline and can be downloaded with one click.

### Backend flow

1. `POST /api/swap` parses the multipart upload with `formidable`, reads both files into memory, and creates an in-memory job record.
2. The server requests two presigned upload URLs from Magic Hour (`/files/upload-urls`) and PUTs both files in parallel.
3. It creates the face-swap job (`/face-swap-video`) and stores the returned `projectId` on the job.
4. Temp files are unlinked; the client receives `{ jobId, projectId, status }`.
5. The client polls `GET /api/status?jobId=...` every 3 s. The server in turn calls Magic Hour's `GET /video/projects/{projectId}`, maps the status, and on completion saves the first download URL as `resultUrl`.
6. `GET /api/jobs` returns the full in-memory list for the History tab.

---

## File structure

```
faceforge/
├── .env.example
├── .gitignore
├── README.md
├── next.config.js
├── package.json
├── components/
│   ├── AppHead.js
│   ├── Navbar.js
│   ├── Navbar.module.css
│   ├── UploadZone.js
│   ├── UploadZone.module.css
│   ├── Processing.js
│   ├── Processing.module.css
│   ├── Result.js
│   ├── Result.module.css
│   ├── JobHistory.js
│   └── JobHistory.module.css
├── lib/
│   ├── magichour.js
│   └── jobs.js
├── pages/
│   ├── _app.js
│   ├── index.js
│   └── api/
│       ├── swap.js
│       ├── status.js
│       └── jobs.js
└── styles/
    ├── globals.css
    └── Home.module.css
```

---

## Production checklist

Ship-hardening items intentionally left out of the demo:

- [ ] Replace the in-memory store in `lib/jobs.js` with Supabase / Postgres (or any durable KV).
- [ ] Add user auth (NextAuth, Clerk, or Supabase Auth) and scope jobs per user.
- [ ] Add Stripe billing + usage metering.
- [ ] Switch polling for **Magic Hour webhooks** and surface a `resultUrl` as soon as it arrives.
- [ ] Add rate limiting (per-IP + per-user) on `/api/swap`.
- [ ] Validate MIME types and reject anything that isn't a real video/image (not just the extension).
- [ ] Add celebrity / public-figure face detection and block matches.
- [ ] Burn a watermark on free-tier outputs.
- [ ] Wire up error monitoring (Sentry) for both server and client.
- [ ] Add a Terms of Service + log consent (IP + timestamp + hashed identity) with every submission.

---

## Tech stack

- **Next.js 14** (Pages Router)
- **React 18**
- **CSS Modules** — no Tailwind, no styled-components
- **Magic Hour API** — <https://docs.magichour.ai>
- **formidable** — multipart parsing inside API routes
- **uuid** — job IDs
- In-memory job store (swap for Supabase / Postgres in prod — see `lib/jobs.js`)

---

## Docs

- Magic Hour API docs: <https://docs.magichour.ai>
- Magic Hour developer portal: <https://magichour.ai/developer>
