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
import { NoticeModel } from "../src/models/Notice.ts";
import { MessageModel } from "../src/models/Message.ts";
import { catalog } from "@/components/office/game/furniture";
import { groupOf, isMovable, placementProblem, unreachable, type FurnitureMeta } from "@/components/office/game/layoutEdit";

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
  const mine = await WorkspaceModel.find({ $or: [{ "members.userId": { $in: userIds } }, { name: new RegExp(`^Test .*${RUN}$`) }] }, { _id: 1 });
  const notices = await NoticeModel.deleteMany({ workspaceId: { $in: mine.map((w) => w._id) } });
  await MessageModel.deleteMany({ workspaceId: { $in: mine.map((w) => w._id) } });
  const ws = await WorkspaceModel.deleteMany({ $or: [{ "members.userId": { $in: userIds } }, { name: new RegExp(`^Test .*${RUN}$`) }] });
  const sessions = await SessionModel.deleteMany({ userId: { $in: userIds } });
  const users = await UserModel.deleteMany({ email: new RegExp(`\\.${RUN}@thespace\\.test$`) });
  const wl = await WaitlistModel.deleteMany({ email: new RegExp(`\\.${RUN}@thespace\\.test$`) });
  console.log(`cleanup: ${users.deletedCount} users, ${sessions.deletedCount} sessions, ${ws.deletedCount} workspaces, ${notices.deletedCount} notices, ${wl.deletedCount} waitlist`);
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

