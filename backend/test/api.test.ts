/**
 * End-to-end API tests: the real Fastify app, the real MongoDB from .env
 * (same database as the app), emails kept in memory.
 *
 * Everything this suite creates is tagged with a run id (emails end in
 * `@thespace.test`, workspace names start with "Test ") and deleted in `after`,
 * so it never touches anyone's real data.
 *
 *   npm test
 */
import assert from "node:assert/strict";
import { after, before, describe, it } from "node:test";
import mongoose from "mongoose";
import { connectDb } from "../src/db.ts";
import { outbox } from "../src/lib/mailer.ts";
import { buildApp } from "../src/server.ts";
import { SessionModel } from "../src/models/Session.ts";
import { UserModel } from "../src/models/User.ts";
import { WaitlistModel } from "../src/models/Waitlist.ts";
import { WorkspaceModel } from "../src/models/Workspace.ts";

assert.equal(process.env.MAIL_TRANSPORT, "memory", "Run with `npm test` so no real emails are sent.");

const RUN = `t${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`;
const email = (who: string) => `${who}.${RUN}@thespace.test`;
const PASSWORD = "correct-horse-battery";

let app: Awaited<ReturnType<typeof buildApp>>;
const userIds: string[] = [];

// Each call comes from its own address, so the per-IP rate limits never trip.
let ipCounter = 1;
const ip = () => `10.${(ipCounter >> 16) & 255}.${(ipCounter >> 8) & 255}.${ipCounter++ & 255}`;

type Res = { status: number; body: any; cookie?: string };

async function call(method: "GET" | "POST" | "PUT" | "PATCH" | "DELETE", url: string, cookie?: string, body?: unknown): Promise<Res> {
  const res = await app.inject({
    method,
    url,
    remoteAddress: ip(),
    headers: cookie ? { cookie } : undefined,
    ...(body === undefined ? {} : { payload: body as object }),
  });
  const set = res.cookies.find((c) => c.name === "session");
  return { status: res.statusCode, body: res.body ? JSON.parse(res.body) : null, cookie: set?.value ? `session=${set.value}` : undefined };
}

/** Sign up, read the code from the in-memory outbox, verify, and return the session cookie. */
async function newUser(who: string) {
  const addr = email(who);
  const signup = await call("POST", "/api/auth/signup", undefined, { fullName: `${who} Tester`, email: addr, dob: "1995-04-02", password: PASSWORD });
  assert.equal(signup.status, 201, JSON.stringify(signup.body));
  userIds.push(signup.body.user.id);
  const mail = [...outbox].reverse().find((m) => m.to === addr);
  const code = mail?.text.match(/\b(\d{6})\b/)?.[1];
  assert.ok(code, "verification email has a 6-digit code");
  const verify = await call("POST", "/api/auth/verify-email", undefined, { email: addr, code });
  assert.equal(verify.status, 200);
  assert.ok(verify.cookie, "verifying signs you in");
  return { email: addr, cookie: verify.cookie!, id: signup.body.user.id as string };
}

before(async () => {
  await connectDb();
  app = await buildApp();
  await app.ready();
});

after(async () => {
  // Remove only what this run created.
  const ws = await WorkspaceModel.deleteMany({ $or: [{ "members.userId": { $in: userIds } }, { name: new RegExp(`^Test .*${RUN}$`) }] });
  const sessions = await SessionModel.deleteMany({ userId: { $in: userIds } });
  const users = await UserModel.deleteMany({ email: new RegExp(`\\.${RUN}@thespace\\.test$`) });
  const wl = await WaitlistModel.deleteMany({ email: new RegExp(`\\.${RUN}@thespace\\.test$`) });
  console.log(`cleanup: ${users.deletedCount} users, ${sessions.deletedCount} sessions, ${ws.deletedCount} workspaces, ${wl.deletedCount} waitlist`);
  await app.close();
  await mongoose.disconnect();
});

