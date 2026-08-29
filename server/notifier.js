import { SESv2Client, SendEmailCommand } from '@aws-sdk/client-sesv2';

const ADMIN_EMAIL = process.env.ADMIN_EMAIL || 'andrew@textstr.com';
const FROM_EMAIL = process.env.FROM_EMAIL || 'noreply@eboncrucible.com';

const ses = new SESv2Client({ region: process.env.AWS_REGION || 'us-east-1' });

export async function notifyAdminNewSignup({ email, username, sub }) {
  try {
    await ses.send(new SendEmailCommand({
      FromEmailAddress: `Ebon Crucible <${FROM_EMAIL}>`,
      Destination: { ToAddresses: [ADMIN_EMAIL] },
      Content: {
        Simple: {
          Subject: { Data: `New signup: ${username}` },
          Body: {
            Text: {
              Data: `New account created on Ebon Crucible\n\nUsername: ${username}\nEmail: ${email}\nSub: ${sub}\nTime: ${new Date().toISOString()}\n`,
            },
            Html: {
              Data: `<h2>New Ebon Crucible Signup</h2>
<table style="font-family:sans-serif;font-size:14px;border-collapse:collapse">
  <tr><td style="padding:4px 12px;color:#888">Username</td><td style="padding:4px 12px"><strong>${username}</strong></td></tr>
  <tr><td style="padding:4px 12px;color:#888">Email</td><td style="padding:4px 12px">${email}</td></tr>
  <tr><td style="padding:4px 12px;color:#888">Sub</td><td style="padding:4px 12px;font-family:monospace;font-size:12px">${sub}</td></tr>
  <tr><td style="padding:4px 12px;color:#888">Time</td><td style="padding:4px 12px">${new Date().toUTCString()}</td></tr>
</table>`,
            },
          },
        },
      },
    }));
    console.log(`[Notifier] Sent signup email for ${username} to ${ADMIN_EMAIL}`);
  } catch (err) {
    console.error('[Notifier] Failed to send signup email:', err.message);
  }
}
