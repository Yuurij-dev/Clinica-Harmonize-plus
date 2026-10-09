<!-- BEGIN:nextjs-agent-rules -->

# This is NOT the Next.js you know

This version has breaking changes — APIs, conventions, and file structure may all differ from your training data. Read the relevant guide in `node_modules/next/dist/docs/` (resolved from this file's directory; in monorepos the `next` package may not be visible from the repo root) before writing any code. Heed deprecation notices.

This block is written and re-added by `next dev` — verify at `node_modules/next/dist/server/lib/generate-agent-files.js`. Removing it from a diff only re-creates the uncommitted change; committing it with your work keeps the tree clean.

<!-- END:nextjs-agent-rules -->

## Data loading and performance

- Read `docs/data-loading.md` before adding a data-backed screen or changing an API response.
- Use `getCachedJson` from `src/lib/client-cache.ts` for authenticated GETs. Use a stable key containing the resource ID and all query parameters. Read `readClientCache` for immediate initial UI, then call `getCachedJson` to revalidate when needed. Do not add independent raw GET effects for the same resource.
- Keep auth checks and time-critical notifications uncached. Never persist patient data in localStorage/sessionStorage or a service worker.
- Set the cache scope from the authenticated user and clinic before rendering private data; clear it on logout, 401, or account change. Do not reuse data across patients, clinics, or users.
- After successful mutations, invalidate only affected keys with `invalidateClientCache`; include list keys when list summaries or journey stages change. Do not invalidate on failed mutations.
- Return only fields a screen uses. List endpoints must not include full images, histories, or unrelated relations. Avoid N+1 database access; paginate large lists when UI and API can both support it.
- Avoid background polling of broad bootstrap endpoints. Live data should have a small, purpose-built response and an interval justified by the workflow.
- Add focused cache/invalidation tests when changing shared data-loading behavior. Preserve existing layout and business rules.
