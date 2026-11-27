# TheSpace — a cozy pixel-art virtual office

Teams get a shared pixel-art office to walk around in. You sign up, create or join a workspace, pick an avatar, and step into an office that is generated from your answers and saved, so every desk and plant stays in the same place.

- **Frontend:** Next.js 16, React 19, Tailwind 4, Phaser 4 (the office game), Framer Motion (`frontend/`)
- **Backend:** Fastify 5, MongoDB via Mongoose, Nodemailer for emails (`backend/`)

The office generator is plain TypeScript in `frontend/components/office/game/`. The backend imports the same code (through the `@/` alias), so the server builds and stores exactly the office the client draws.

---

## Running it locally

```bash
# backend (http://localhost:4000)
cd backend
npm install
npm run dev

# backend tests (uses MONGODB from .env, cleans up after itself)
cd backend
npm test

# frontend (http://localhost:3000)
cd frontend
npm install
npm run dev

# frontend tests (Vitest + Testing Library, no server needed)
cd frontend
npm test
```

`backend/.env`:

| Variable | What it's for |
|---|---|
| `MONGODB` | MongoDB connection string (required) |
| `DB_NAME` | Database name (default `pixelart_office`) |
| `EMAIL_HOST`, `EMAIL_PORT`, `EMAIL_USER`, `EMAIL_PASS`, `EMAIL_FROM` | SMTP for verification and invitation emails |
| `CLIENT_URL` | Frontend URL used in email links |
| `CLIENT_ORIGIN` | Allowed CORS origins, comma-separated (default: any localhost port) |
| `PORT` | API port (default `4000`) |
| `LOG_LEVEL` | Log level (default `info`; `debug`, `warn`, `silent`…) |
| `LOG_REQUESTS` | `off` hides the one-line access log for each request |

The frontend reads `NEXT_PUBLIC_API_URL` (default `http://localhost:4000`).

---

## What we have done

### Accounts & auth
- [x] Sign up with name, email, date of birth and password (passwords hashed)
- [x] Email verification with a 6-digit code (stored hashed, expires, limited attempts, resend cooldown)
- [x] Sign in / sign out with an HttpOnly session cookie ("remember me" = 30 days)
- [x] Sessions stored hashed in MongoDB, removed automatically when they expire (TTL index)
- [x] Rate limit on sign-in attempts
- [x] `GET /api/auth/me` returns the signed-in user and their settings
- [x] Last sign-in time saved

### Onboarding
- [x] Choose a path: create a workspace or join one
- [x] Create flow: name tag → office name/description → purpose → style → floor plan + furniture → avatar → invite → review
- [x] Join flow: invitation code → name tag/avatar → confirm
- [x] Workspace saved to MongoDB; the creator becomes the owner
- [x] Unique 8-character invitation code (unambiguous letters, CSPRNG), rate-limited checks
- [x] Invitation emails sent to teammates, with sent status tracked per invitation
- [x] Joining is idempotent (double clicks never add you twice), and the invitation for your email is used up when you join

### The office
- [x] 6 floor plans (Classic, Open plan, Loft, Home, Study house, Garden café) × 4 styles × 5 team sizes
- [x] 16 furniture groups you can tick on or off
- [x] Office generated **on the server** and stored, so it looks the same on every visit and device
- [x] Walk around, rooms, minimap, lighting, interactions (coffee, sofa break, record player, office cat…)
- [x] Owner can change the floor plan and team size; the office is regenerated and saved for everyone
- [x] Desk nameplates show the real members from the database

### Saved in the database
- [x] **Settings** (music, minimap, name tag) saved on the account, with defaults `sound: off, minimap: on, nameTag: on`
- [x] **Status** (Available / Focusing / On a break) saved per workspace, with the time it changed
- [x] **Desk assignment**: each member keeps one desk; the owner gets desk 1, people who join get the next free one, and desks are re-checked when the plan changes
- [x] **Last seen**: when each member last opened the office
- [x] **Waitlist**: the landing page's early-access form saves emails (no duplicates, rate-limited)
- [x] On startup, older users and members get the default settings and status

### Dashboard
- [x] List of your workspaces
- [x] Owner: rename or edit the description, delete the workspace
- [x] Member: leave the workspace
- [x] **Members** dialog on each card (the same team panel as in the office)

