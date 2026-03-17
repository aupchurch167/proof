const nodemailer = require('nodemailer');

let transporter = null;

function getTransporter() {
  if (!transporter) {
    transporter = nodemailer.createTransport({
      host: process.env.SMTP_HOST,
      port: parseInt(process.env.SMTP_PORT) || 587,
      secure: false,
      auth: {
        user: process.env.SMTP_USER,
        pass: process.env.SMTP_PASS,
      },
    });
  }
  return transporter;
}

async function sendEmail(to, subject, html) {
  // Skip if SMTP not configured
  if (!process.env.SMTP_HOST || !process.env.SMTP_USER) {
    console.log(`[Email] Would send to ${to}: ${subject}`);
    return;
  }

  try {
    await getTransporter().sendMail({
      from: process.env.SMTP_USER,
      to,
      subject,
      html,
    });
  } catch (err) {
    console.error(`[Email] Failed to send to ${to}:`, err.message);
    throw err;
  }
}

async function sendUploadRequestEmail(to, vendorName, portalUrl) {
  await sendEmail(
    to,
    'Certificate of Insurance Request',
    `<h2>COI Upload Request</h2>
     <p>Hello ${vendorName},</p>
     <p>We need your current Certificate of Insurance (COI) on file. Please upload it using the secure link below:</p>
     <p><a href="${portalUrl}" style="background:#2563eb;color:white;padding:12px 24px;text-decoration:none;border-radius:6px;display:inline-block;">Upload COI</a></p>
     <p>This link is unique to your company. No login required.</p>
     <p>Thank you!</p>`
  );
}

async function sendUploadNotificationEmail(to, vendorName) {
  await sendEmail(
    to,
    `New COI Uploaded - ${vendorName}`,
    `<h2>New COI Upload</h2>
     <p>${vendorName} has uploaded a new Certificate of Insurance that requires your review.</p>
     <p><a href="${process.env.APP_URL}/cois" style="background:#2563eb;color:white;padding:12px 24px;text-decoration:none;border-radius:6px;display:inline-block;">Review COIs</a></p>`
  );
}

async function sendRejectionEmail(to, vendorName, reason, portalUrl) {
  await sendEmail(
    to,
    'COI Rejected - Action Required',
    `<h2>COI Rejected</h2>
     <p>Hello ${vendorName},</p>
     <p>Your Certificate of Insurance has been rejected for the following reason:</p>
     <blockquote style="border-left:4px solid #ef4444;padding:8px 16px;margin:16px 0;background:#fef2f2;">${reason}</blockquote>
     <p>Please upload a corrected COI using the link below:</p>
     <p><a href="${portalUrl}" style="background:#2563eb;color:white;padding:12px 24px;text-decoration:none;border-radius:6px;display:inline-block;">Upload New COI</a></p>`
  );
}

async function sendExpirationReminderEmail(to, vendorName, daysUntil, portalUrl) {
  const urgency = daysUntil <= 0 ? 'has expired' : `expires in ${daysUntil} day(s)`;
  await sendEmail(
    to,
    `COI ${urgency} - ${vendorName}`,
    `<h2>COI Expiration Notice</h2>
     <p>Hello ${vendorName},</p>
     <p>Your Certificate of Insurance ${urgency}. Please upload an updated COI.</p>
     <p><a href="${portalUrl}" style="background:#2563eb;color:white;padding:12px 24px;text-decoration:none;border-radius:6px;display:inline-block;">Upload Updated COI</a></p>`
  );
}

module.exports = {
  sendEmail,
  sendUploadRequestEmail,
  sendUploadNotificationEmail,
  sendRejectionEmail,
  sendExpirationReminderEmail,
};
