import nodemailer from "nodemailer";

const port = Number(process.env.EMAIL_PORT ?? 587);

const transporter = nodemailer.createTransport({
  host: process.env.EMAIL_HOST,
  port,
  secure: port === 465, // 465 = implicit TLS; 587 upgrades with STARTTLS
  auth: { user: process.env.EMAIL_USER, pass: process.env.EMAIL_PASS },
});

const FROM = process.env.EMAIL_FROM || process.env.EMAIL_USER;
const APP_NAME = "TheSpace";

export async function verifyMailer() {
  await transporter.verify();
}

export async function sendVerificationEmail(to: string, name: string, code: string) {
  const first = name.split(" ")[0] || "there";
  await transporter.sendMail({
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
  await transporter.sendMail({
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
