const { Resend } = require('resend');

let resend = null;

// Escape user-controlled strings before interpolating them into HTML email
// bodies (A4-03). Subjects stay plain text.
function escapeHtml(value) {
  return String(value ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function init() {
  if (!resend && process.env.RESEND_API_KEY) {
    resend = new Resend(process.env.RESEND_API_KEY);
  }
}

async function sendEmail(to, subject, html, cc) {
  // Skip if Resend not configured.
  if (!process.env.RESEND_API_KEY || !process.env.FROM_EMAIL) {
    console.log(`[Email] Would send to ${to}${cc?.length ? ` cc=${cc.join(',')}` : ''}: ${subject}`);
    return;
  }

  init();

  const payload = {
    to,
    from: process.env.FROM_EMAIL,
    subject,
    html,
  };
  if (cc && cc.length > 0) {
    payload.cc = cc;
  }
  if (process.env.REPLY_TO_EMAIL) {
    payload.reply_to = process.env.REPLY_TO_EMAIL;
  }

  try {
    const { data, error } = await resend.emails.send(payload);
    if (error) {
      console.error(`[Email] Failed to send to ${to}:`, error.message || error);
      throw new Error(error.message || 'Resend send failed');
    }
    console.log(`[Email] Sent to ${to}${cc?.length ? ` cc=${cc.join(',')}` : ''}: "${subject}" — id ${data?.id || 'unknown'}`);
    return { id: data?.id || null };
  } catch (err) {
    console.error(`[Email] Failed to send to ${to}:`, err.message);
    throw err;
  }
}

async function sendUploadRequestEmail(to, vendorName, portalUrl, org, cc) {
  const rawOrgName = org?.name || 'our company';
  const orgName = escapeHtml(rawOrgName);
  const orgEmail = escapeHtml(org?.email || '');
  const orgAddress = escapeHtml(org?.address || '');
  const safeVendorName = escapeHtml(vendorName);
  const safePortalUrl = escapeHtml(portalUrl);

  const contactBlock = [
    `<p style="margin:0;font-weight:600;">${orgName}</p>`,
    orgAddress ? `<p style="margin:0;color:#4b5563;">${orgAddress}</p>` : '',
    orgEmail ? `<p style="margin:0;color:#4b5563;">${orgEmail}</p>` : '',
  ].filter(Boolean).join('\n');

  return sendEmail(
    to,
    `Certificate of Insurance Request from ${rawOrgName}`,
    `<h2>COI Upload Request</h2>
     <p>Hello ${safeVendorName},</p>
     <p><strong>${orgName}</strong> needs your current Certificate of Insurance (COI) on file. Please upload it using the secure link below:</p>
     <p><a href="${safePortalUrl}" style="background:#2563eb;color:white;padding:12px 24px;text-decoration:none;border-radius:6px;display:inline-block;">Upload COI</a></p>
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
     </p>`,
    cc
  );
}

// Follow-up for a vendor who never acted on the original upload request. The
// copy escalates with each step so the third nudge doesn't read like the first.
async function sendChaseEmail(to, vendorName, portalUrl, org, daysSinceRequest, cc) {
  const rawOrgName = org?.name || 'our company';
  const orgName = escapeHtml(rawOrgName);
  const orgEmail = escapeHtml(org?.email || '');
  const safeVendorName = escapeHtml(vendorName);
  const safePortalUrl = escapeHtml(portalUrl);

  const tone = daysSinceRequest >= 14
    ? {
        subject: `Final reminder: Certificate of Insurance still outstanding — ${rawOrgName}`,
        heading: 'Final Reminder: COI Still Outstanding',
        lead: `We've reached out a few times about your Certificate of Insurance and haven't received it yet. Without a current COI on file, <strong>${orgName}</strong> cannot approve new work or release payment.`,
      }
    : daysSinceRequest >= 7
      ? {
          subject: `Second reminder: Certificate of Insurance needed — ${rawOrgName}`,
          heading: 'Second Reminder: COI Needed',
          lead: `We still haven't received your Certificate of Insurance. Please upload it as soon as you can so your records with <strong>${orgName}</strong> stay current.`,
        }
      : {
          subject: `Reminder: Certificate of Insurance needed — ${rawOrgName}`,
          heading: 'Reminder: COI Needed',
          lead: `Just following up on our request for your Certificate of Insurance. It only takes a minute to upload.`,
        };

  await sendEmail(
    to,
    tone.subject,
    `<div style="font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif;max-width:600px;margin:0 auto;">
       <h2 style="margin:0 0 16px;color:#111827;">${tone.heading}</h2>
       <p style="color:#374151;font-size:14px;line-height:1.6;">Hello ${safeVendorName},</p>
       <p style="color:#374151;font-size:14px;line-height:1.6;">${tone.lead}</p>
       <p style="color:#6b7280;font-size:13px;">We first requested it ${daysSinceRequest} day(s) ago.</p>
       <div style="text-align:center;margin:32px 0;">
         <a href="${safePortalUrl}" style="background:#2563eb;color:white;padding:14px 32px;text-decoration:none;border-radius:8px;display:inline-block;font-weight:600;font-size:14px;">
           Upload COI
         </a>
       </div>
       <p style="color:#6b7280;font-size:13px;line-height:1.6;">
         This link is unique to your company and requires no login. If you've already sent your COI another way, or if
         this reached the wrong person, reply to this email${orgEmail ? ` or contact <a href="mailto:${orgEmail}">${orgName}</a>` : ''} and we'll get it sorted.
       </p>
       <hr style="border:none;border-top:1px solid #e5e7eb;margin:32px 0 16px;" />
       <p style="font-size:12px;color:#9ca3af;text-align:center;">
         Powered by <a href="https://proofcoi.com" style="color:#6b7280;text-decoration:none;font-weight:500;">Proof</a> &mdash; COI management for general contractors.
       </p>
     </div>`,
    cc
  );
}

async function sendUploadNotificationEmail(to, vendorName) {
  const safeVendorName = escapeHtml(vendorName);
  const safeAppUrl = escapeHtml(process.env.APP_URL);
  await sendEmail(
    to,
    `New COI Uploaded - ${vendorName}`,
    `<h2>New COI Upload</h2>
     <p>${safeVendorName} has uploaded a new Certificate of Insurance that requires your review.</p>
     <p><a href="${safeAppUrl}/cois" style="background:#2563eb;color:white;padding:12px 24px;text-decoration:none;border-radius:6px;display:inline-block;">Review COIs</a></p>`
  );
}

async function sendRejectionEmail(to, vendorName, reason, portalUrl, cc) {
  const safeVendorName = escapeHtml(vendorName);
  const safeReason = escapeHtml(reason);
  const safePortalUrl = escapeHtml(portalUrl);
  await sendEmail(
    to,
    'COI Rejected - Action Required',
    `<h2>COI Rejected</h2>
     <p>Hello ${safeVendorName},</p>
     <p>Your Certificate of Insurance has been rejected for the following reason:</p>
     <blockquote style="border-left:4px solid #ef4444;padding:8px 16px;margin:16px 0;background:#fef2f2;">${safeReason}</blockquote>
     <p>Please upload a corrected COI using the link below:</p>
     <p><a href="${safePortalUrl}" style="background:#2563eb;color:white;padding:12px 24px;text-decoration:none;border-radius:6px;display:inline-block;">Upload New COI</a></p>`,
    cc
  );
}

async function sendExpirationReminderEmail(to, vendorName, daysUntil, portalUrl, cc) {
  const urgency = daysUntil <= 0 ? 'has expired' : `expires in ${daysUntil} day(s)`;
  const safeVendorName = escapeHtml(vendorName);
  const safePortalUrl = escapeHtml(portalUrl);
  await sendEmail(
    to,
    `COI ${urgency} - ${vendorName}`,
    `<h2>COI Expiration Notice</h2>
     <p>Hello ${safeVendorName},</p>
     <p>Your Certificate of Insurance ${urgency}. Please upload an updated COI.</p>
     <p><a href="${safePortalUrl}" style="background:#2563eb;color:white;padding:12px 24px;text-decoration:none;border-radius:6px;display:inline-block;">Upload Updated COI</a></p>`,
    cc
  );
}

async function sendWeeklySummaryEmail(to, orgName, summary) {
  const safeOrgName = escapeHtml(orgName);
  const {
    totalVendors,
    compliant,
    expiringSoon,
    expired,
    noCoi,
    urgentVendors,
    expiringWindowDays,
  } = summary;
  const windowDays = Number.isFinite(Number(expiringWindowDays)) ? Math.trunc(Number(expiringWindowDays)) : 30;
  const expiringLabel = windowDays > 0 ? `Expiring within ${windowDays} days` : 'Expiring soon';

  const urgentRows = urgentVendors.map((v) => {
    const statusColor = v.daysUntil <= 0 ? '#dc2626' : '#d97706';
    const statusLabel = v.daysUntil <= 0
      ? `Expired ${Math.abs(v.daysUntil)} day(s) ago`
      : `Expires in ${v.daysUntil} day(s)`;
    return `
      <tr>
        <td style="padding:10px 16px;border-bottom:1px solid #e5e7eb;font-size:14px;">${escapeHtml(v.name)}</td>
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
       <p style="margin:0 0 24px;color:#6b7280;font-size:14px;">Here's your COI compliance overview for ${safeOrgName}.</p>

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
             <td style="padding:6px 0;color:#374151;">${expiringLabel}</td>
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
  const safeOrgName = escapeHtml(orgName);
  const safeInviteUrl = escapeHtml(inviteUrl);
  await sendEmail(
    to,
    `You've been invited to join ${orgName} on Proof`,
    `<h2>You're Invited!</h2>
     <p>You've been invited to join <strong>${safeOrgName}</strong> on Proof, a COI management platform.</p>
     <p>Click the link below to set up your account:</p>
     <p><a href="${safeInviteUrl}" style="background:#2563eb;color:white;padding:12px 24px;text-decoration:none;border-radius:6px;display:inline-block;">Accept Invitation</a></p>
     <p>This link is unique to you. If you didn't expect this invitation, you can safely ignore this email.</p>
     <hr style="border:none;border-top:1px solid #e5e7eb;margin:32px 0 16px;" />
     <p style="font-size:12px;color:#9ca3af;text-align:center;">
       Powered by <a href="https://proofcoi.com" style="color:#6b7280;text-decoration:none;font-weight:500;">Proof</a>
     </p>`
  );
}

async function sendPasswordResetEmail(to, resetUrl) {
  const safeResetUrl = escapeHtml(resetUrl);
  await sendEmail(
    to,
    'Reset your Proof password',
    `<div style="font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif;max-width:600px;margin:0 auto;">
       <h2 style="margin:0 0 16px;color:#111827;">Reset Your Password</h2>
       <p style="color:#374151;font-size:14px;line-height:1.6;">
         We received a request to reset the password for your Proof account. Click the button below to set a new password:
       </p>
       <div style="text-align:center;margin:32px 0;">
         <a href="${safeResetUrl}" style="background:#2563eb;color:white;padding:14px 32px;text-decoration:none;border-radius:8px;display:inline-block;font-weight:600;font-size:14px;">
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

async function sendEmailVerificationEmail(to, verifyUrl) {
  const safeVerifyUrl = escapeHtml(verifyUrl);
  await sendEmail(
    to,
    'Verify your Proof email address',
    `<div style="font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif;max-width:600px;margin:0 auto;">
       <h2 style="margin:0 0 16px;color:#111827;">Verify Your Email</h2>
       <p style="color:#374151;font-size:14px;line-height:1.6;">
         Thanks for signing up for Proof! Please verify your email address by clicking the button below:
       </p>
       <div style="text-align:center;margin:32px 0;">
         <a href="${safeVerifyUrl}" style="background:#2563eb;color:white;padding:14px 32px;text-decoration:none;border-radius:8px;display:inline-block;font-weight:600;font-size:14px;">
           Verify Email
         </a>
       </div>
       <p style="color:#6b7280;font-size:13px;line-height:1.6;">
         If you didn't create a Proof account, you can safely ignore this email.
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
  escapeHtml,
  sendEmail,
  sendUploadRequestEmail,
  sendChaseEmail,
  sendUploadNotificationEmail,
  sendRejectionEmail,
  sendExpirationReminderEmail,
  sendWeeklySummaryEmail,
  sendInviteEmail,
  sendPasswordResetEmail,
  sendEmailVerificationEmail,
};