describe("health & waitlist", () => {
  it("answers the health check", async () => {
    const r = await call("GET", "/api/health");
    assert.equal(r.status, 200);
    assert.deepEqual(r.body, { ok: true });
  });

  it("saves a waitlist email once", async () => {
    const addr = email("waitlist");
    assert.equal((await call("POST", "/api/waitlist", undefined, { email: addr })).status, 201);
    const again = await call("POST", "/api/waitlist", undefined, { email: addr });
    assert.equal(again.status, 200);
    assert.equal(again.body.alreadyOnList, true);
    assert.equal((await call("POST", "/api/waitlist", undefined, { email: "nope" })).status, 400);
  });
});

describe("auth", () => {
  let alice: Awaited<ReturnType<typeof newUser>>;

  it("signs up and verifies by email code", async () => {
    alice = await newUser("authy");
    const me = await call("GET", "/api/auth/me", alice.cookie);
    assert.equal(me.status, 200);
    assert.equal(me.body.user.email, alice.email);
    assert.deepEqual(me.body.user.preferences, { sound: false, minimap: true, nameTag: true });
  });

  it("refuses a duplicate email and a weak password", async () => {
    const dup = await call("POST", "/api/auth/signup", undefined, { fullName: "X", email: alice.email, dob: "1990-01-01", password: PASSWORD });
    assert.equal(dup.status, 409);
    const weak = await call("POST", "/api/auth/signup", undefined, { fullName: "X", email: email("weak"), dob: "1990-01-01", password: "short" });
    assert.equal(weak.status, 400);
  });

  it("signs in with the right password only", async () => {
    assert.equal((await call("POST", "/api/auth/signin", undefined, { email: alice.email, password: "wrong-password" })).status, 401);
    const ok = await call("POST", "/api/auth/signin", undefined, { email: alice.email, password: PASSWORD });
    assert.equal(ok.status, 200);
    assert.ok(ok.cookie);
  });

  it("saves preferences", async () => {
    const r = await call("PATCH", "/api/auth/me/preferences", alice.cookie, { sound: true });
    assert.equal(r.status, 200);
    assert.equal(r.body.preferences.sound, true);
    assert.equal((await call("PATCH", "/api/auth/me/preferences", alice.cookie, {})).status, 400);
  });

  it("rejects workspace calls without a session, and after sign-out", async () => {
    assert.equal((await call("GET", "/api/workspaces/mine")).status, 401);
    const s = await call("POST", "/api/auth/signin", undefined, { email: alice.email, password: PASSWORD });
    await call("POST", "/api/auth/signout", s.cookie, {});
    assert.equal((await call("GET", "/api/workspaces/mine", s.cookie)).status, 401);
  });
});

