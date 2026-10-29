import { useState, useEffect } from 'react';
import { useAuth } from '../contexts/AuthContext';
import { useToast } from '../contexts/ToastContext';
import { api } from '../utils/api';
import { emailFieldError, normalizeEmail } from '../utils/emailCheck';
import { Button, Card } from '../components/ui';

const roleLabels = { ADMIN: 'Admin', MEMBER: 'Member', REVIEWER: 'Reviewer', VIEWER: 'Viewer' };
const roleColors = { ADMIN: 'bg-info-bg text-info-text', MEMBER: 'bg-info-bg text-info-text', REVIEWER: 'bg-ok-bg text-ok-text', VIEWER: 'bg-warm text-ink' };

export default function Users() {
  const { user: currentUser } = useAuth();
  const toast = useToast();
  const [users, setUsers] = useState([]);
  const [loading, setLoading] = useState(true);
  const [showInvite, setShowInvite] = useState(false);
  const [inviteForm, setInviteForm] = useState({ email: '', role: 'MEMBER' });
  const [inviteNotice, setInviteNotice] = useState(null);
  const [emailError, setEmailError] = useState('');
  const [inviting, setInviting] = useState(false);
  const isAdmin = currentUser?.role === 'ADMIN';

  const fetchUsers = () => {
    api.get('/users')
      .then(setUsers)
      .catch(console.error)
      .finally(() => setLoading(false));
  };

  useEffect(() => { fetchUsers(); }, []);

  const handleInvite = async (e) => {
    e.preventDefault();
    const problem = emailFieldError(inviteForm.email);
    if (problem) {
      setEmailError(problem);
      return;
    }
    setEmailError('');
    setInviting(true);
    setInviteNotice(null);
    try {
      await api.post('/users/invite', { ...inviteForm, email: normalizeEmail(inviteForm.email) });
      setInviteNotice({ tone: 'ok', text: 'Invitation sent' });
      setInviteForm({ email: '', role: 'MEMBER' });
      setShowInvite(false);
      fetchUsers();
    } catch (err) {
      setInviteNotice({ tone: 'bad', text: err.message || "Couldn't send the invitation" });
    } finally {
      setInviting(false);
    }
  };

  const handleChangeRole = async (userId, newRole) => {
    try {
      await api.put(`/users/${userId}/role`, { role: newRole });
      fetchUsers();
    } catch (err) {
      toast.error(err.message);
    }
  };

  const handleRemove = async (userId, userName) => {
    if (!confirm(`Remove ${userName || 'this user'} from the organization?`)) return;
    try {
      await api.delete(`/users/${userId}`);
      fetchUsers();
    } catch (err) {
      toast.error(err.message);
    }
  };

  if (loading) return <div className="text-[13px] text-muted">Loading…</div>;

  return (
    <div className="flex flex-col gap-4">
      <div className="flex justify-between items-center gap-3">
        <span className="text-[15px] font-bold text-navy">Team · {users.length}</span>
        {isAdmin && (
          <Button type="button" variant="amber" onClick={() => { setShowInvite((open) => !open); setInviteNotice(null); }}>
            Invite teammate
          </Button>
        )}
      </div>

      {inviteNotice && (
        <div className={`px-4 py-3 rounded-control text-sm ${inviteNotice.tone === 'bad' ? 'bg-bad-bg text-bad-text' : 'bg-ok-bg text-ok-text'}`}>
          {inviteNotice.text}
        </div>
      )}

      {isAdmin && showInvite && (
        <form onSubmit={handleInvite} className="bg-white rounded-card border border-line p-[22px] flex flex-col gap-4">
          <div>
            <span className="text-[15px] font-bold text-navy">Invite a teammate</span>
            <p className="text-[13px] text-muted mt-1">An email will be sent with a link to join your organization.</p>
          </div>
          <div className="flex flex-col sm:flex-row gap-3">
            <div className="flex-1">
              <label htmlFor="settings-invite-email" className="block text-xs font-semibold text-ink-2 mb-1">Email</label>
              <input
                id="settings-invite-email"
                type="email"
                placeholder="name@company.com"
                value={inviteForm.email}
                onChange={(e) => { setInviteForm({ ...inviteForm, email: e.target.value }); setEmailError(''); }}
                onInvalid={(e) => { e.preventDefault(); setEmailError(emailFieldError(inviteForm.email)); }}
                aria-invalid={emailError ? 'true' : undefined}
                aria-describedby={emailError ? 'settings-invite-email-error' : undefined}
                className="w-full px-3 py-2.5 border border-line-strong rounded-control text-base sm:text-sm"
                required
              />
              {emailError && <p id="settings-invite-email-error" className="text-bad-text text-xs mt-1">{emailError}</p>}
            </div>
            <div>
              <label htmlFor="settings-invite-role" className="block text-xs font-semibold text-ink-2 mb-1">Role</label>
              <select
                id="settings-invite-role"
                value={inviteForm.role}
                onChange={(e) => setInviteForm({ ...inviteForm, role: e.target.value })}
                className="px-3 py-2.5 border border-line-strong rounded-control text-base sm:text-sm w-full sm:w-auto">
                <option value="MEMBER">Member</option>
                <option value="ADMIN">Admin</option>
              </select>
            </div>
          </div>
          <div className="flex gap-2">
            <Button type="submit" variant="amber" disabled={inviting}>
              {inviting ? 'Sending…' : 'Send invitation'}
            </Button>
            <Button type="button" onClick={() => setShowInvite(false)}>Cancel</Button>
          </div>
        </form>
      )}

      <Card className="overflow-hidden">
        <table className="w-full text-sm">
          <thead>
            <tr className="bg-card-alt border-b">
              <th className="text-left px-6 py-3 font-medium text-muted">User</th>
              <th className="text-left px-6 py-3 font-medium text-muted">Role</th>
              <th className="text-left px-6 py-3 font-medium text-muted hidden sm:table-cell">Joined</th>
              <th className="text-right px-6 py-3 font-medium text-muted">Actions</th>
            </tr>
          </thead>
          <tbody>
            {users.length === 0 && (
              <tr><td colSpan={4} className="text-center py-8 text-faint">No team members yet. Invite someone to get started.</td></tr>
            )}
            {users.map((u) => {
              const isPending = !!u.invitePending;
              const displayName = isPending
                ? u.email
                : `${u.firstName} ${u.lastName}`;
              return (
                <tr key={u.id} className="border-b last:border-0 hover:bg-card-alt">
                  <td className="px-6 py-4">
                    <p className="font-medium">{displayName}</p>
                    {!isPending && <p className="text-xs text-muted">{u.email}</p>}
                    {isPending && <p className="text-xs text-yellow-600">Invite pending</p>}
                  </td>
                  <td className="px-6 py-4">
                    {u.id === currentUser.id || !isAdmin ? (
                      <span className={`px-2 py-1 rounded-full text-xs font-medium ${roleColors[u.role] || roleColors.MEMBER}`}>
                        {roleLabels[u.role] || u.role}{u.id === currentUser.id ? ' (you)' : ''}
                      </span>
                    ) : (
                      <select
                        value={u.role}
                        onChange={(e) => handleChangeRole(u.id, e.target.value)}
                        className="px-2 py-1 border rounded text-xs font-medium"
                      >
                        <option value="ADMIN">Admin</option>
                        <option value="MEMBER">Member</option>
                      </select>
                    )}
                  </td>
                  <td className="px-6 py-4 text-muted hidden sm:table-cell">
                    {new Date(u.createdAt).toLocaleDateString()}
                  </td>
                  <td className="px-6 py-4 text-right">
                    {isAdmin && u.id !== currentUser.id && (
                      <button
                        onClick={() => handleRemove(u.id, displayName)}
                        className="text-bad-text hover:underline text-sm">
                        Remove
                      </button>
                    )}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </Card>
    </div>
  );
}
