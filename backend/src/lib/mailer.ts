import nodemailer from "nodemailer";

const port = Number(process.env.EMAIL_PORT ?? 587);

/**
 * MAIL_TRANSPORT=memory keeps every email in `outbox` instead of sending it
 * (used by the tests, which read verification codes from there).
 */
const inMemory = process.env.MAIL_TRANSPORT === "memory";

export type SentMail = { to: string; subject: string; text: string };
export const outbox: SentMail[] = [];

const transporter = inMemory
  ? nodemailer.createTransport({ jsonTransport: true })
  : nodemailer.createTransport({
      host: process.env.EMAIL_HOST,
      port,
      secure: port === 465, // 465 = implicit TLS; 587 upgrades with STARTTLS
      auth: { user: process.env.EMAIL_USER, pass: process.env.EMAIL_PASS },
    });

async function send(mail: { from: string; to: string; subject: string; text: string; html: string }) {
  if (inMemory) outbox.push({ to: mail.to, subject: mail.subject, text: mail.text });
  await transporter.sendMail(mail);
}

const FROM = process.env.EMAIL_FROM || process.env.EMAIL_USER;
const APP_NAME = "TheSpace";

export async function verifyMailer() {
  if (inMemory) return;
  await transporter.verify();
}

export async function sendVerificationEmail(to: string, name: string, code: string) {
  const first = name.split(" ")[0] || "there";
  await send({
    from: FROM?.includes("<") ? FROM : `${APP_NAME} <${FROM}>`,
    to,
    subject: `${code} is your ${APP_NAME} verification code`,
    text: `Hi ${first},\n\nYour ${APP_NAME} verification code is: ${code}\n\nIt expires in 10 minutes. If you didn't sign up, you can ignore this email.`,
    html: `<div style="font-family:system-ui,sans-serif;max-width:480px;margin:auto;padding:24px;color:#2b2b2b">
  <h2 style="margin:0 0 12px">Hi ${escapeHtml(first)},</h2>
  <p>Enter this code to verify your ${APP_NAME} account:</p>
  <p style="font-size:32px;font-weight:700;letter-spacing:8px;background:#f4ecd8;border:2px solid #2b2b2b;padding:16px;text-align:center">${code}</p>
  <p style="color:#666;font-size:14px">It expires in 10 minutes. If you didn't sign up, you can ignore this email.</p>
</div>`,
  });
}

function escapeHtml(s: string) {
  return s.replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]!);
}

export async function sendInvitationEmail(to: string, inviter: string, workspaceName: string, code: string) {
  const link = `${process.env.CLIENT_URL ?? "http://localhost:3000"}/onboarding`;
  await send({
    from: FROM?.includes("<") ? FROM : `${APP_NAME} <${FROM}>`,
    to,
    subject: `${inviter} invited you to ${workspaceName} on ${APP_NAME}`,
    text: `${inviter} invited you to join "${workspaceName}" on ${APP_NAME}.\n\nYour invitation code is: ${code}\n\nOpen ${link}, choose "Join a workspace" and enter the code.`,
    html: `<div style="font-family:system-ui,sans-serif;max-width:480px;margin:auto;padding:24px;color:#2b2b2b">
  <h2 style="margin:0 0 12px">You're invited!</h2>
  <p>${escapeHtml(inviter)} invited you to join <strong>${escapeHtml(workspaceName)}</strong> on ${APP_NAME}.</p>
  <p>Your invitation code:</p>
  <p style="font-size:28px;font-weight:700;letter-spacing:6px;background:#f4ecd8;border:2px solid #2b2b2b;padding:16px;text-align:center">${code}</p>
  <p><a href="${link}">Open ${APP_NAME}</a>, choose “Join a workspace” and enter the code.</p>
</div>`,
  });
}

const CLIENT = () => process.env.CLIENT_URL ?? "http://localhost:3000";
const wrap = (body: string) => `<div style="font-family:system-ui,sans-serif;max-width:480px;margin:auto;padding:24px;color:#2b2b2b">\n${body}\n</div>`;
const fromHeader = () => (FROM?.includes("<") ? FROM : `${APP_NAME} <${FROM}>`);

/** Tell someone they were removed from a workspace. */
export async function sendRemovedEmail(to: string, name: string, workspaceName: string, by: string) {
  const first = name.split(" ")[0] || "there";
  await send({
    from: fromHeader(),
    to,
    subject: `You were removed from ${workspaceName} on ${APP_NAME}`,
    text: `Hi ${first},\n\n${by} removed you from "${workspaceName}" on ${APP_NAME}. You can no longer open its office.\n\nIf you think this was a mistake, ask them for a new invitation code.`,
    html: wrap(`  <h2 style="margin:0 0 12px">Hi ${escapeHtml(first)},</h2>
  <p>${escapeHtml(by)} removed you from <strong>${escapeHtml(workspaceName)}</strong> on ${APP_NAME}. You can no longer open its office.</p>
  <p style="color:#666;font-size:14px">If you think this was a mistake, ask them for a new invitation code.</p>`),
  });
}

/** Tell someone they now own a workspace. */
export async function sendOwnershipEmail(to: string, name: string, workspaceName: string, from: string) {
  const first = name.split(" ")[0] || "there";
  const link = `${CLIENT()}/dashboard`;
  await send({
    from: fromHeader(),
    to,
    subject: `You now own ${workspaceName} on ${APP_NAME}`,
    text: `Hi ${first},\n\n${from} handed "${workspaceName}" over to you, so you're its owner now. ${from} stays on as an admin.\n\nAs the owner you can change the floor plan, style and furniture, set roles, and delete the workspace. Open ${link} to get started.`,
    html: wrap(`  <h2 style="margin:0 0 12px">Hi ${escapeHtml(first)},</h2>
  <p>${escapeHtml(from)} handed <strong>${escapeHtml(workspaceName)}</strong> over to you, so you're its owner now. ${escapeHtml(from)} stays on as an admin.</p>
  <p>As the owner you can change the floor plan, style and furniture, set roles, and delete the workspace.</p>
  <p><a href="${link}">Open ${APP_NAME}</a></p>`),
  });
}
