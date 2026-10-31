# FIT upload verification — manual checklist (issue #446)

The FIT export + intervals.icu upload path is the row's own contract with the
outside world: every finished session lands on intervals.icu as an activity
row, or the row's data is lost. Automated tests cover the encoder shape
(`src/__tests__/fitEncoderService.test.ts`, `src/__tests__/fitUploadRoundTrip.test.ts`)
and the mocked request shape (`src/__tests__/intervalsIcuActivityService.test.ts`,
`playwright/tests/activity-upload.spec.ts`); an opt-in nightly contract check
(`npm run test:contract:upload`) POSTs the checked-in fixture to a real
account. This document is the human-eyes leg — what to look at when a PR
touches the FIT / upload path.

## When to run this

Before merging any PR whose diff touches:

- `src/lib/services/fitEncoderService.ts` or anything it imports.
- `src/lib/services/intervalsIcuActivityService.ts`, `src/lib/services/authService.ts`,
  the `PROXY_BASE` constant, or the token-refresh path.
- `src/lib/utils/exporters.ts::activityFileName`.
- The `SessionSummary` upload button flow in `src/lib/ui/SessionSummary.svelte`.

## Prerequisites

- A signed-in intervals.icu account with `ACTIVITY:WRITE` in the OAuth
  scopes (the app requests this at login by default).
- `npm run dev` running on `http://localhost:5173/virtualrow/app/`.
- A reachable `PROXY_BASE` — the CORS worker that carries the multipart POST
  (see `MaximumTrainer/MaximumTrainer_Redux#359`). The client's `authService.ts`
  reads its URL from `VITE_INTERVALS_PROXY_BASE`.

## The click path

1. Sign in via the intervals.icu OAuth button in the header.
2. On the Row screen, confirm the default route is Willowbrook River.
3. Click **▶ Try a demo row** — the simulated erg + HR streams start.
4. Row for at least ~30 s so the session has a lap boundary and real
   samples (a shorter row still uploads, just without splits).
5. When the workout completes (either finish the route or let the demo
   time out), the SessionSummary modal opens.
6. Click **Save to intervals.icu**.

## What the DevTools Network tab should show

Open DevTools → Network before clicking **Save to intervals.icu**. You
should see one request:

- **URL**: `${PROXY_BASE}/api/v1/athlete/0/activities?name=...&description=...&external_id=virtualrow-<session id>`
  — see the `uploadUrl` helper at `src/lib/services/intervalsIcuActivityService.ts:59`.
- **Method**: `POST`.
- **Request headers**: `Authorization: Bearer <access token>` (the token is
  never logged elsewhere). No explicit `Content-Type` — the browser sets it
  so the multipart boundary matches the body.
- **Request payload**: multipart `form-data` with a single `file` part named
  `<route slug>-<session id>.fit` (see `activityFileName` in
  `src/lib/utils/exporters.ts:125`).
- **Response**: `200` (or `201`) with a JSON body whose top-level `id`
  parses as a numeric activity id.
- **Repeat click**: a second click should show no new request — the service
  short-circuits duplicates (`src/lib/services/intervalsIcuActivityService.ts:108`).

If the token is expired the client retries once through
`authService.refreshAccessToken()`; you'll see a `401` followed by a fresh
`POST`. Two `401`s in a row is the "sign in again" case (AC3.4 in #221).

## What the intervals.icu activity page should show

Open the URL the summary card links to. On the activity page, verify:

- **Title**: the route name (Willowbrook River, in this checklist).
- **Description**: `Rowed in VirtualRow on Willowbrook River.` — see
  `src/lib/services/intervalsIcuActivityService.ts:62`.
- **External id**: `virtualrow-<session id>` under the row's metadata.
  This is what dedupes a re-upload of the same session.
- **Sport / sub-sport**: Rowing / Indoor Rowing.
- **Distance**: matches the session summary to the whole metre.
- **Total time**: matches the session summary to the whole second.
- **Splits**: one 500 m row per split the summary shows, in the same order.
- **Streams (if present in the row)**: HR, power, cadence and pace all
  non-empty. Any stream missing in the app should be absent on intervals.icu
  too — an empty stream on the activity page for a stream the app recorded
  is a regression.
- **GPS trace on the map**: for a route with geometry, the map should show a
  polyline matching the route. For a demo row without geometry, no map
  should render.

## GPS polyline check (issue #466, AC8)

The FIT encoder writes `positionLat` / `positionLong` as sint32 semicircles
on every record (`src/lib/services/fitEncoderService.ts` — `buildRecords`,
`toSemicircles`), fed by `src/lib/services/activitySampler.ts` interpolating
lat/lng along the route polyline via `interpolateAlong` in
`src/lib/utils/polylineGeometry.ts`.
On the intervals.icu activity page, that chain renders as a map polyline.
This is the last leg the automated tests cannot run — a visual check that
the polyline matches the real-water route, not a straight line through
land.

Run this with a route whose geometry has clear bends (Willowbrook River
is the default and works well — it curves):

1. Open the activity page from step 6 above.
2. Scroll to the **Map** panel. For a route-backed row, a polyline MUST
   render — not an empty map, not a single pin, not a straight line
   between distant points. The polyline shape SHOULD visually match the
   source route (same bends, same bank, same length).
3. Click any point on the polyline. The point-info popup SHOULD show a
   lat/lng that lands on the source route to roughly a metre.
4. **Gate-chain routes only** (`geometrySource: 'gate-chain'` —
   `src/lib/types/index.ts`): the polyline is a straight line between the
   start and finish gates by design. SessionSummary surfaces a notice
   that the GPS trace is schematic — expected, not a regression.
5. **Demo rows** (`▶ Try a demo row`): the demo passes a route, so a
   polyline SHOULD render. A demo row that lands with an empty map is a
   regression.

If the polyline is missing, straight across land for a non-gate-chain
route, or diverges visibly from the source route, do not merge — the
sampler or the encoder has regressed. See **Rollback signal** below.

## Evidence to attach to a PR

Every PR that touches the paths listed under **When to run this** should
attach, in the PR description:

1. The activity URL from step 6 above.
2. A screenshot of the intervals.icu activity page showing the title,
   description, external id, distance, total time, splits and streams.
3. A screenshot of the **Map** panel showing the GPS polyline (issue
   #466, AC11) — the shape must match the source route.
4. The `external_id` string, copy-pasted (so a search on the account can
   find it if it ever needs re-verifying).

## Rollback signal

If any of the intervals.icu-page checks fail — a missing stream, a wrong
sport, a distance that doesn't match, splits missing, the external id
missing, the map empty for a geometry-carrying route — **do not merge**.
The FIT encoder or the upload service has regressed. Revert the change and
land a follow-up PR that fixes the failing check with a corresponding test.

The opt-in `npm run test:contract:upload` script provides a second gate on
the same account when the FIT wire format changes — the nightly CI job
(`.github/workflows/contract-upload.yml`) surfaces regressions within 24 h,
but this manual leg is what catches shape-vs-display bugs the API accepts
silently.