describe("office life", () => {
  let owner: Awaited<ReturnType<typeof newUser>>;
  let mia: Awaited<ReturnType<typeof newUser>>;
  let id = "";
  const base = () => `/api/workspaces/${id}`;

  before(async () => {
    [owner, mia] = [await newUser("lifeowner"), await newUser("mia")];
    const r = await call("POST", "/api/workspaces", owner.cookie, {
      displayName: "Oona",
      avatarId: "buddy-maya",
      workspaceName: `Test Life ${RUN}`,
      purpose: "remote-team",
      teamSize: "6-15",
      workspaceStyle: "cozy-green",
      officeLayout: "classic",
      officeFeatures: ["desks", "kitchen", "plants", "seating", "office", "cat"],
      invitationEmails: [],
    });
    assert.equal(r.status, 201, JSON.stringify(r.body));
    id = r.body.workspaceId;
    await call("GET", `${base()}/office`, owner.cookie);
    const j = await call("POST", "/api/workspaces/join", mia.cookie, { displayName: "Mia", avatarId: "buddy-theo", invitationCode: r.body.inviteCode });
    assert.equal(j.status, 201);
  });

  it("lets the owner write the notice board and everyone read it", async () => {
    const empty = await call("GET", `${base()}/notices`, mia.cookie);
    assert.equal(empty.status, 200);
    assert.deepEqual(empty.body.notices, []);
    assert.equal(empty.body.canEdit, false);
    assert.equal((await call("POST", `${base()}/notices`, mia.cookie, { text: "Hi" })).status, 403, "members only read");
    assert.equal((await call("POST", `${base()}/notices`, owner.cookie, { text: "   " })).status, 400, "no empty notes");

    const first = await call("POST", `${base()}/notices`, owner.cookie, { text: "Standup at 10:30", color: "sage" });
    assert.equal(first.status, 201, JSON.stringify(first.body));
    assert.equal(first.body.notice.authorName, "Oona");
    const second = await call("POST", `${base()}/notices`, owner.cookie, { text: "Pizza Friday" });
    assert.equal(second.status, 201);
    const noteId = first.body.notice.noticeId;

    const pinned = await call("PATCH", `${base()}/notices/${noteId}`, owner.cookie, { pinned: true, text: "Standup at 10:00" });
    assert.equal(pinned.status, 200);
    assert.equal(pinned.body.notices[0].noticeId, noteId, "pinned notes come first");
    assert.equal(pinned.body.notices[0].text, "Standup at 10:00");
    assert.equal((await call("PATCH", `${base()}/notices/${noteId}`, mia.cookie, { pinned: false })).status, 403);

    const read = await call("GET", `${base()}/notices`, mia.cookie);
    assert.equal(read.body.notices.length, 2);
    assert.equal((await call("GET", `${base()}/notices`, owner.cookie)).body.canEdit, true);

    assert.equal((await call("DELETE", `${base()}/notices/${second.body.notice.noticeId}`, mia.cookie)).status, 403);
    const gone = await call("DELETE", `${base()}/notices/${second.body.notice.noticeId}`, owner.cookie);
    assert.equal(gone.status, 200);
    assert.equal(gone.body.notices.length, 1);
    assert.equal((await call("DELETE", `${base()}/notices/${second.body.notice.noticeId}`, owner.cookie)).status, 404);
    assert.equal((await call("DELETE", `${base()}/notices/not-an-id`, owner.cookie)).status, 404);
  });

  it("counts coffees and cat pets, once per few seconds", async () => {
    const cup = await call("POST", `${base()}/me/stats`, mia.cookie, { action: "coffee" });
    assert.equal(cup.status, 200, JSON.stringify(cup.body));
    assert.equal(cup.body.counted, true);
    assert.equal(cup.body.you.coffees, 1);
    assert.equal(cup.body.office.coffees, 1);
    const again = await call("POST", `${base()}/me/stats`, mia.cookie, { action: "coffee" });
    assert.equal(again.body.counted, false, "mashing E counts once");
    assert.equal(again.body.office.coffees, 1);

    assert.equal((await call("POST", `${base()}/me/stats`, owner.cookie, { action: "coffee" })).body.office.coffees, 2, "others count too");
    assert.equal((await call("POST", `${base()}/me/stats`, owner.cookie, { action: "cat" })).body.you.catPets, 1);
    assert.equal((await call("POST", `${base()}/me/stats`, owner.cookie, { action: "nap" })).status, 400);

    const stats = await call("GET", `${base()}/stats`, mia.cookie);
    assert.equal(stats.status, 200);
    assert.deepEqual(stats.body.office, { coffees: 2, catPets: 1, focusMinutes: 0 });
    assert.equal(stats.body.members.length, 2);
  });

  it("adds a finished focus session to focus time, capped at 4 hours", async () => {
    assert.equal((await call("PATCH", `${base()}/me/status`, mia.cookie, { status: "focusing" })).status, 200);
    // Pretend Mia started focusing 25 minutes ago.
    const ws = (await WorkspaceModel.findById(id))!;
    const miaId = ws.members.find((m) => m.displayName === "Mia")!._id;
    await WorkspaceModel.updateOne({ _id: id, "members._id": miaId }, { $set: { "members.$.statusUpdatedAt": new Date(Date.now() - 25 * 60000) } });
    const running = await call("GET", `${base()}/stats`, mia.cookie);
    assert.equal(running.body.you.focusMinutes, 25, "a running session counts");
    assert.equal(running.body.you.focusing, true);

    await call("PATCH", `${base()}/me/status`, mia.cookie, { status: "available" });
    const done = await call("GET", `${base()}/stats`, owner.cookie);
    assert.equal(done.body.members.find((m: any) => m.displayName === "Mia").focusMinutes, 25);
    assert.equal(done.body.office.focusMinutes, 25);

    await call("PATCH", `${base()}/me/status`, mia.cookie, { status: "focusing" });
    await WorkspaceModel.updateOne({ _id: id, "members._id": miaId }, { $set: { "members.$.statusUpdatedAt": new Date(Date.now() - 20 * 3600000) } });
    await call("PATCH", `${base()}/me/status`, mia.cookie, { status: "break" });
    assert.equal((await call("GET", `${base()}/stats`, mia.cookie)).body.you.focusMinutes, 25 + 240, "a forgotten tab counts 4 hours at most");
  });

  it("lets the owner move furniture, with the same rules as the office", async () => {
    const before = (await call("GET", `${base()}/office`, owner.cookie)).body;
    const office = before.office;
    const meta: FurnitureMeta = { rug: { footprint: null, layer: "floor" }, sign: { footprint: null, layer: "wall" } };
    for (const [kind, def] of Object.entries(catalog(office.theme))) meta[kind] = { footprint: def.footprint, layer: def.layer };

    // A plant (one piece, no companions) and a free floor tile it can go to.
    const index = office.objects.findIndex((o: any, i: number) => (o.kind === "plant" || o.kind === "small-plant") && isMovable(o, meta) && groupOf(office.objects, i).length === 1);
    assert.ok(index >= 0, "the office has a plant");
    const plant = office.objects[index];
    let to: { tx: number; ty: number } | null = null;
    for (let ty = 2; ty < office.height - 1 && !to; ty++) {
      for (let tx = 1; tx < office.width - 1 && !to; tx++) {
        if (tx === plant.tx && ty === plant.ty) continue;
        const objects = office.objects.map((o: any, i: number) => (i === index ? { ...o, tx, ty } : o));
        const floor = { ...office, objects };
        if (!placementProblem(floor, [index], meta) && unreachable(floor, meta).length === unreachable(office, meta).length) to = { tx, ty };
      }
    }
    assert.ok(to, "there is somewhere to put the plant");
    const move = { index, kind: plant.kind, from: { tx: plant.tx, ty: plant.ty }, to };

    assert.equal((await call("PUT", `${base()}/office/layout`, mia.cookie, { moves: [move] })).status, 403, "only the owner");
    const wall = await call("PUT", `${base()}/office/layout`, owner.cookie, { moves: [{ ...move, to: { tx: 0, ty: 0 } }] });
    assert.equal(wall.status, 400, "not into the walls");
    const wrong = await call("PUT", `${base()}/office/layout`, owner.cookie, { moves: [{ ...move, from: { tx: plant.tx + 1, ty: plant.ty } }] });
    assert.equal(wrong.status, 409, "a move must match the saved layout");
    const old = await call("PUT", `${base()}/office/layout`, owner.cookie, { moves: [move], officeSavedAt: new Date(0).toISOString() });
    assert.equal(old.status, 409, "not for an older office");

    const ok = await call("PUT", `${base()}/office/layout`, owner.cookie, { moves: [move], officeSavedAt: before.savedAt });
    assert.equal(ok.status, 200, JSON.stringify(ok.body));
    assert.equal(ok.body.moved, 1);
    const after = (await call("GET", `${base()}/office`, mia.cookie)).body.office.objects[index];
    assert.deepEqual({ tx: after.tx, ty: after.ty }, to, "everyone sees the new spot");
    assert.equal((await call("PUT", `${base()}/office/layout`, owner.cookie, { moves: [move] })).status, 409, "the same move twice is stale");
  });

  it("deletes the board with the workspace", async () => {
    assert.equal((await call("DELETE", base(), owner.cookie)).status, 200);
    assert.equal(await NoticeModel.countDocuments({ workspaceId: id }), 0);
  });
});