### Team & members
- [x] Roles: **owner** (everything), **admin** (invite code, invitations, desks, removing members), **member**
- [x] Members panel in the office (👥 button) and on the dashboard: avatar, role, desk, status, last seen
- [x] Settings screen in the office to change your name tag and avatar
- [x] Owner/admin: show and copy the invitation code, make a new one (the old one stops working), turn it off/on, set an expiry (never, 1, 7 or 30 days)
- [x] Owner/admin: invite more people after onboarding (existing members and pending invites are skipped), resend (1-minute cooldown) or cancel invitations
- [x] Owner: make someone admin or member, transfer ownership (the old owner becomes an admin); owner/admin: remove members (admins can only remove plain members)
- [x] Owner: change the office style and furniture after creation (the office is rebuilt and saved for everyone)
- [x] Members choose a desk: walk up to an open desk and press E, or pick one in the members panel; owners/admins can move anyone and swap two people's desks (safe against two people grabbing the same desk at once)
- [x] **Desk swap requests**: members ask a teammate for their desk from the members panel; the teammate accepts (desks are swapped atomically) or declines, and the asker can cancel. One open request per pair, at most 3 waiting per person. A request is dropped if either person moves or leaves, or the office is rebuilt
- [x] **Emails** to members who are removed and to the new owner after a transfer (a failed email is logged and never undoes the change)
- [x] The player's last position is saved (every 15 s when moved, when the tab is hidden or closed) and you start there next time; positions reset when the office is rebuilt
- [x] The office reopens clean (no panel left open) when you come back from the dashboard

### No mock data
- [x] Removed the demo office, guest user and the `/office-preview` page
- [x] The office only loads from the server; with no workspace you're sent to onboarding, and with no session you're sent to sign-in
- [x] Removed plan previews and onboarding answers kept only in the browser tab
- [x] Removed "Continue in demo mode" when an invitation code can't be checked
- [x] Removed placeholder copy ("needs the backend", fake "3 teammates online" status)

### Server logs
- [x] Readable, colored logs in development (pino-pretty), JSON in production
- [x] One access line per request: method, path, status, time and user (`LOG_REQUESTS=off` to hide); 4xx/slow requests as warnings, 5xx as errors
- [x] MongoDB connect / disconnect / reconnect, startup summary and clean shutdown on Ctrl+C
- [x] Every new action is logged: invite code viewed/regenerated/revoked, invitations added/sent/resent/cancelled, roles, transfers, removals, desk moves and swaps, saved positions, office rebuilds (with what changed)
- [x] One log line for each write: sign-up, sign-in, workspace saved, office generated or served, plan changed, member joined, desks assigned, status, settings, profile, waitlist
- [x] Failed and rejected requests logged with the reason (request bodies hidden for auth routes)

