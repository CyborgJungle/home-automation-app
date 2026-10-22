# CLAUDE.md

## Workflow

- Merge changes straight into `main` and push. Don't open pull requests.
- Pushing `main` deploys `web/` to Vercel production (project `home-automation`, team `cyborgjungle`). Check that the deployment comes up READY.
- Before pushing, run the checks for the part you changed (below).
- Commit messages: a short plain-English summary line, like the existing history.

## Layout

- `web/` is the Next.js app on Vercel (phone home-screen app). Read `web/AGENTS.md` first: this Next.js version differs from what you know.
- `agent/` is the Node agent on the Raspberry Pi. It talks to devices on the home network (IKEA, Brel, Sony, Sonos, Apple, Roborock, network presence) and syncs with Supabase. Integrations live in `agent/src/integrations/`.
- `supabase/` holds migrations, the edge functions (`evohome`, `weather`) and tests.
- The Supabase project is `home-automation`, ref `YOUR-PROJECT-REF`. Use the Supabase connector (`mcp__Supabase__*`) for this project. The Supabase plugin may not be able to connect.

## Checks

- web: `cd web && npm ci && npx next typegen && npx tsc --noEmit && npm run lint`
- agent: `cd agent && npm ci && npm run check && npm test`
- supabase: `cd supabase/tests && npm ci && npm test`

## Notes

- Schema changes go in a new file in `supabase/migrations/` and get applied to the project. Every table uses RLS.
- Pushing doesn't update the Pi. It needs the agent copied over (see the README, section 3), so say so when a change touches `agent/`.
- Write user-facing text in plain, friendly English, matching the app.
