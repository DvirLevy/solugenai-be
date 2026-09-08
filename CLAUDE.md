# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Commands

```bash
docker compose up -d db     # PostgreSQL — required before dev or tests
npm run dev                 # tsx watch, API on http://localhost:4000/api
npm run build               # prisma generate + tsc -p tsconfig.build.json -> dist/
npm start                   # run the compiled build
npm run typecheck           # type-checks src/ AND tests/ (tsconfig.json is noEmit)
npm test                    # Jest, --runInBand

npx jest tests/routes/auth.test.ts        # a single test file
npx jest -t "rotates the refresh token"   # a single test by name substring

npm run prisma:migrate      # create + apply a migration (dev)
npm run prisma:deploy       # apply existing migrations
npm run prisma:studio       # browse data

docker compose up --build   # whole stack in containers
docker compose down -v      # stop and destroy the volume
```

Tests need `TEST_DATABASE_URL` pointing at a **different** database from `DATABASE_URL` —
the suite truncates tables. `docker/init-test-db.sh` creates it on the volume's first
initialisation, so `docker compose down -v` followed by `up -d db` recreates it.

## The frontend is the binding constraint

A finished React frontend lives in a **sibling repository** (`../frontend`) and is already
written against this API. Changing any of the following breaks it:

- **Port 4000.** The frontend inlines `VITE_API_URL=http://localhost:4000/api` at build time.
- **Responses are the bare user object** — `{ id, fullName, email, mustChangePassword }` —
  never wrapped in `{ user: ... }`. Register `201`, login `200`, refresh `200`, me `200`,
  logout `204`.
- **Error bodies are exactly `{ message, errors? }`.** `errors` maps a field name to a single
  message, and the frontend feeds those straight into its form fields. Only the centralised
  error handler writes error responses.
- Zod messages in `src/schemas/auth.schema.ts` mirror `../frontend/src/schemas/auth.schema.ts`
  **word for word**, so a rule reads identically wherever it is caught. Keep them in sync.

The frontend has no refresh wiring, forgot-password or change-password screens yet; the
backend supports all three regardless.

## Environment

**One `.env` file, and only one.** Never create `.env.example`, `.env.local`,
`.env.development` or `.env.production` — this is an explicit project requirement, and the
README documents variable *names* only. `src/config/env.ts` validates everything with Zod at
startup and exits on a bad value; add new configuration there rather than reading
`process.env` elsewhere. All token lifetimes are centralised in that file.

## Architecture

Flow is one-directional: **route → validate → (authenticate) → controller → service → Prisma.**
Controllers hold no business logic; services never touch `req`/`res`.

`src/app.ts` builds the Express app without binding a port so supertest can mount it;
`src/server.ts` owns the listener and graceful shutdown.

### Token design (the part that needs the most context)

- **Access Token** — short-lived JWT, single `userId` claim, cookie at `Path=/`. The only
  credential `authenticate` accepts.
- **Refresh Token** — 256 bits from `crypto.randomBytes`, **not a JWT**, cookie at
  `Path=/api/auth`. Stored only as a **SHA-256** hash. SHA-256 rather than bcrypt is
  deliberate: the hash is a *lookup key*, and bcrypt's per-hash salt would make
  `findUnique({ tokenHash })` impossible.
- **The refresh cookie path is `/api/auth`, not `/api/auth/refresh`.** Logout must receive the
  cookie to delete the row from PostgreSQL; with the narrower path the browser would never
  send it there and logout could only clear cookies. Do not "tighten" this.
- **Rotation inherits the original `expiresAt`** instead of restarting the clock. Otherwise a
  client refreshing on a timer keeps a non-Remember-Me session alive forever and Remember Me
  becomes meaningless.
- **Remember Me selects the Refresh Token lifetime only.** Never lengthen the Access Token.
- Rotation happens in one transaction where `deleteMany` doubles as the claim on the token, so
  two concurrent refreshes cannot both succeed.

### Uniform failures are intentional

Missing, malformed, expired, unknown and already-used tokens all return an identical bare
`401`. Login answers the same for a wrong password and an unknown account, *and* burns a
throwaway bcrypt comparison (`equalisePasswordTiming`) so timing doesn't leak which addresses
exist. `forgot-password` always returns the same `200`. Don't add distinguishing messages to
"help debugging" — the sameness is the feature.

### Password recovery

