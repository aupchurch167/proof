import { Link } from 'react-router-dom';
import { Button, PageTitle } from '../components/ui';

export default function NotFound() {
  return (
    <div className="px-9 py-16 max-w-content w-full flex flex-col gap-4">
      <span className="text-[11px] font-bold uppercase tracking-[0.08em] text-muted">404</span>
      <PageTitle>Page not found</PageTitle>
      <p className="text-sm text-ink-2 max-w-md leading-relaxed">
        That address isn't a page in Proof. Check the link, or go back to the dashboard.
      </p>
      <div>
        <Button as={Link} to="/" variant="navy">Back to the dashboard</Button>
      </div>
    </div>
  );
}
