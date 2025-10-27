# Tipjar – Starbucks Tip Report Extractor

Tipjar is a privacy-preserving Netlify application that turns Starbucks “Tip Distribution Report” screenshots or PDFs into an editable tip calculator. The frontend runs as an offline-first Vite + React + Tailwind PWA and the backend streams uploads directly to Azure AI Document Intelligence (Read API) without persisting anything.

## Features

- 📷 Upload or capture reports (PDF or image, ≤15&nbsp;MB)
- 🧠 In-memory OCR via Azure Document Intelligence prebuilt Read model
- 🧮 Automatic partner table with live tip calculator and rounding (cent, dime, quarter, dollar)
- ✍️ Editable payouts with localStorage persistence and text-paste fallback
- 📦 Offline-ready PWA shell (API calls remain online-only)
- 🔐 Zero analytics, zero data retention, Azure learning opt-out enforced

## Prerequisites

- Node.js 18+
- Netlify CLI (`npm install -g netlify-cli`) for local function emulation
- Azure AI Document Intelligence resource with the Read model enabled

## Environment variables

Create a local `.env` file in the project root (not committed) and add:

```bash
AZURE_CV_ENDPOINT=
AZURE_CV_KEY=<your-azure-key>
SESSION_SECRET=<random-string>
```

Replicate the same values in **Netlify → Site settings → Build & deploy → Environment**. The application reads the Azure credentials at runtime, and the Netlify Function will refuse to run without them.

> ℹ️ Never commit `.env` or share production secrets. The repository already includes `.env.example` as a template.

## Development

```bash
npm install
npm run dev
```

- `npm run dev:web` – Vite dev server (PWA frontend)
- `npm run dev:api` – Netlify Functions emulator at `/.netlify/functions/*`
- `npm run dev` – Runs both concurrently

Tipjar stores UI state in `localStorage`. Use a private/incognito window to test from a clean slate.

## Building & deploying

The project is ready for one-click Netlify deploys:

1. Push to GitHub and connect the repository to Netlify.
2. Set the three environment variables on Netlify.
3. Deploy – Netlify will run `npm run build` and publish `apps/web/dist`.

To test locally before deploying:

```bash
npm run build
```

The PWA shell caches static assets for offline use. Network requests to `/api/extract` always go online to protect data freshness and prevent offline storage of sensitive files.

## API usage

`POST /api/extract`

- Accepts `multipart/form-data` with a single `file` (image or PDF ≤15&nbsp;MB)
- Streams the file to Azure Read API with `x-ms-cognitive-service-learning-optout: true`
- Returns normalized JSON with partner rows, total hours, optional store metadata, and warnings

Example `curl` request:

```bash
curl -X POST \
  -H "Content-Type: multipart/form-data" \
  -F "file=@TipDistributionReport.pdf" \
  https://<your-site>.netlify.app/api/extract
```

Example response:

```json
{
  "store_number": "66900",
  "time_period": "10/13/2025–10/19/2025",
  "total_tippable_hours": 346.76,
  "partners": [
    { "partner_number": "12345", "name": "Doe, Jane", "partner_global_id": "US12345678", "hours": 27.10 }
  ],
  "confidence": 0.98,
  "warnings": []
}
```

## Frontend workflow

1. Upload or capture a report (mobile camera supported) – a progress bar indicates secure in-memory processing.
2. Review and edit partner rows. Tip totals, hourly rate, and rounding updates recalculate instantly.
3. Adjust rounding: choose none, cent, dime, quarter, or dollar. Rounding deltas are highlighted.
4. Use the manual text fallback when OCR is blocked—paste the report text, hit **Parse text**, and continue editing.
5. The footer always displays “Made by William Walsh · Starbucks Store #66900.”

All UI state (partners, rounding, total tips, pasted text) persists locally via `localStorage` so partners can resume work even offline. Clearing browser storage resets the calculator.

## Privacy controls

- Files never touch disk: uploads stream directly from the browser to the Netlify Function, then to Azure, and responses are discarded after processing.
- Azure requests set `x-ms-cognitive-service-learning-optout: true` and should have “Limit data collection” enabled in the Azure portal.
- Server logs only capture request IDs and durations—no document content or PII is stored.
- No analytics, telemetry, or tracking scripts are included anywhere in the app.

## Text fallback formatting tips

When pasting report content manually, ensure each partner line resembles:

```
12345  Smith, Alex J  US98765432  31.45
```

and include a line such as:

```
Total Tippable Hours: 346.76
```

The parser uses these patterns to populate the calculator. You can edit any row afterward if formatting varies.

---

Made by William Walsh · Starbucks Store #66900.