describe("workspace lifecycle", () => {
  let owner: Awaited<ReturnType<typeof newUser>>;
  let bob: Awaited<ReturnType<typeof newUser>>;
  let cat: Awaited<ReturnType<typeof newUser>>;
  let id = "";
  let code = "";
  let bobId = "";
  let catId = "";
  let officeSavedAt = "";
  const base = () => `/api/workspaces/${id}`;
  const members = async (cookie: string) => (await call("GET", `${base()}/members`, cookie)).body;

  before(async () => {
    [owner, bob, cat] = [await newUser("owner"), await newUser("bob"), await newUser("cat")];
  });

  it("creates a workspace with a generated office", async () => {
    const r = await call("POST", "/api/workspaces", owner.cookie, {
      displayName: "Olive",
      avatarId: "buddy-maya",
      workspaceName: `Test HQ ${RUN}`,
      purpose: "remote-team",
      teamSize: "6-15",
      workspaceStyle: "cozy-green",
      officeLayout: "classic",
      officeFeatures: ["desks", "plants", "kitchen"],
      invitationEmails: [email("pending"), owner.email],
    });
    assert.equal(r.status, 201, JSON.stringify(r.body));
    id = r.body.workspaceId;
    code = r.body.inviteCode;
    assert.match(code, /^[A-Z2-9]{4}-[A-Z2-9]{4}$/);
    // The owner's own email is never invited.
    assert.equal(r.body.invitationsSent, 1);
    assert.ok(outbox.some((m) => m.to === email("pending") && m.text.includes(code)));

    const office = await call("GET", `${base()}/office`, owner.cookie);
    assert.equal(office.status, 200);
    assert.equal(office.body.role, "owner");
    assert.equal(office.body.me.desk, 0);
    assert.equal(office.body.me.position, null);
    assert.ok(office.body.office.objects.length > 0);
    officeSavedAt = office.body.savedAt;
  });

  it("rejects bad create input", async () => {
    const r = await call("POST", "/api/workspaces", owner.cookie, { displayName: "x", avatarId: "nobody", workspaceName: "y", purpose: "a", teamSize: "b", workspaceStyle: "c", officeLayout: "d" });
    assert.equal(r.status, 400);
  });

  it("lets people join with the code, once", async () => {
    const check = await call("GET", `/api/workspaces/invitations/${code.toLowerCase()}`, bob.cookie);
    assert.equal(check.status, 200);
    assert.equal(check.body.invitedBy, "Olive");
    const join = await call("POST", "/api/workspaces/join", bob.cookie, { displayName: "Bob", avatarId: "buddy-theo", invitationCode: code });
    assert.equal(join.status, 201);
    bobId = join.body.memberId;
    const again = await call("POST", "/api/workspaces/join", bob.cookie, { displayName: "Bob", avatarId: "buddy-theo", invitationCode: code });
    assert.equal(again.status, 200);
    assert.equal(again.body.alreadyMember, true);
    const list = await members(owner.cookie);
    assert.equal(list.members.length, 2);
    assert.equal(list.members.find((m: any) => m.memberId === bobId).desk, 2);
  });

  it("hides invitations and management from plain members", async () => {
    const list = await members(bob.cookie);
    assert.equal(list.invitations, undefined);
    assert.equal(list.role, "member");
    assert.equal((await call("GET", `${base()}/invite`, bob.cookie)).status, 403);
    assert.equal((await call("POST", `${base()}/invitations`, bob.cookie, { emails: [email("x")] })).status, 403);
    assert.equal((await call("PUT", `${base()}/office/plan`, bob.cookie, { workspaceStyle: "quiet-minimal" })).status, 403);
    assert.equal((await call("PATCH", `${base()}/members/${bobId}`, bob.cookie, { role: "admin" })).status, 403);
  });

  it("never shows a workspace to non-members", async () => {
    assert.equal((await call("GET", `${base()}/office`, cat.cookie)).status, 404);
    assert.equal((await call("GET", `${base()}/members`, cat.cookie)).status, 404);
    assert.equal((await call("GET", `/api/workspaces/not-an-id/members`, cat.cookie)).status, 404);
  });

  it("changes your name tag and avatar", async () => {
    const r = await call("PATCH", `${base()}/me`, bob.cookie, { displayName: "  Bobby ", avatarId: "buddy-kai" });
    assert.equal(r.status, 200);
    assert.equal(r.body.displayName, "Bobby");
    assert.equal(r.body.avatarId, "buddy-kai");
    assert.equal((await call("PATCH", `${base()}/me`, bob.cookie, { displayName: "   " })).status, 400);
    assert.equal((await call("PATCH", `${base()}/me`, bob.cookie, { avatarId: "buddy-nobody" })).status, 400);
    assert.equal((await members(owner.cookie)).members.find((m: any) => m.memberId === bobId).displayName, "Bobby");
  });

  it("saves status", async () => {
    const r = await call("PATCH", `${base()}/me/status`, bob.cookie, { status: "focusing" });
    assert.equal(r.status, 200);
    assert.equal((await members(owner.cookie)).members.find((m: any) => m.memberId === bobId).status, "focusing");
  });

  it("invites more people, skipping duplicates and members", async () => {
    const bad = await call("POST", `${base()}/invitations`, owner.cookie, { emails: ["not-an-email"] });
    assert.equal(bad.status, 400);
    const r = await call("POST", `${base()}/invitations`, owner.cookie, { emails: [email("pending"), bob.email, email("dana"), email("Dana")] });
    assert.equal(r.status, 201, JSON.stringify(r.body));
    assert.deepEqual(r.body.added, [email("dana")]);
    assert.deepEqual(r.body.skipped.map((s: any) => s.reason).sort(), ["already a member", "already invited"]);
    assert.equal(r.body.sent, 1);
    assert.ok(outbox.some((m) => m.to === email("dana")));
    const inv = r.body.invitations.find((i: any) => i.email === email("dana"));
    assert.equal(inv.sendCount, 1);
  });

  it("limits resends and cancels invitations", async () => {
    const resend = await call("POST", `${base()}/invitations/resend`, owner.cookie, { email: email("dana") });
    assert.equal(resend.status, 429, "just sent → cooldown");
    // Pretend it was sent long ago, then resend.
    await WorkspaceModel.updateOne({ _id: id }, { $set: { "invitations.$[i].sentAt": new Date(0) } }, { arrayFilters: [{ "i.email": email("dana") }] });
    const ok = await call("POST", `${base()}/invitations/resend`, owner.cookie, { email: email("dana") });
    assert.equal(ok.status, 200);
    assert.equal(ok.body.invitations.find((i: any) => i.email === email("dana")).sendCount, 2);
    assert.equal((await call("POST", `${base()}/invitations/resend`, owner.cookie, { email: email("ghost") })).status, 404);

    const cancel = await call("DELETE", `${base()}/invitations/${encodeURIComponent(email("dana"))}`, owner.cookie);
    assert.equal(cancel.status, 200);
    assert.ok(!cancel.body.invitations.some((i: any) => i.email === email("dana")));
    assert.equal((await call("DELETE", `${base()}/invitations/${encodeURIComponent(email("dana"))}`, owner.cookie)).status, 404);
  });

  it("regenerates, expires, revokes and restores the invite code", async () => {
    const view = await call("GET", `${base()}/invite`, owner.cookie);
    assert.equal(view.status, 200);
    assert.equal(view.body.code, code);
    assert.equal(view.body.active, true);

    const regen = await call("POST", `${base()}/invite/regenerate`, owner.cookie, { expiresInDays: 7 });
    assert.equal(regen.status, 200);
    assert.notEqual(regen.body.code, code);
    const days = (new Date(regen.body.expiresAt).getTime() - Date.now()) / 86_400_000;
    assert.ok(days > 6.9 && days <= 7, `expires in ~7 days, got ${days}`);
    assert.equal((await call("GET", `/api/workspaces/invitations/${code}`, cat.cookie)).status, 404, "old code is dead");
    code = regen.body.code;

    assert.equal((await call("PATCH", `${base()}/invite`, owner.cookie, { expiresInDays: 500 })).status, 400);
    const forever = await call("PATCH", `${base()}/invite`, owner.cookie, { expiresInDays: null });
    assert.equal(forever.body.expiresAt, null);

    const revoked = await call("PATCH", `${base()}/invite`, owner.cookie, { revoked: true });
    assert.equal(revoked.body.active, false);
    assert.equal((await call("POST", "/api/workspaces/join", cat.cookie, { displayName: "Cat", avatarId: "buddy-juno", invitationCode: code })).status, 404);
    assert.equal((await call("POST", `${base()}/invitations`, owner.cookie, { emails: [email("eve")] })).status, 409);

    const restored = await call("PATCH", `${base()}/invite`, owner.cookie, { revoked: false });
    assert.equal(restored.body.active, true);

    // An expired code stops working too.
    await WorkspaceModel.updateOne({ _id: id }, { $set: { inviteCodeExpires: new Date(Date.now() - 1000) } });
    assert.equal((await call("GET", `/api/workspaces/invitations/${code}`, cat.cookie)).status, 404);
    await call("PATCH", `${base()}/invite`, owner.cookie, { expiresInDays: null });
  });

  it("changes roles and enforces who can remove whom", async () => {
    const join = await call("POST", "/api/workspaces/join", cat.cookie, { displayName: "Cat", avatarId: "buddy-juno", invitationCode: code });
    assert.equal(join.status, 201);
    catId = join.body.memberId;

    const promote = await call("PATCH", `${base()}/members/${bobId}`, owner.cookie, { role: "admin" });
    assert.equal(promote.status, 200);
    assert.equal(promote.body.role, "admin");
    assert.equal((await call("PATCH", `${base()}/members/${bobId}`, owner.cookie, { role: "owner" })).status, 400, "can't make a second owner");

    // Admins manage the code and invitations, but can't change roles or remove the owner.
    assert.equal((await call("GET", `${base()}/invite`, bob.cookie)).status, 200);
    assert.ok(Array.isArray((await members(bob.cookie)).invitations));
    assert.equal((await call("PATCH", `${base()}/members/${catId}`, bob.cookie, { role: "admin" })).status, 403);
    const ownerMemberId = (await members(owner.cookie)).members.find((m: any) => m.role === "owner").memberId;
    assert.equal((await call("DELETE", `${base()}/members/${ownerMemberId}`, bob.cookie)).status, 403);
    assert.equal((await call("DELETE", `${base()}/members/${bobId}`, bob.cookie)).status, 400, "admins leave, not remove themselves");

    const removed = await call("DELETE", `${base()}/members/${catId}`, bob.cookie);
    assert.equal(removed.status, 200);
    assert.equal(removed.body.members.length, 2);
    const bye = outbox.find((m) => m.to === cat.email && m.subject.startsWith("You were removed"));
    assert.ok(bye, "removed member gets an email");
    assert.match(bye!.text, /Bobby removed you/);
    assert.equal((await call("GET", `${base()}/office`, cat.cookie)).status, 404, "removed members lose access");
  });

  it("lets members take open desks and managers swap desks", async () => {
    const join = await call("POST", "/api/workspaces/join", cat.cookie, { displayName: "Cat", avatarId: "buddy-juno", invitationCode: code });
    catId = join.body.memberId;
    const list = await members(owner.cookie);
    assert.ok(list.desks >= 4, `classic 6-15 has enough desks (got ${list.desks})`);
    const taken = new Set(list.members.map((m: any) => m.desk));
    const open = Array.from({ length: list.desks }, (_, i) => i + 1).find((d) => !taken.has(d))!;
    const ownerDesk = list.members.find((m: any) => m.role === "owner").desk;
    const bobDesk = list.members.find((m: any) => m.memberId === bobId).desk;

    assert.equal((await call("PUT", `${base()}/me/desk`, cat.cookie, { desk: 999 })).status, 400);
    assert.equal((await call("PUT", `${base()}/me/desk`, cat.cookie, { desk: ownerDesk })).status, 409, "members can't take a taken desk");
    const moved = await call("PUT", `${base()}/me/desk`, cat.cookie, { desk: open });
    assert.equal(moved.status, 200);
    assert.equal(moved.body.desk, open);

    // A member can't move other people.
    assert.equal((await call("PUT", `${base()}/members/${bobId}/desk`, cat.cookie, { desk: open })).status, 403);
    // The owner swaps Cat onto Bob's desk.
    const swap = await call("PUT", `${base()}/members/${catId}/desk`, owner.cookie, { desk: bobDesk });
    assert.equal(swap.status, 200, JSON.stringify(swap.body));
    assert.equal(swap.body.swappedWith.memberId, bobId);
    const after = (await members(owner.cookie)).members;
    assert.equal(after.find((m: any) => m.memberId === catId).desk, bobDesk);
    assert.equal(after.find((m: any) => m.memberId === bobId).desk, open);
    const desks = after.map((m: any) => m.desk);
    assert.equal(new Set(desks).size, desks.length, "no two people share a desk");

    // The office shows Cat's new desk as theirs.
    const office = await call("GET", `${base()}/office`, cat.cookie);
    assert.equal(office.body.me.desk, bobDesk - 1);
    assert.equal(office.body.seats.find((s: any) => s.at === bobDesk - 1).kind, "mine");
  });

  it("saves the player's last position", async () => {
    const office = (await call("GET", `${base()}/office`, bob.cookie)).body;
    const { tx, ty } = office.office.spawn;
    const spot = { x: tx * 16 + 8, y: ty * 16 + 8 };
    const ok = await call("PUT", `${base()}/me/position`, bob.cookie, { ...spot, officeSavedAt: office.savedAt });
    assert.equal(ok.status, 200, JSON.stringify(ok.body));
    const back = (await call("GET", `${base()}/office`, bob.cookie)).body;
    assert.deepEqual(back.me.position, spot);

    assert.equal((await call("PUT", `${base()}/me/position`, bob.cookie, { x: -40, y: 10 })).status, 400, "outside the office");
    const wy = office.office.walls.findIndex((row: boolean[]) => row.some(Boolean));
    const wx = office.office.walls[wy].findIndex(Boolean);
    assert.equal((await call("PUT", `${base()}/me/position`, bob.cookie, { x: wx * 16 + 8, y: wy * 16 + 8 })).status, 400, "inside a wall");
    assert.equal((await call("PUT", `${base()}/me/position`, bob.cookie, { ...spot, officeSavedAt: "2001-01-01T00:00:00.000Z" })).status, 409, "stale office");
  });

  it("lets the owner change style and furniture, resetting positions", async () => {
    const r = await call("PUT", `${base()}/office/plan`, owner.cookie, { workspaceStyle: "creative-studio", officeFeatures: ["desks", "cat", "rugs"] });
    assert.equal(r.status, 200, JSON.stringify(r.body));
    assert.equal(r.body.config.workspaceStyle, "creative-studio");
    assert.deepEqual([...r.body.config.features].sort(), ["cat", "desks", "rugs"]);
    assert.notEqual(r.body.savedAt, officeSavedAt);
    // Nothing from unticked groups (plants, kitchen) is placed.
    assert.ok(!r.body.office.objects.some((o: any) => ["plant", "small-plant", "coffee-machine", "fridge"].includes(o.kind)));

    const bobOffice = (await call("GET", `${base()}/office`, bob.cookie)).body;
    assert.equal(bobOffice.me.position, null, "positions reset for the new office");
    const desks = (await members(owner.cookie)).members.map((m: any) => m.desk);
    assert.ok(desks.every((d: any) => typeof d === "number"), "everyone still has a desk");

    const same = await call("PUT", `${base()}/office/plan`, owner.cookie, { workspaceStyle: "creative-studio" });
    assert.equal(same.body.savedAt, r.body.savedAt, "no change → office kept");
    assert.equal((await call("PUT", `${base()}/office/plan`, owner.cookie, { officeFeatures: ["sofa-bed"] })).status, 400);
    assert.equal((await call("PUT", `${base()}/office/plan`, owner.cookie, {})).status, 400);

    const plan = await call("PUT", `${base()}/office/plan`, owner.cookie, { officeLayout: "loft", teamSize: "16-50" });
    assert.equal(plan.status, 200);
    assert.equal(plan.body.config.layout, "loft");
  });

  it("transfers ownership", async () => {
    assert.equal((await call("POST", `${base()}/transfer`, bob.cookie, { memberId: catId })).status, 403);
    const r = await call("POST", `${base()}/transfer`, owner.cookie, { memberId: bobId });
    assert.equal(r.status, 200);
    const roles = Object.fromEntries(r.body.members.map((m: any) => [m.displayName, m.role]));
    assert.deepEqual(roles, { Olive: "admin", Bobby: "owner", Cat: "member" });
    const crown = outbox.find((m) => m.to === bob.email && m.subject.startsWith("You now own"));
    assert.ok(crown, "new owner gets an email");
    assert.match(crown!.text, /Olive handed/);
    assert.equal((await call("PUT", `${base()}/office/plan`, owner.cookie, { workspaceStyle: "quiet-minimal" })).status, 403, "old owner lost owner rights");
    assert.equal((await call("PUT", `${base()}/office/plan`, bob.cookie, { workspaceStyle: "quiet-minimal" })).status, 200);
    assert.equal((await call("PATCH", base(), bob.cookie, { workspaceName: `Test Renamed ${RUN}` })).status, 200);
  });

  it("lets members leave and the owner delete", async () => {
    assert.equal((await call("DELETE", base(), cat.cookie)).body.left, true);
    assert.equal((await members(bob.cookie)).members.length, 2);
    assert.equal((await call("DELETE", base(), bob.cookie)).body.deleted, true);
    const mine = await call("GET", "/api/workspaces/mine", owner.cookie);
    assert.ok(!mine.body.workspaces.some((w: any) => w.workspaceId === id));
  });
});

