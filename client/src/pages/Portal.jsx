import { useState, useEffect, useRef } from 'react';
import { useParams } from 'react-router-dom';
import { API_BASE } from '../utils/api';

const money = (dollars) => (dollars == null ? null : `$${dollars.toLocaleString()}`);
const day = (s) => (s ? new Date(`${s}T00:00:00`).toLocaleDateString('en-US', { month: 'short', day: 'numeric' }) : null);

function initials(name = '') {
  return name.split(/\s+/).filter(Boolean).slice(0, 2).map((w) => w[0]).join('').toUpperCase() || 'CO';
}

// Plain-language fix for each failed check, so a vendor knows what to ask their
// agent for without having to interpret compliance jargon.
function fixFor(flag) {
  if (flag.type === 'INSUFFICIENT') {
    return `Ask your agent to raise ${flag.label.toLowerCase()} to ${money(Math.round(flag.required / 100))}.`;
  }
  if (flag.type === 'MISSING') {
    return `Your certificate doesn't show ${flag.label.toLowerCase()}. Ask your agent to include it.`;
  }
  if (flag.type === 'EXPIRED') {
    return `${flag.label} has expired. Send the renewed certificate.`;
  }
  if (flag.type === 'ADDITIONALLY_INSURED_MISMATCH') {
    return `Ask your agent to list ${flag.expected} as certificate holder and additional insured.`;
  }
  return flag.message;
}

