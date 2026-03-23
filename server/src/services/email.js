const sgMail = require('@sendgrid/mail');

let initialized = false;

function init() {
  if (!initialized && process.env.SENDGRID_API_KEY) {
    sgMail.setApiKey(process.env.SENDGRID_API_KEY);
    initialized = true;
  }
}

async function sendEmail(to, subject, html) {
  // Skip if SendGrid not configured
  if (!process.env.SENDGRID_API_KEY || !process.env.FROM_EMAIL) {
    console.log(`[Email] Would send to ${to}: ${subject}`);
    return;
  }

  init();

  try {
    const [response] = await sgMail.send({
      to,
      from: process.env.FROM_EMAIL,
      subject,
      html,
    });
    console.log(`[Email] Sent to ${to}: "${subject}" — status ${response.statusCode}`);
  } catch (err) {
    console.error(`[Email] Failed to send to ${to}:`, err.message);
    if (err.response) {
      console.error(`[Email] SendGrid response body:`, JSON.stringify(err.response.body, null, 2));
    }
    throw err;
  }
}

async function sendUploadRequestEmail(to, vendorName, portalUrl, org) {
  const orgName = org?.name || 'our company';
  const orgEmail = org?.email || '';
  const orgAddress = org?.address || '';

  const contactBlock = [
    `<p style="margin:0;font-weight:600;">${orgName}</p>`,
    orgAddress ? `<p style="margin:0;color:#4b5563;">${orgAddress}</p>` : '',
    orgEmail ? `<p style="margin:0;color:#4b5563;">${orgEmail}</p>` : '',
  ].filter(Boolean).join('\n');

  await sendEmail(
    to,
    `Certificate of Insurance Request from ${orgName}`,
    `<h2>COI Upload Request</h2>
     <p>Hello ${vendorName},</p>
     <p><strong>${orgName}</strong> needs your current Certificate of Insurance (COI) on file. Please upload it using the secure link below:</p>
     <p><a href="${portalUrl}" style="background:#2563eb;color:white;padding:12px 24px;text-decoration:none;border-radius:6px;display:inline-block;">Upload COI</a></p>
     <p>This link is unique to your company. No login required.</p>
     <div style="margin-top:24px;padding:16px;background:#f9fafb;border-radius:8px;border:1px solid #e5e7eb;">
       <p style="margin:0 0 8px;font-size:13px;color:#6b7280;text-transform:uppercase;letter-spacing:0.5px;">Requesting Company</p>
       ${contactBlock}
     </div>
     <p style="margin-top:16px;">If you have questions, please contact <a href="mailto:${orgEmail}">${orgName}</a> directly.</p>
     <p>Thank you!</p>
     <hr style="border:none;border-top:1px solid #e5e7eb;margin:32px 0 16px;" />
     <p style="font-size:12px;color:#9ca3af;text-align:center;">
       Powered by <a href="https://proofcoi.com" style="color:#6b7280;text-decoration:none;font-weight:500;">Proof</a> &mdash; COI management for general contractors.
       <a href="https://proofcoi.com" style="color:#3b82f6;text-decoration:none;">Learn more at proofcoi.com</a>
     </p>`
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

async function sendWeeklySummaryEmail(to, orgName, summary) {
  const {
    totalVendors,
    compliant,
    expiringSoon,
    expired,
    noCoi,
    urgentVendors,
  } = summary;

  const urgentRows = urgentVendors.map((v) => {
    const statusColor = v.daysUntil <= 0 ? '#dc2626' : '#d97706';
    const statusLabel = v.daysUntil <= 0
      ? `Expired ${Math.abs(v.daysUntil)} day(s) ago`
      : `Expires in ${v.daysUntil} day(s)`;
    return `
      <tr>
        <td style="padding:10px 16px;border-bottom:1px solid #e5e7eb;font-size:14px;">${v.name}</td>
        <td style="padding:10px 16px;border-bottom:1px solid #e5e7eb;font-size:14px;">
          ${v.expirationDate ? new Date(v.expirationDate).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' }) : 'N/A'}
        </td>
        <td style="padding:10px 16px;border-bottom:1px solid #e5e7eb;font-size:14px;color:${statusColor};font-weight:600;">
          ${statusLabel}
        </td>
      </tr>`;
  }).join('');

  const urgentSection = urgentVendors.length > 0 ? `
    <div style="margin-top:24px;">
      <h3 style="margin:0 0 12px;font-size:16px;color:#111827;">Needs Attention</h3>
      <table style="width:100%;border-collapse:collapse;border:1px solid #e5e7eb;border-radius:8px;overflow:hidden;">
        <thead>
          <tr style="background:#f9fafb;">
            <th style="padding:10px 16px;text-align:left;font-size:12px;font-weight:600;color:#6b7280;text-transform:uppercase;letter-spacing:0.5px;">Vendor</th>
            <th style="padding:10px 16px;text-align:left;font-size:12px;font-weight:600;color:#6b7280;text-transform:uppercase;letter-spacing:0.5px;">Expiration</th>
            <th style="padding:10px 16px;text-align:left;font-size:12px;font-weight:600;color:#6b7280;text-transform:uppercase;letter-spacing:0.5px;">Status</th>
          </tr>
        </thead>
        <tbody>
          ${urgentRows}
        </tbody>
      </table>
    </div>` : '';

  const actionableCount = expiringSoon + expired + noCoi;

  await sendEmail(
    to,
    `Your Weekly COI Compliance Summary — ${orgName}`,
    `<div style="font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif;max-width:600px;margin:0 auto;">
       <h2 style="margin:0 0 8px;color:#111827;">Weekly Compliance Summary</h2>
       <p style="margin:0 0 24px;color:#6b7280;font-size:14px;">Here's your COI compliance overview for ${orgName}.</p>

       <div style="display:flex;gap:12px;margin-bottom:24px;">
         <table style="width:100%;border-collapse:separate;border-spacing:12px 0;">
           <tr>
             <td style="background:#f9fafb;padding:16px;border-radius:8px;border:1px solid #e5e7eb;text-align:center;width:33%;">
               <div style="font-size:28px;font-weight:700;color:#111827;">${totalVendors}</div>
               <div style="font-size:12px;color:#6b7280;margin-top:4px;">Total Vendors</div>
             </td>
             <td style="background:#f0fdf4;padding:16px;border-radius:8px;border:1px solid #bbf7d0;text-align:center;width:33%;">
               <div style="font-size:28px;font-weight:700;color:#16a34a;">${compliant}</div>
               <div style="font-size:12px;color:#16a34a;margin-top:4px;">Compliant</div>
             </td>
             <td style="background:${actionableCount > 0 ? '#fef2f2' : '#f9fafb'};padding:16px;border-radius:8px;border:1px solid ${actionableCount > 0 ? '#fecaca' : '#e5e7eb'};text-align:center;width:33%;">
               <div style="font-size:28px;font-weight:700;color:${actionableCount > 0 ? '#dc2626' : '#6b7280'};">${actionableCount}</div>
               <div style="font-size:12px;color:${actionableCount > 0 ? '#dc2626' : '#6b7280'};margin-top:4px;">Need Action</div>
             </td>
           </tr>
         </table>
       </div>

       <div style="background:#f9fafb;border-radius:8px;border:1px solid #e5e7eb;padding:16px;margin-bottom:24px;">
         <table style="width:100%;font-size:14px;border-collapse:collapse;">
           <tr>
             <td style="padding:6px 0;color:#374151;">Expiring within 30 days</td>
             <td style="padding:6px 0;text-align:right;font-weight:600;color:${expiringSoon > 0 ? '#d97706' : '#6b7280'};">${expiringSoon}</td>
           </tr>
           <tr>
             <td style="padding:6px 0;color:#374151;">Expired</td>
             <td style="padding:6px 0;text-align:right;font-weight:600;color:${expired > 0 ? '#dc2626' : '#6b7280'};">${expired}</td>
           </tr>
           <tr>
             <td style="padding:6px 0;color:#374151;">Missing COI entirely</td>
             <td style="padding:6px 0;text-align:right;font-weight:600;color:${noCoi > 0 ? '#dc2626' : '#6b7280'};">${noCoi}</td>
           </tr>
         </table>
       </div>

       ${urgentSection}

       <div style="margin-top:32px;text-align:center;">
         <a href="https://app.proofcoi.com" style="background:#2563eb;color:white;padding:14px 32px;text-decoration:none;border-radius:8px;display:inline-block;font-weight:600;font-size:14px;">
           Review Compliance Dashboard
         </a>
       </div>

       <hr style="border:none;border-top:1px solid #e5e7eb;margin:32px 0 16px;" />
       <p style="font-size:12px;color:#9ca3af;text-align:center;">
         Powered by <a href="https://proofcoi.com" style="color:#6b7280;text-decoration:none;font-weight:500;">Proof</a> &mdash;
         <a href="https://proofcoi.com" style="color:#3b82f6;text-decoration:none;">proofcoi.com</a>
       </p>
     </div>`
  );
}

async function sendInviteEmail(to, orgName, inviteUrl) {
  await sendEmail(
    to,
    `You've been invited to join ${orgName} on Proof`,
    `<h2>You're Invited!</h2>
     <p>You've been invited to join <strong>${orgName}</strong> on Proof, a COI management platform.</p>
     <p>Click the link below to set up your account:</p>
     <p><a href="${inviteUrl}" style="background:#2563eb;color:white;padding:12px 24px;text-decoration:none;border-radius:6px;display:inline-block;">Accept Invitation</a></p>
     <p>This link is unique to you. If you didn't expect this invitation, you can safely ignore this email.</p>
     <hr style="border:none;border-top:1px solid #e5e7eb;margin:32px 0 16px;" />
     <p style="font-size:12px;color:#9ca3af;text-align:center;">
       Powered by <a href="https://proofcoi.com" style="color:#6b7280;text-decoration:none;font-weight:500;">Proof</a>
     </p>`
  );
}

async function sendPasswordResetEmail(to, resetUrl) {
  await sendEmail(
    to,
    'Reset your Proof password',
    `<div style="font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif;max-width:600px;margin:0 auto;">
       <h2 style="margin:0 0 16px;color:#111827;">Reset Your Password</h2>
       <p style="color:#374151;font-size:14px;line-height:1.6;">
         We received a request to reset the password for your Proof account. Click the button below to set a new password:
       </p>
       <div style="text-align:center;margin:32px 0;">
         <a href="${resetUrl}" style="background:#2563eb;color:white;padding:14px 32px;text-decoration:none;border-radius:8px;display:inline-block;font-weight:600;font-size:14px;">
           Reset Password
         </a>
       </div>
       <p style="color:#6b7280;font-size:13px;line-height:1.6;">
         This link will expire in <strong>1 hour</strong>. If you didn't request a password reset, you can safely ignore this email.
       </p>
       <hr style="border:none;border-top:1px solid #e5e7eb;margin:32px 0 16px;" />
       <p style="font-size:12px;color:#9ca3af;text-align:center;">
         Powered by <a href="https://proofcoi.com" style="color:#6b7280;text-decoration:none;font-weight:500;">Proof</a> &mdash; COI management for general contractors.
         <a href="https://proofcoi.com" style="color:#3b82f6;text-decoration:none;">Learn more at proofcoi.com</a>
       </p>
     </div>`
  );
}

module.exports = {
  sendEmail,
  sendUploadRequestEmail,
  sendUploadNotificationEmail,
  sendRejectionEmail,
  sendExpirationReminderEmail,
  sendWeeklySummaryEmail,
  sendInviteEmail,
  sendPasswordResetEmail,
};
