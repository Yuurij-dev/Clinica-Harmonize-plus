# Data loading

The app uses the in-memory client cache in `src/lib/client-cache.ts`; it does not need a second query library. The cache is shared across mounted screens, deduplicates simultaneous GETs, and is scoped to the authenticated user and clinic. It is never persisted to browser storage. `HarmonizeApp` waits for `/api/auth/me` before mounting private sections and clears the cache on logout or 401. A cross-tab session-change signal makes other tabs reload.

## Reading data

Use `getCachedJson<T>(key)` for ordinary authenticated GETs. `key` is the full resource URL, including patient ID, tab, journey ID, and filters. When rendering a revisited screen, `readClientCache<T>(key)` can populate state immediately; call `getCachedJson` in the effect to refresh stale entries. Keep an effect cleanup guard so a completed request cannot update a component after switching patient or tab. Do not use this cache for `/api/auth/*` or live appointment alerts.

Freshness/retention (milliseconds) is defined centrally by `policyFor`: agenda 20s/90s, dashboard 45s/180s, patient history 30s/120s, photo detail 60s/120s, catalogs/settings 5m/15m, other GETs 60s/5m. Retained stale data may be displayed while a new request runs. The cache has an 80-entry limit, including at most six photo-heavy entries.

## Changing data

After the server confirms a POST, PATCH, or DELETE, call `invalidateClientCache` with the exact keys or list prefixes affected. Invalidating `/api/patients` refreshes the patient list but does not remove every patient's history; invalidate `/api/patients/{id}/history` separately when the history changed. Failed mutations must leave cached data intact. The invalidation event can refresh mounted views that need immediate synchronization.

## API and database

List endpoints should return summaries with Prisma `select`, not entire relations or base64 image fields. Keep full photos and history behind patient-specific detail endpoints. Use clinic-scoped `where` clauses on every private query. Prefer a bounded, purpose-built endpoint for frequent polling (`/api/agenda/alerts`) over fetching a full bootstrap payload. Before adding pagination, account for client-side search/filter behavior so existing results remain complete.

## Verification

Run `node --test tests/client-cache.test.mjs`, `npx tsc --noEmit`, targeted lint, and a build after shared cache or API changes. For request-volume comparisons, record a fixed navigation flow with browser Network logs before/after; do not infer real byte savings or latency from static code alone. Authenticated browser measurements require a reachable database and test account.