export default function Portal() {
  const { token } = useParams();
  const inputRef = useRef(null);

  const [vendor, setVendor] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [errorOrgName, setErrorOrgName] = useState(null);
  const [uploading, setUploading] = useState(false);
  const [result, setResult] = useState(null);
  const [dragging, setDragging] = useState(false);
  const [editingInfo, setEditingInfo] = useState(false);
  const [form, setForm] = useState({});

  useEffect(() => {
    fetch(`${API_BASE}/portal/${token}`)
      .then(async (res) => {
        const data = await res.json();
        if (!res.ok) {
          setErrorOrgName(data.orgName);
          throw new Error(data.error || 'This link is no longer valid');
        }
        setVendor(data);
        setForm({ name: data.name, contactName: data.contactName || '', email: data.email, phone: data.phone || '', address: data.address || '' });
      })
      .catch((err) => setError(err.message))
      .finally(() => setLoading(false));
  }, [token]);

  const upload = async (file) => {
    if (!file) return;
    setUploading(true);
    setError('');
    try {
      const fd = new FormData();
      fd.append('pdf', file);
      const res = await fetch(`${API_BASE}/portal/${token}/upload`, { method: 'POST', body: fd });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Upload failed');
      setResult(data);
    } catch (err) {
      setError(err.message);
    } finally {
      setUploading(false);
    }
  };

  const saveInfo = async (e) => {
    e.preventDefault();
    try {
      const res = await fetch(`${API_BASE}/portal/${token}/info`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(form),
      });
      if (!res.ok) throw new Error((await res.json()).error || 'Could not save');
      setVendor({ ...vendor, ...form });
      setEditingInfo(false);
    } catch (err) {
      setError(err.message);
    }
  };

  if (loading) {
    return <div className="min-h-screen bg-canvas flex items-center justify-center text-[13px] text-muted">Loading…</div>;
  }

  if (!vendor) {
    return (
      <div className="min-h-screen bg-canvas flex items-center justify-center px-6">
        <div className="max-w-portal text-center flex flex-col gap-3">
          <h1 className="text-[22px] font-extrabold text-navy tracking-[-0.02em]">This link has expired</h1>
          <p className="text-sm text-ink-2 leading-[1.55]">
            {errorOrgName
              ? `Please contact ${errorOrgName} for a new upload link.`
              : 'Please contact the company that requested your certificate for a new upload link.'}
          </p>
        </div>
      </div>
    );
  }

  const org = vendor.organization || {};
  const required = (vendor.coverages || []).filter((c) => c.verdict !== 'skipped');
  const expiring = vendor.expiringSoonest;

  // The lead line changes with why they're here: a renewal names the date, a
  // first request doesn't pretend there's something on file.
  const lead = expiring && expiring.expiresAt
    ? <>Hi {vendor.name} — your {expiring.label.toLowerCase()} on file expires <b className="text-ink">{day(expiring.expiresAt)}</b>. Upload the new certificate below. Takes about a minute.</>
    : <>Hi {vendor.name} — {org.name} needs a current certificate of insurance on file for you. Upload it below. Takes about a minute.</>;

  const agentBody = encodeURIComponent(
    `Hi,\n\nPlease issue a certificate of insurance for ${vendor.name} showing:\n\n` +
    required.map((c) => `• ${c.label}: ${money(c.required)} minimum`).join('\n') +
    `\n\nCertificate holder / additional insured:\n${org.name}${org.address ? `\n${org.address}` : ''}\n\n` +
    (org.additionalInsuredNote ? `${org.additionalInsuredNote}\n\n` : '') +
    `Thank you.`
  );

  return (
    <div className="min-h-screen bg-canvas px-6 pt-10 pb-16 flex flex-col items-center gap-7">
      <div className="w-full max-w-portal flex flex-col gap-5">
        <div className="flex flex-col gap-3.5 text-center items-center">
          <span className="w-[52px] h-[52px] rounded-[14px] bg-navy text-white flex items-center justify-center font-extrabold text-[22px]">
            {initials(org.name)}
          </span>
          <h1 className="text-[26px] font-extrabold tracking-[-0.03em] text-navy text-balance">
            {org.name} needs your {vendor.hasCoiOnFile ? 'updated ' : ''}certificate of insurance
          </h1>
          <p className="text-[15px] text-ink-2 leading-[1.55] max-w-[440px]">{lead}</p>
        </div>

        {result ? (
          <div className="bg-white border border-line rounded-card p-[22px] flex flex-col gap-3.5">
            <span className="text-xs font-bold uppercase tracking-[0.08em] text-amber-text">
              {result.complianceFlags?.length ? "What still needs fixing" : 'Certificate received'}
            </span>
            {result.complianceFlags?.length ? (
              <>
                <p className="text-sm text-ink-2 leading-[1.55]">
                  Thanks — we read your certificate. A few things don't meet {org.name}'s requirements yet:
                </p>
                <div className="flex flex-col gap-2">
                  {result.complianceFlags.map((f, i) => (
                    <div key={i} className="flex gap-2.5 items-start px-3 py-2.5 bg-bad-bg rounded-control text-[13px] text-bad-text leading-[1.45]">
                      <span className="font-extrabold">!</span>
                      <span>{fixFor(f)}</span>
                    </div>
                  ))}
                </div>
                <button
                  onClick={() => { setResult(null); inputRef.current?.click(); }}
                  className="self-start text-[13px] font-semibold text-navy hover:text-amber"
                >
                  Upload a corrected certificate →
                </button>
              </>
            ) : (
              <p className="text-sm text-ink-2 leading-[1.55]">
                Thanks — we read your certificate and everything {org.name} requires is there.
                Nothing else is needed from you.
              </p>
            )}
          </div>
        ) : (
          <>
            {required.length > 0 && (
              <div className="bg-white border border-line rounded-card p-[22px] flex flex-col gap-3.5">
                <span className="text-xs font-bold uppercase tracking-[0.08em] text-amber-text">
                  What the certificate needs to show
                </span>
                <div className="flex flex-col gap-2 text-sm">
                  {required.map((c) => (
                    <div key={c.key} className="flex justify-between gap-3 py-2 border-b border-line-divider">
                      <span className="text-ink">{c.label}</span>
                      <span className="font-semibold text-navy text-right">
                        {money(c.required)}
                        {c.key === 'gl' ? ' per occurrence' : ''}
                      </span>
                    </div>
                  ))}
                  <div className="flex justify-between gap-3 py-2">
                    <span className="text-ink">Certificate holder / additional insured</span>
                    <span className="font-semibold text-navy text-right">
                      {org.name}
                      {org.address && <><br /><span className="font-normal text-muted text-xs">{org.address}</span></>}
                    </span>
                  </div>
                </div>
                {org.additionalInsuredNote && (
                  <p className="text-[13px] text-ink-2 leading-[1.5] bg-card-alt rounded-control px-3 py-2.5">
                    {org.additionalInsuredNote}
                  </p>
                )}
                <a
                  href={`mailto:?subject=${encodeURIComponent(`Certificate of insurance for ${vendor.name}`)}&body=${agentBody}`}
                  className="self-start text-[13px] font-semibold text-navy hover:text-amber"
                >
                  Forward these requirements to my agent →
                </a>
              </div>
            )}

            <div
              onDragOver={(e) => { e.preventDefault(); setDragging(true); }}
              onDragLeave={() => setDragging(false)}
              onDrop={(e) => {
                e.preventDefault();
                setDragging(false);
                upload(e.dataTransfer.files?.[0]);
              }}
              className={`bg-white border-2 border-dashed rounded-card px-[22px] py-9 flex flex-col items-center gap-2.5 text-center
                transition-colors duration-150 ${dragging ? 'border-amber' : 'border-line-strong hover:border-amber'}`}
            >
              <span className="w-11 h-11 rounded-xl bg-amber-bg text-amber-text flex items-center justify-center text-xl font-extrabold">
                ↑
              </span>
              <span className="text-[15px] font-bold text-navy">
                {uploading ? 'Reading your certificate…' : 'Drop your certificate here'}
              </span>
              <span className="text-[13px] text-muted">
                PDF · we read it instantly and tell you if anything's missing
              </span>
              <input
                ref={inputRef}
                type="file"
                accept="application/pdf"
                className="hidden"
                onChange={(e) => upload(e.target.files?.[0])}
              />
              <button
                onClick={() => inputRef.current?.click()}
                disabled={uploading}
                className="mt-1.5 px-[18px] py-2.5 rounded-control bg-amber text-white text-sm font-semibold
                  hover:bg-amber-hover disabled:opacity-50 transition-colors duration-150"
              >
                {uploading ? 'Uploading…' : 'Choose file'}
              </button>
            </div>
          </>
        )}

        {error && (
          <div className="bg-bad-bg text-bad-text px-4 py-3 rounded-control text-[13px] text-center">{error}</div>
        )}

        {editingInfo ? (
          <form onSubmit={saveInfo} className="bg-white border border-line rounded-card p-[22px] flex flex-col gap-3">
            <span className="text-sm font-bold text-navy">Update your contact details</span>
            {[['name', 'Company name'], ['contactName', 'Contact name'], ['email', 'Email'], ['phone', 'Phone'], ['address', 'Address']].map(([key, label]) => (
              <div key={key} className="flex flex-col gap-1">
                <label className="text-xs font-semibold text-ink-2">{label}</label>
                <input
                  value={form[key] || ''}
                  onChange={(e) => setForm({ ...form, [key]: e.target.value })}
                  className="px-3 py-2 rounded-control border border-line-strong text-[13px] focus:outline-none focus:border-navy"
                />
              </div>
            ))}
            <div className="flex gap-2">
              <button type="submit" className="px-3.5 py-2 rounded-control bg-navy text-white text-[13px] font-semibold hover:bg-navy-hover">
                Save
              </button>
              <button type="button" onClick={() => setEditingInfo(false)} className="px-3.5 py-2 rounded-control border border-line-strong text-[13px] font-semibold text-navy">
                Cancel
              </button>
            </div>
          </form>
        ) : (
          <div className="flex flex-col gap-1.5 text-[13px] text-muted text-center">
            <span>
              Uploading as <b className="text-ink">{vendor.email}</b> ·{' '}
              <button onClick={() => setEditingInfo(true)} className="text-navy font-semibold hover:text-amber">
                Not you?
              </button>
            </span>
            <span>
              Secured by <a href="https://proofcoi.com" className="text-navy font-semibold">Proof</a> · proofcoi.com
            </span>
          </div>
        )}
      </div>
    </div>
  );
}