### Tests
- [x] `npm test` in `backend/` runs 28 end-to-end API tests (Node's test runner + `app.inject`) against the MongoDB in `.env`
- [x] Covers auth, waitlist, creating/joining workspaces, permissions, profile, status, invitations, the invite code, roles, desks, desk swap requests, removal/ownership emails, positions, office changes, ownership transfer, leaving and deleting
- [x] Emails are kept in memory during tests (`MAIL_TRANSPORT=memory`), nothing is really sent
- [x] Uses the same database as the app, but only creates records tagged with a run id (`…@thespace.test`) and deletes exactly those afterwards
- [x] `npm test` in `frontend/` runs 66 component tests (Vitest, jsdom, Testing Library) for the team panel (member/admin/owner views, desks, swap requests, roles, removal, invitations, invite code, errors), the office settings forms (name tag & avatar, style & furniture), the office HUD (status switch, music, members badge, interact button, minimap frame, name tag, toast), the swap-request polling, and the dashboard dialogs (edit, delete/leave, members)
- [x] The 👥 button in the office shows a badge with desk swap requests waiting for you (checked every 30 s and when you come back to the tab), and a toast when a new one arrives

---

## API

| Method | Route | What it does |
|---|---|---|
| POST | `/api/auth/signup` | Create an account and email a code |
| POST | `/api/auth/verify-email` | Check the code |
| POST | `/api/auth/resend-verification` | Send a new code |
| POST | `/api/auth/signin` | Sign in |
| POST | `/api/auth/signout` | Sign out |
| GET | `/api/auth/me` | The signed-in user and their settings |
| PATCH | `/api/auth/me/preferences` | Save settings (sound, minimap, nameTag) |
| GET | `/api/workspaces/mine` | Your workspaces |
| POST | `/api/workspaces` | Create a workspace from the onboarding answers |
| PATCH | `/api/workspaces/:id` | Owner: rename or edit the description |
| DELETE | `/api/workspaces/:id` | Owner: delete · Member: leave |
| GET | `/api/workspaces/:id/office` | The saved office, your desk and status, and who sits where |
| PUT | `/api/workspaces/:id/office/plan` | Owner: change floor plan, team size, style and/or furniture |
| GET | `/api/workspaces/:id/members` | Members with their desk and status, your desk swap requests (owner/admin also see invitations) |
| PATCH | `/api/workspaces/:id/me` | Change your name tag or avatar |
| PATCH | `/api/workspaces/:id/me/status` | Save your status |
| PUT | `/api/workspaces/:id/me/desk` | Take an open desk (owner/admin: swap with whoever sits there) |
| PUT | `/api/workspaces/:id/me/position` | Save where your avatar stands |
| GET | `/api/workspaces/:id/desk-requests` | Your desk swap requests (sent and waiting for you) |
| POST | `/api/workspaces/:id/desk-requests` | Ask a member (`memberId`) to swap desks |
| POST | `/api/workspaces/:id/desk-requests/:requestId/accept` | Accept a request sent to you (swaps the desks) |
| DELETE | `/api/workspaces/:id/desk-requests/:requestId` | Decline a request sent to you, or cancel yours |
| GET | `/api/workspaces/:id/invite` | Owner/admin: the invite code, expiry and whether it works |
| POST | `/api/workspaces/:id/invite/regenerate` | Owner/admin: new code, optional `expiresInDays` |
| PATCH | `/api/workspaces/:id/invite` | Owner/admin: `revoked` and/or `expiresInDays` (1–90 or null) |
| POST | `/api/workspaces/:id/invitations` | Owner/admin: invite more emails |
| POST | `/api/workspaces/:id/invitations/resend` | Owner/admin: send an invitation again |
| DELETE | `/api/workspaces/:id/invitations/:email` | Owner/admin: cancel an invitation |
| PATCH | `/api/workspaces/:id/members/:memberId` | Owner: set role (`admin` / `member`) |
| DELETE | `/api/workspaces/:id/members/:memberId` | Owner/admin: remove a member (they get an email) |
| PUT | `/api/workspaces/:id/members/:memberId/desk` | Owner/admin: move someone to a desk (swaps if taken) |
| POST | `/api/workspaces/:id/transfer` | Owner: hand the workspace to another member (they get an email) |
| GET | `/api/workspaces/invitations/:code` | Check an invitation code |
| POST | `/api/workspaces/join` | Join with an invitation code |
| POST | `/api/waitlist` | Early-access sign-up |
| GET | `/api/health` | Health check |

---

## Future plan

### Next up
- [x] Show waiting desk swap requests in the office (a badge on 👥) without opening the members panel
- [x] Frontend tests for the rest of the office HUD and the dashboard dialogs

### Account
- [ ] Forgot / reset password
- [ ] Change password, name or email
- [ ] See and sign out of other sessions
- [ ] Delete account

### Real-time (multiplayer)
- [ ] WebSocket server for presence: see who's online and where they are walking
- [ ] Show teammates' avatars and live status in the office
- [ ] Proximity chat / voice when avatars are near each other
- [ ] Video calls in the meeting room and call booths
- [ ] Workspace chat (`messages` collection, per room)

### Office life
- [ ] Notice board the owner can edit (`notices` collection)
- [ ] Small stats: coffees made, focus time, cat pets
- [ ] Move furniture around and save the layout

### Production
- [ ] Shared rate limiter (Redis) instead of in-memory
- [ ] Tests for the office generator (API routes are covered by `npm test`)
- [ ] An in-memory MongoDB for tests, so they don't need the cluster
- [ ] Deployment (frontend + API + MongoDB Atlas), HTTPS cookies
