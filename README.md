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

# frontend (http://localhost:3000)
cd frontend
npm install
npm run dev
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

### No mock data
- [x] Removed the demo office, guest user and the `/office-preview` page
- [x] The office only loads from the server; with no workspace you're sent to onboarding, and with no session you're sent to sign-in
- [x] Removed plan previews and onboarding answers kept only in the browser tab
- [x] Removed "Continue in demo mode" when an invitation code can't be checked
- [x] Removed placeholder copy ("needs the backend", fake "3 teammates online" status)

### Server logs
- [x] Readable, colored logs in development (pino-pretty), JSON in production
- [x] One log line for each write: sign-up, sign-in, workspace saved, office generated or served, plan changed, member joined, desks assigned, status, settings, profile, waitlist
- [x] Failed and rejected requests logged with the reason (request bodies hidden for auth routes)

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
| PUT | `/api/workspaces/:id/office/plan` | Owner: change floor plan and team size |
| GET | `/api/workspaces/:id/members` | Members with their desk and status (owner also sees invitations) |
| PATCH | `/api/workspaces/:id/me` | Change your name tag or avatar |
| PATCH | `/api/workspaces/:id/me/status` | Save your status |
| GET | `/api/workspaces/invitations/:code` | Check an invitation code |
| POST | `/api/workspaces/join` | Join with an invitation code |
| POST | `/api/waitlist` | Early-access sign-up |
| GET | `/api/health` | Health check |

---

## Future plan

### Next up
- [ ] Settings screen to change your name tag and avatar (the route already exists)
- [ ] Members panel in the office and dashboard (uses `GET /:id/members`)
- [ ] Owner: show, regenerate or revoke the invitation code and set an expiry
- [ ] Owner: invite more people after onboarding, resend or cancel invitations
- [ ] Owner: remove a member, change roles, transfer ownership
- [ ] Owner: change style and furniture after creation
- [ ] Let members choose or swap desks
- [ ] Save the player's last position in the office

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
- [ ] Tests for routes and the office generator
- [ ] Deployment (frontend + API + MongoDB Atlas), HTTPS cookies
