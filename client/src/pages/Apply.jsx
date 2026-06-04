import { useState, useEffect } from 'react';
import { useParams } from 'react-router-dom';
import { API_BASE } from '../utils/api';

const blankForm = {
  name: '', contactName: '', phone: '', email: '', trade: '', notes: '',
  address: '', city: '', state: '', zip: '',
};

export default function Apply() {
  const { slug } = useParams();
  const [org, setOrg] = useState(null);
  const [loading, setLoading] = useState(true);
  const [notFound, setNotFound] = useState(false);
  const [form, setForm] = useState(blankForm);
  const [w9, setW9] = useState(null);
  const [coi, setCoi] = useState(null);
  const [submitting, setSubmitting] = useState(false);
  const [submitted, setSubmitted] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => {
    fetch(`${API_BASE}/apply/${slug}`)
      .then((r) => (r.ok ? r.json() : Promise.reject(r)))
      .then(setOrg)
      .catch(() => setNotFound(true))
      .finally(() => setLoading(false));
  }, [slug]);

  const set = (k) => (e) => setForm({ ...form, [k]: e.target.value });

  const handleSubmit = async (e) => {
    e.preventDefault();
    setError('');
    setSubmitting(true);
    try {
      const fd = new FormData();
      Object.entries(form).forEach(([k, v]) => { if (v) fd.append(k, v); });
      if (w9) fd.append('w9', w9);
      if (coi) fd.append('coi', coi);
      const res = await fetch(`${API_BASE}/apply/${slug}`, { method: 'POST', body: fd });
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        throw new Error(data.error || 'Submission failed');
      }
      setSubmitted(true);
    } catch (err) {
      setError(err.message);
    } finally {
      setSubmitting(false);
    }
  };

  if (loading) return <div className="p-12 text-center text-gray-500">Loading...</div>;
  if (notFound) return <div className="p-12 text-center text-gray-500">Organization not found.</div>;

  if (submitted) {
    return (
      <div className="max-w-xl mx-auto p-6 text-center">
        <h1 className="text-2xl font-bold mb-2">Thank you!</h1>
        <p className="text-gray-600">
          {org.name} has received your application and will be in touch.
        </p>
        <p className="text-xs text-gray-400 mt-8">Powered by Proof — proofcoi.com</p>
      </div>
    );
  }

  const labelClass = 'block text-sm font-medium text-gray-700 mb-1';
  const inputClass = 'w-full px-3 py-2.5 border rounded-lg text-base sm:text-sm';
  const fileClass = 'w-full text-sm file:mr-3 file:py-2 file:px-3 file:rounded-lg file:border file:border-gray-300 file:bg-white file:text-sm file:cursor-pointer hover:file:bg-gray-50';

  return (
    <div className="max-w-2xl mx-auto p-4 sm:p-6">
      <header className="mb-6">
        <h1 className="text-2xl sm:text-3xl font-bold">{org.name}</h1>
        <p className="text-lg text-gray-600 mt-1">Subcontractor Application Form</p>
      </header>

      {error && <div className="bg-red-50 text-red-600 px-4 py-3 rounded-lg mb-4 text-sm">{error}</div>}

      <form onSubmit={handleSubmit} className="space-y-4 bg-white border rounded-xl p-4 sm:p-6">
        <div>
          <label className={labelClass}>Business Name / Nombre de Negocio *</label>
          <input required value={form.name} onChange={set('name')} className={inputClass}
            placeholder="Legal business name, include LLC, Inc or whatever" />
        </div>
        <div>
          <label className={labelClass}>Contact Name / Tu Nombre</label>
          <input value={form.contactName} onChange={set('contactName')} className={inputClass}
            placeholder="Your full name" />
        </div>
        <div className="grid sm:grid-cols-2 gap-4">
          <div>
            <label className={labelClass}>Contact Phone Number / Tu Número *</label>
            <input required value={form.phone} onChange={set('phone')} className={inputClass} />
          </div>
          <div>
            <label className={labelClass}>Email *</label>
            <input required type="email" value={form.email} onChange={set('email')} className={inputClass} />
          </div>
        </div>
        <div>
          <label className={labelClass}>Trade / tipo de trabajo</label>
          <input value={form.trade} onChange={set('trade')} className={inputClass} />
        </div>
        <div>
          <label className={labelClass}>Notes / Notas</label>
          <textarea value={form.notes} onChange={set('notes')} rows={3}
            className={inputClass + ' resize-y'}
            placeholder="Add more information about your work" />
        </div>
        <div>
          <label className={labelClass}>W9</label>
          <p className="text-xs text-gray-500 mb-1">
            Blank form: <a href="https://www.irs.gov/pub/irs-pdf/fw9.pdf" target="_blank" rel="noopener noreferrer" className="text-blue-600 hover:underline">irs.gov/pub/irs-pdf/fw9.pdf</a>
          </p>
          <input type="file" accept="application/pdf,image/*" onChange={(e) => setW9(e.target.files?.[0] || null)} className={fileClass} />
        </div>
        <div>
          <label className={labelClass}>Certificate of Insurance</label>
          <p className="text-xs text-gray-500 mb-1">
            Workers Comp &amp; General Liability with <strong>{org.name}</strong> as Additionally Insured
          </p>
          <input type="file" accept="application/pdf,image/*" onChange={(e) => setCoi(e.target.files?.[0] || null)} className={fileClass} />
        </div>
        <div>
          <label className={labelClass}>Address / dirección *</label>
          <input required value={form.address} onChange={set('address')} className={inputClass} />
        </div>
        <div className="grid grid-cols-2 sm:grid-cols-3 gap-4">
          <div>
            <label className={labelClass}>City / ciudad</label>
            <input value={form.city} onChange={set('city')} className={inputClass} />
          </div>
          <div>
            <label className={labelClass}>State / estado</label>
            <input value={form.state} onChange={set('state')} className={inputClass} />
          </div>
          <div>
            <label className={labelClass}>Zip</label>
            <input value={form.zip} onChange={set('zip')} className={inputClass} />
          </div>
        </div>
        <button type="submit" disabled={submitting}
          className="w-full bg-blue-600 text-white px-4 py-3 rounded-lg hover:bg-blue-700 disabled:opacity-50 text-sm font-medium">
          {submitting ? 'Submitting…' : 'Submit Application'}
        </button>
      </form>

      <p className="text-center text-xs text-gray-400 mt-8">Powered by Proof — proofcoi.com</p>
    </div>
  );
}
