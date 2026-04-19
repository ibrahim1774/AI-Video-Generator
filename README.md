# FaceForge

A luxury, minimal face-swap SaaS built on **Next.js 14** (Pages Router) and the **Replicate** API.

Upload a source video + a reference face photo, and FaceForge sends both to Replicate's `arabyai-replicate/roop_face_swap` model, polls for completion, and gives you back a finished MP4 — wrapped in a dark, premium UI.

---

## Quick start

1. Create a Replicate API token at <https://replicate.com/account/api-tokens>.
2. Install dependencies:
   ```bash
   npm install
   ```
3. Configure the environment:
   ```bash
   cp .env.example .env.local
   # then edit .env.local and set REPLICATE_API_TOKEN
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

## Deploying on Vercel

1. Push the repo to GitHub and import it in the Vercel dashboard.
2. In **Project → Settings → Environment Variables**, add:
   - `REPLICATE_API_TOKEN` — your token from Replicate.
   - (Optional, for the future billing phase) `STRIPE_SECRET_KEY` — your Stripe secret.
   Set scope to **Production, Preview, and Development**.
3. Trigger a deploy. Vercel's serverless functions support the 100 MiB upload limit Replicate's SDK enforces.

> **Note on duration:** the roop model has no hard duration cap, but quality and runtime degrade past ~60 seconds. Trim long clips before uploading. Replicate's prediction timeout is 60 minutes.

---

## How it works

### User flow

1. **Upload** — drop in a source video and a reference face photo, check the consent box, hit *Create face swap*.
2. **Processing** — the UI shows a gold progress ring while the backend polls Replicate every 3 s.
3. **Result** — on completion the finished MP4 plays inline and can be downloaded with one click.

### Backend flow

1. **Browser uploads each file directly to [tmpfiles.org](https://tmpfiles.org)** (free temp host, 100 MB max, files auto-delete in 60 min). This bypasses Vercel's 4.5 MB request-body limit on serverless functions. See [lib/uploader.js](lib/uploader.js).
2. `POST /api/swap` receives a tiny JSON body `{ videoUrl, faceUrl }` and creates a Replicate prediction against `arabyai-replicate/roop_face_swap` (pinned version). Replicate fetches both URLs server-side. The returned `prediction.id` is stored on the in-memory job.
3. The client receives `{ jobId, predictionId, status }`.
4. The client polls `GET /api/status?jobId=...` every 3 s. The server calls `replicate.predictions.get(predictionId)`, normalizes the status (`succeeded → complete`, `failed/canceled → error`, else `processing`), and on completion stores the prediction's output URL as `resultUrl`.
5. `GET /api/jobs` returns the in-memory list for the History tab.

> **Note:** the tmpfiles.org hop is a temporary stage. For production, replace [lib/uploader.js](lib/uploader.js) with Vercel Blob (`@vercel/blob/client`) or S3/R2 presigned uploads — no other files need to change.

---

## Tips for the best face-swap results

- **Source face photo**: front-facing, well-lit, no sunglasses or heavy occlusion. JPG/PNG.
- **Target video**: keep clips short (≤30 s for the snappiest results), single dominant face per frame, stable lighting. MP4/MOV/WEBM up to 100 MB.
- **Resolution**: 720p–1080p is the sweet spot. Higher resolutions cost more Replicate credits and don't materially improve identity transfer.

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
│   ├── Navbar.js / Navbar.module.css
│   ├── UploadZone.js / UploadZone.module.css
│   ├── Processing.js / Processing.module.css
│   ├── Result.js / Result.module.css
│   └── JobHistory.js / JobHistory.module.css
├── lib/
│   ├── replicate.js
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

- [ ] Replace the in-memory store in `lib/jobs.js` with Supabase / Postgres.
- [ ] Add user auth (NextAuth, Clerk, or Supabase Auth) and scope jobs per user.
- [ ] Add Stripe billing (checkout + webhook + credit gate on `/api/swap`).
- [ ] Switch polling for **Replicate webhooks** (`webhook` + `webhook_events_filter` on `predictions.create`).
- [ ] Add rate limiting (per-IP + per-user) on `/api/swap`.
- [ ] Validate MIME types (don't trust extensions).
- [ ] Burn a watermark on free-tier outputs.
- [ ] Wire up Sentry on server + client.
- [ ] Add a Terms of Service + log consent (IP, timestamp, hashed identity) per submission.

---

## Tech stack

- **Next.js 14** (Pages Router)
- **React 18**
- **CSS Modules** — no Tailwind, no styled-components
- **Replicate** (`replicate` JS SDK) — <https://replicate.com/docs>
- **Model**: [`arabyai-replicate/roop_face_swap`](https://replicate.com/arabyai-replicate/roop_face_swap)
- **formidable** — multipart parsing inside API routes
- **uuid** — job IDs
- In-memory job store (swap for Supabase / Postgres in prod — see `lib/jobs.js`)