describe("live office", () => {
  let owner: Awaited<ReturnType<typeof newUser>>;
  let kai: Awaited<ReturnType<typeof newUser>>;
  let outsider: Awaited<ReturnType<typeof newUser>>;
  let id = "";
  const base = () => `/api/workspaces/${id}`;
  const ORIGIN = "http://localhost:3000";

  /** Open the live socket as someone; `next` waits for the first frame of a type (and matching `pred`). */
  async function connect(cookie: string, origin = ORIGIN) {
    const ws = await app.injectWS(`${base()}/live`, { headers: { cookie, origin } });
    const inbox: any[] = [];
    const media: Buffer[] = [];
    let closed: number | null = null;
    ws.on("message", (d: Buffer, isBinary: boolean) => (isBinary ? media.push(d) : inbox.push(JSON.parse(String(d)))));
    ws.on("close", (code: number) => (closed = code));
    const next = (t: string, pred: (m: any) => boolean = () => true, ms = 3000) =>
      new Promise<any>((resolve, reject) => {
        const started = Date.now();
        const look = () => {
          const i = inbox.findIndex((m) => m.t === t && pred(m));
          if (i >= 0) return resolve(inbox.splice(i, 1)[0]);
          if (Date.now() - started > ms) return reject(new Error(`no "${t}" frame within ${ms}ms (got ${inbox.map((m) => m.t).join(", ") || "nothing"})`));
          setTimeout(look, 20);
        };
        look();
      });
    const closedWith = (ms = 3000) =>
      new Promise<number>((resolve, reject) => {
        const started = Date.now();
        const look = () => (closed !== null ? resolve(closed) : Date.now() - started > ms ? reject(new Error("socket stayed open")) : setTimeout(look, 20));
        look();
      });
    /** Wait for a relayed voice/video frame. */
    const nextMedia = (ms = 3000) =>
      new Promise<Buffer>((resolve, reject) => {
        const started = Date.now();
        const look = () => (media.length ? resolve(media.shift()!) : Date.now() - started > ms ? reject(new Error("no media frame")) : setTimeout(look, 20));
        look();
      });
    return { ws, next, nextMedia, media, closedWith, send: (m: object) => ws.send(JSON.stringify(m)) };
  }

  before(async () => {
    [owner, kai, outsider] = [await newUser("liveowner"), await newUser("kai"), await newUser("outsider")];
    const r = await call("POST", "/api/workspaces", owner.cookie, {
      displayName: "Lou",
      avatarId: "buddy-maya",
      workspaceName: `Test Live ${RUN}`,
      purpose: "remote-team",
      teamSize: "6-15",
      workspaceStyle: "cozy-green",
      officeLayout: "classic",
      officeFeatures: ["desks", "kitchen", "plants", "seating", "office", "meeting"],
      invitationEmails: [],
    });
    assert.equal(r.status, 201, JSON.stringify(r.body));
    id = r.body.workspaceId;
    await call("GET", `${base()}/office`, owner.cookie);
    const j = await call("POST", "/api/workspaces/join", kai.cookie, { displayName: "Kai", avatarId: "buddy-theo", invitationCode: r.body.inviteCode });
    assert.equal(j.status, 201);
  });

  it("refuses sockets from other sites", async () => {
    const evil = await connect(owner.cookie, "https://evil.example");
    assert.equal(await evil.closedWith(), 4403);
  });

  it("shows who is here, how they move, what they say and their status", async () => {
    const lou = await connect(owner.cookie);
    const hello = await lou.next("welcome");
    assert.deepEqual(hello.peers, [], "nobody else is in yet");

    const k = await connect(kai.cookie);
    const kHello = await k.next("welcome");
    assert.deepEqual(kHello.peers.map((p: any) => p.name), ["Lou"]);
    const joined = await lou.next("join");
    assert.equal(joined.peer.name, "Kai");
    const kaiId = joined.peer.id;

    const members = await call("GET", `${base()}/members`, owner.cookie);
    assert.ok(members.body.members.every((m: any) => m.online), "both show as in the office");

    k.send({ t: "move", x: joined.peer.x + 4, y: joined.peer.y, frame: 21, anim: "walk-side", flip: true, depth: joined.peer.y, room: "Entrance" });
    const moved = await lou.next("move", (m) => m.id === kaiId);
    assert.equal(moved.anim, "walk-side");
    assert.equal(moved.room, "Entrance");

    // Both stand near the door, so Lou hears Kai.
    k.send({ t: "say", text: "  morning!  " });
    assert.equal((await lou.next("say")).text, "morning!");

    await call("PATCH", `${base()}/me/status`, kai.cookie, { status: "focusing" });
    const status = await lou.next("peer", (m) => m.id === kaiId && m.patch.status);
    assert.equal(status.patch.status, "focusing");

    k.ws.close();
    assert.equal((await lou.next("leave")).id, kaiId);
    lou.ws.close();
  });

  it("keeps one live connection per member (a new tab takes over)", async () => {
    const first = await connect(kai.cookie);
    await first.next("welcome");
    const second = await connect(kai.cookie);
    await second.next("welcome");
    assert.equal(await first.closedWith(), 4409);
    second.ws.close();
  });

  it("relays voice to nearby teammates with their mic on, tagged with who's talking", async () => {
    const lou = await connect(owner.cookie);
    await lou.next("welcome");
    const k = await connect(kai.cookie);
    const louId = (await k.next("welcome")).peers[0].id;
    const kaiId = (await lou.next("join")).peer.id;
    const audio = Buffer.from([1, ...Array.from({ length: 640 }, (_, i) => i % 256)]);

    // Lou's mic is off: Kai's voice isn't sent to him.
    k.send({ t: "voice", on: true });
    await lou.next("peer", (m) => m.id === kaiId && m.patch.voice === true);
    k.ws.send(audio);
    await new Promise((r) => setTimeout(r, 150));
    assert.equal(lou.media.length, 0, "only people with voice on hear it");

    lou.send({ t: "voice", on: true });
    await k.next("peer", (m) => m.patch.voice === true);
    k.ws.send(audio);
    const frame = await lou.nextMedia();
    assert.equal(frame[0], 1, "audio frame");
    assert.equal(frame.subarray(1, 25).toString("ascii"), kaiId, "tagged with the speaker");
    assert.deepEqual(frame.subarray(25), audio.subarray(1));

    // Once Kai reaches Lou over a direct WebRTC link, the server stops relaying to him.
    k.send({ t: "direct", ids: [louId] });
    await new Promise((r) => setTimeout(r, 50));
    k.ws.send(audio);
    await new Promise((r) => setTimeout(r, 150));
    assert.equal(lou.media.length, 0, "no relay for direct pairs");
    k.send({ t: "direct", ids: [] });

    // WebRTC offers are passed on only between the two ends of a link.
    const link = `prox:${[kaiId, louId].sort().join(":")}`;
    k.send({ t: "signal", to: louId, link, data: { kind: "offer", sdp: "v=0" } });
    const offer = await lou.next("signal");
    assert.equal(offer.from, kaiId);
    assert.equal(offer.data.kind, "offer");

    // Video only goes to a call.
    k.ws.send(Buffer.from([2, 0xff, 0xd8, 0xff]));
    await new Promise((r) => setTimeout(r, 150));
    assert.equal(lou.media.length, 0, "no video outside a call");
    k.ws.close();
    lou.ws.close();
  });

  it("only lets people in a call room's call", async () => {
    const lou = await connect(owner.cookie);
    const hello = await lou.next("welcome");
    lou.send({ t: "call", room: "Kitchen" });
    assert.match((await lou.next("error")).message, /meeting room/);
    const room = hello.callRooms[0];
    if (room) {
      lou.send({ t: "call", room });
      const joined = await lou.next("peer", (m) => m.patch.call !== undefined);
      assert.equal(joined.patch.call, room);
    }
    lou.ws.close();
  });

  it("saves workspace chat per channel and sends it live", async () => {
    const lou = await connect(owner.cookie);
    await lou.next("welcome");
    const first = await call("GET", `${base()}/messages`, kai.cookie);
    assert.equal(first.status, 200, JSON.stringify(first.body));
    assert.deepEqual(first.body.messages, []);
    assert.equal(first.body.channels[0], "office");
    assert.ok(first.body.channels.length > 1, "every room has a channel");

    const sent = await call("POST", `${base()}/messages`, kai.cookie, { channel: "office", text: "  Coffee in 5?  " });
    assert.equal(sent.status, 201, JSON.stringify(sent.body));
    assert.equal(sent.body.message.text, "Coffee in 5?");
    assert.equal(sent.body.message.authorName, "Kai");
    assert.equal((await lou.next("chat")).message.messageId, sent.body.message.messageId);

    const roomChannel = first.body.channels[1];
    assert.equal((await call("POST", `${base()}/messages`, owner.cookie, { channel: roomChannel, text: "Room only" })).status, 201);
    const office = await call("GET", `${base()}/messages?channel=office`, owner.cookie);
    assert.deepEqual(office.body.messages.map((m: any) => m.text), ["Coffee in 5?"], "room messages stay in their room");
    const inRoom = await call("GET", `${base()}/messages?channel=${encodeURIComponent(roomChannel)}`, owner.cookie);
    assert.deepEqual(inRoom.body.messages.map((m: any) => m.text), ["Room only"]);

    assert.equal((await call("POST", `${base()}/messages`, kai.cookie, { channel: "Narnia", text: "hi" })).status, 404, "unknown room");
    assert.equal((await call("POST", `${base()}/messages`, kai.cookie, { channel: "office", text: "   " })).status, 400, "no empty messages");
    assert.equal((await call("GET", `${base()}/messages`, outsider.cookie)).status, 404, "only members read the chat");
    lou.ws.close();
  });
});

