import { Link } from 'react-router-dom';
import { DRAFT_BANNER, TERMS_SECTIONS, TERMS_VERSION } from '../legal/documents';

export default function Terms() {
  return (
    <div className="min-h-screen bg-card-alt">
      <div className="max-w-2xl mx-auto px-4 py-10">
        <p className="text-sm text-muted mb-4">
          <Link to="/" className="text-navy hover:underline">Proof</Link>
          {' · '}
          <Link to="/privacy" className="text-navy hover:underline">Privacy</Link>
        </p>
        <div className="bg-warn-bg border border-amber text-warn-text px-4 py-3 rounded-control text-sm mb-6">
          {DRAFT_BANNER}
        </div>
        <h1 className="text-3xl font-bold mb-2">Terms of Service</h1>
        <p className="text-sm text-muted mb-8">Document version: {TERMS_VERSION}</p>
        {TERMS_SECTIONS.map((section) => (
          <section key={section.heading} className="mb-6">
            <h2 className="text-lg font-semibold mb-2">{section.heading}</h2>
            <p className="text-ink-2 leading-relaxed">{section.body}</p>
          </section>
        ))}
      </div>
    </div>
  );
}
