# AI Usage

Built with Claude Code (Claude Sonnet 5 / Opus 5) as a coding assistant, under my direction
throughout.

## The AI's Role

- I broke the work into 5 tasks up front and **approved each one individually** before it
  started — the AI was not allowed to roll from one task into the next on its own.
- Every ambiguous or risky decision was put to me as an explicit question rather than assumed:
  cookie path trade-offs, Remember Me scope, the temp-password expiry design, the exact
  external Lambda contract. I chose the answer each time.
- I supplied the real external contract myself (the Lambda's URL, API key, request/response
  field names) incrementally, and told the AI explicitly when **not** to call it yet.
- I tested the real system myself — logging in through the actual frontend, checking Chrome
  DevTools, pasting the raw network requests and responses back — and caught real bugs this
  way that no test suite would have: a route name mismatch between frontend and backend, and
  a missing `Origin` header the Lambda required.
- When a fix had two valid approaches (e.g. alias the backend route vs. fix the frontend call),
  I picked which one, not the AI.
- I reviewed the code directly and caught at least one real issue myself (an inverted doc
  comment) before asking for it to be fixed.

## The AI's Role

Implementation, test-writing, and verification (`curl` against the running server/Docker
stack, checking cookies and DB state) within the scope I approved at each step.