The **Lambda generates** the temporary password, emails it, and returns it; the backend hashes
it. The stored password is replaced **only after the Lambda confirms delivery** — hashing first
would lock a user out with a password they never received when a send fails. There is a test
asserting the old hash survives a Lambda failure.

`POST /auth/change-password` is **public** (`email` + `tempPassword` + `newPassword`), a
deliberate deviation from the original spec's "must be protected": a user in recovery has no
valid session, so the emailed password is the credential. All contact with the Lambda stays in
`src/services/email.service.ts`.

**Temporary password expiry (`User.tempPasswordExpiresAt`, `config.tempPassword.expiresInMs`,
default `TEMP_PASSWORD_EXPIRATION=10m`).** Set only while `passwordHash` holds a temporary
password; null for a real one. `isTempPasswordExpired()` in `auth.service.ts` gates both
`loginUser` and `changePassword` — it must stay on both. Gating only `changePassword` would
leave an intercepted email usable for login forever, since nothing would force the user to
ever "finish" the reset. Login reports an expired temp password as the ordinary
invalid-credentials `401`; `changePassword` reports it with a distinct "has expired" message,
which is safe only because the caller already proved they know the value via a successful
bcrypt comparison. There is no cleanup job — `invalidateExpiredTempPassword()` lazily burns
the hash (overwrites it with a fresh random value) the moment an expired attempt is caught, so
a lingering expired hash in the database is inert even before anyone touches it again. A new
`forgot-password` call always works regardless of this state and resets the window.

### Singleton PrismaClient

`src/db/prisma.ts` exports one shared instance; every service imports it. Node's module cache
already provides the singleton, so there is no Singleton *class* — the spec explicitly warns
against over-engineering it. The `globalThis` guard exists only because `tsx watch`
re-evaluates modules and would otherwise leak a connection pool per file save. Prisma logging
is silenced under `NODE_ENV=test` because the suite deliberately triggers handled failures such
as duplicate-email constraints.

## Testing

All tests live under `tests/`, mirroring `src/` — **never co-located** (enforced by `roots` in
`jest.config.js`). Integration tests hit a real PostgreSQL rather than mocking Prisma. The
bcrypt cost factor drops under `NODE_ENV=test`.

`tests/routes/docs.test.ts` asserts `openapi.yaml` documents **exactly** the routes the router
exposes — adding an endpoint without documenting it fails the suite.

## Build configuration gotchas

- **Two tsconfigs.** `tsconfig.json` covers `src/` + `tests/` with `noEmit` (IDE and
  `typecheck`); `tsconfig.build.json` is the emitting one. Editing only the base config won't
  change the build output.
- **`module`/`moduleResolution` are `node16`.** The older `node` and `node10` values are
  deprecated in TypeScript 6 and produce errors in the editor. Output is still CommonJS
  (`package.json` has no `"type": "module"`).
- **`prisma` is a runtime dependency, not a dev one** — the container runs
  `prisma migrate deploy` on start, so the CLI must survive `npm ci --omit=dev`.
- `openapi.yaml` is resolved via `path.resolve(__dirname, '../../openapi.yaml')`, which lands
  on the repo root from `src/routes` (tsx), `dist/routes` (built) and inside the image. If you
  move it, update the Dockerfile `COPY` too.
- `package.json` has an npm 12 `allowScripts` block permitting Prisma/esbuild postinstall
  scripts. Adding a dependency with install scripts may need `npm install-scripts approve`.
- **`bcryptjs`, not native `bcrypt`** — no C++ toolchain needed in Alpine.

## Docker

Compose inherits `NODE_ENV` from `.env` (normally `development`), so cookies are not `Secure`
and localhost works over plain HTTP. Setting `NODE_ENV=production` switches cookies to
`Secure` + `SameSite=None`, which **requires HTTPS** — the stack will appear broken over plain
HTTP on localhost. The only value Compose overrides is `DATABASE_URL`, whose host is `db`
rather than `localhost`; that override is what lets a single `.env` serve both execution modes.

## Known trade-offs (documented in README, don't "fix" without discussion)

- Logout deletes the row and clears cookies, but the Access Token JWT stays cryptographically
  valid until it expires. That's inherent to stateless tokens and is why the lifetime is short.
- `forgot-password` has a timing side channel — a real account waits for the Lambda round trip.
- No rate limiting anywhere; deliberate, given the "no extra infrastructure" constraint.