describe("desk swap requests", () => {
  let ann: Awaited<ReturnType<typeof newUser>>;
  let ben: Awaited<ReturnType<typeof newUser>>;
  let cy: Awaited<ReturnType<typeof newUser>>;
  let id = "";
  const ids: Record<string, string> = {};
  const base = () => `/api/workspaces/${id}`;
  const list = async (cookie: string) => (await call("GET", `${base()}/members`, cookie)).body;
  const deskOf = async (memberId: string) => (await list(ann.cookie)).members.find((m: any) => m.memberId === memberId).desk;

  before(async () => {
    [ann, ben, cy] = [await newUser("ann"), await newUser("ben"), await newUser("cy")];
    const r = await call("POST", "/api/workspaces", ann.cookie, {
      displayName: "Ann",
      avatarId: "buddy-maya",
      workspaceName: `Test Swaps ${RUN}`,
      purpose: "remote-team",
      teamSize: "6-15",
      workspaceStyle: "cozy-green",
      officeLayout: "classic",
      officeFeatures: ["desks"],
      invitationEmails: [],
    });
    assert.equal(r.status, 201, JSON.stringify(r.body));
    id = r.body.workspaceId;
    const code = r.body.inviteCode;
    await call("GET", `${base()}/office`, ann.cookie);
    ids.ann = (await list(ann.cookie)).members[0].memberId;
    for (const [who, name] of [[ben, "Ben"], [cy, "Cy"]] as const) {
      const j = await call("POST", "/api/workspaces/join", who.cookie, { displayName: name, avatarId: "buddy-theo", invitationCode: code });
      assert.equal(j.status, 201);
      ids[name.toLowerCase()] = j.body.memberId;
    }
  });

  it("asks, refuses duplicates and shows the request to both sides", async () => {
    assert.equal((await call("POST", `${base()}/desk-requests`, ben.cookie, { memberId: ids.ben })).status, 400, "not yourself");
    assert.equal((await call("POST", `${base()}/desk-requests`, ben.cookie, { memberId: "000000000000000000000000" })).status, 404);
    const ask = await call("POST", `${base()}/desk-requests`, ben.cookie, { memberId: ids.cy });
    assert.equal(ask.status, 201, JSON.stringify(ask.body));
    assert.equal(ask.body.requests[0].direction, "outgoing");
    assert.equal((await call("POST", `${base()}/desk-requests`, ben.cookie, { memberId: ids.cy })).status, 409, "already asked");
    assert.equal((await call("POST", `${base()}/desk-requests`, cy.cookie, { memberId: ids.ben })).status, 409, "they asked you first");

    const cyView = (await list(cy.cookie)).deskRequests;
    assert.equal(cyView.length, 1);
    assert.equal(cyView[0].direction, "incoming");
    assert.equal(cyView[0].from.displayName, "Ben");
    assert.equal((await list(ann.cookie)).deskRequests.length, 0, "other people don't see it");
  });

  it("only lets the person asked accept, and swaps the desks", async () => {
    const [benDesk, cyDesk] = [await deskOf(ids.ben), await deskOf(ids.cy)];
    const req = (await list(cy.cookie)).deskRequests[0];
    assert.equal((await call("POST", `${base()}/desk-requests/${req.requestId}/accept`, ben.cookie)).status, 403, "the asker can't accept");
    assert.equal((await call("POST", `${base()}/desk-requests/${req.requestId}/accept`, ann.cookie)).status, 403, "nor can the owner");
    const ok = await call("POST", `${base()}/desk-requests/${req.requestId}/accept`, cy.cookie);
    assert.equal(ok.status, 200, JSON.stringify(ok.body));
    assert.equal(ok.body.desk, benDesk);
    assert.equal(await deskOf(ids.ben), cyDesk);
    assert.equal(await deskOf(ids.cy), benDesk);
    assert.equal((await list(cy.cookie)).deskRequests.length, 0, "request used up");
    assert.equal((await call("POST", `${base()}/desk-requests/${req.requestId}/accept`, cy.cookie)).status, 404);
  });

  it("declines and cancels", async () => {
    const ask = await call("POST", `${base()}/desk-requests`, ben.cookie, { memberId: ids.ann });
    assert.equal(ask.status, 201);
    assert.equal((await call("DELETE", `${base()}/desk-requests/${ask.body.requestId}`, cy.cookie)).status, 403, "not yours");
    const declined = await call("DELETE", `${base()}/desk-requests/${ask.body.requestId}`, ann.cookie);
    assert.equal(declined.body.declined, true);

    const again = await call("POST", `${base()}/desk-requests`, ben.cookie, { memberId: ids.ann });
    const cancelled = await call("DELETE", `${base()}/desk-requests/${again.body.requestId}`, ben.cookie);
    assert.equal(cancelled.body.cancelled, true);
    assert.equal(cancelled.body.requests.length, 0);
  });

  it("drops a request once someone moves", async () => {
    const ask = await call("POST", `${base()}/desk-requests`, cy.cookie, { memberId: ids.ann });
    assert.equal(ask.status, 201);
    const listing = await list(ann.cookie);
    const taken = new Set(listing.members.map((m: any) => m.desk));
    const open = Array.from({ length: listing.desks }, (_, i) => i + 1).find((d) => !taken.has(d))!;
    assert.equal((await call("PUT", `${base()}/me/desk`, cy.cookie, { desk: open })).status, 200);
    assert.equal((await list(ann.cookie)).deskRequests.length, 0, "stale request hidden");
    assert.equal((await call("POST", `${base()}/desk-requests/${ask.body.requestId}/accept`, ann.cookie)).status, 404);
  });

  it("clears every request when the office is rebuilt", async () => {
    const r1 = await call("POST", `${base()}/desk-requests`, ben.cookie, { memberId: ids.ann });
    const r2 = await call("POST", `${base()}/desk-requests`, ben.cookie, { memberId: ids.cy });
    assert.equal(r1.status, 201);
    assert.equal(r2.status, 201);
    assert.equal((await call("PUT", `${base()}/office/plan`, ann.cookie, { workspaceStyle: "quiet-minimal" })).status, 200);
    assert.equal((await list(ben.cookie)).deskRequests.length, 0, "office rebuild clears requests");
  });
});
