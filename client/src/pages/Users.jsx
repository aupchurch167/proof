import { useState, useEffect } from 'react';
import { Link } from 'react-router-dom';
import { useAuth } from '../contexts/AuthContext';
import { useToast } from '../contexts/ToastContext';
import { api } from '../utils/api';

const roleLabels = { ADMIN: 'Admin', MEMBER: 'Member', REVIEWER: 'Reviewer', VIEWER: 'Viewer' };
const roleColors = { ADMIN: 'bg-purple-100 text-purple-800', MEMBER: 'bg-blue-100 text-blue-800', REVIEWER: 'bg-green-100 text-green-800', VIEWER: 'bg-gray-100 text-gray-800' };

export default function Users() {
  const { user: currentUser } = useAuth();
  const toast = useToast();
  const [users, setUsers] = useState([]);
  const [loading, setLoading] = useState(true);
  const [showInvite, setShowInvite] = useState(false);
  const [inviteForm, setInviteForm] = useState({ email: '', role: 'MEMBER' });
  const [inviteMsg, setInviteMsg] = useState('');
  const [inviting, setInviting] = useState(false);

  const fetchUsers = () => {
    api.get('/users')
      .then(setUsers)
      .catch(console.error)
      .finally(() => setLoading(false));
  };

  useEffect(() => { fetchUsers(); }, []);

  const handleInvite = async (e) => {
    e.preventDefault();
    setInviting(true);
    setInviteMsg('');
    try {
      await api.post('/users/invite', inviteForm);
      setInviteMsg('Invitation sent!');
      setInviteForm({ email: '', role: 'MEMBER' });
      setShowInvite(false);
      fetchUsers();
    } catch (err) {
      setInviteMsg('Error: ' + err.message);
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

  if (loading) return <div className="text-center py-12 text-gray-500">Loading...</div>;

  return (
    <div className="max-w-3xl mx-auto">
      <h1 className="text-2xl font-bold mb-4">Settings</h1>

      <div className="flex border-b mb-6">
        <Link to="/settings"
          className="px-4 py-2.5 text-sm font-medium border-b-2 border-transparent text-gray-500 hover:text-gray-700 hover:border-gray-300">
          General
        </Link>
        <Link to="/settings/users"
          className="px-4 py-2.5 text-sm font-medium border-b-2 border-blue-600 text-blue-600">
          Users
        </Link>
      </div>

      <div className="flex justify-between items-center mb-6">
        <h2 className="text-lg font-semibold">User Management</h2>
        <button onClick={() => setShowInvite(!showInvite)}
          className="bg-blue-600 text-white px-4 py-2 rounded-lg hover:bg-blue-700 text-sm font-medium">
          Invite User
        </button>
      </div>

      {inviteMsg && (
        <div className={`px-4 py-3 rounded-lg mb-4 text-sm ${inviteMsg.startsWith('Error') ? 'bg-red-50 text-red-600' : 'bg-green-50 text-green-600'}`}>
          {inviteMsg}
        </div>
      )}

      {showInvite && (
        <form onSubmit={handleInvite} className="bg-white rounded-xl border p-6 mb-6">
          <h2 className="text-lg font-semibold mb-4">Invite a New User</h2>
          <p className="text-sm text-gray-500 mb-4">An email will be sent with a link to join your organization.</p>
          <div className="flex flex-col sm:flex-row gap-3 mb-4">
            <input
              type="email"
              placeholder="Email address"
              value={inviteForm.email}
              onChange={(e) => setInviteForm({ ...inviteForm, email: e.target.value })}
              className="flex-1 px-3 py-2.5 border rounded-lg text-base sm:text-sm"
              required
            />
            <select
              value={inviteForm.role}
              onChange={(e) => setInviteForm({ ...inviteForm, role: e.target.value })}
              className="px-3 py-2.5 border rounded-lg text-base sm:text-sm w-full sm:w-auto">
              <option value="MEMBER">Member</option>
              <option value="ADMIN">Admin</option>
            </select>
          </div>
          <div className="flex gap-2">
            <button type="submit" disabled={inviting}
              className="bg-blue-600 text-white px-4 py-2.5 rounded-lg hover:bg-blue-700 disabled:opacity-50 text-sm">
              {inviting ? 'Sending...' : 'Send Invitation'}
            </button>
            <button type="button" onClick={() => setShowInvite(false)}
              className="px-4 py-2.5 rounded-lg border text-sm">Cancel</button>
          </div>
        </form>
      )}

      <div className="bg-white rounded-xl border overflow-hidden">
        <table className="w-full text-sm">
          <thead>
            <tr className="bg-gray-50 border-b">
              <th className="text-left px-6 py-3 font-medium text-gray-600">User</th>
              <th className="text-left px-6 py-3 font-medium text-gray-600">Role</th>
              <th className="text-left px-6 py-3 font-medium text-gray-600 hidden sm:table-cell">Joined</th>
              <th className="text-right px-6 py-3 font-medium text-gray-600">Actions</th>
            </tr>
          </thead>
          <tbody>
            {users.length === 0 && (
              <tr><td colSpan={4} className="text-center py-8 text-gray-400">No team members yet. Invite someone to get started.</td></tr>
            )}
            {users.map((u) => {
              const isPending = !!u.inviteToken;
              const displayName = isPending
                ? u.email
                : `${u.firstName} ${u.lastName}`;
              return (
                <tr key={u.id} className="border-b last:border-0 hover:bg-gray-50">
                  <td className="px-6 py-4">
                    <p className="font-medium">{displayName}</p>
                    {!isPending && <p className="text-xs text-gray-500">{u.email}</p>}
                    {isPending && <p className="text-xs text-yellow-600">Invite pending</p>}
                  </td>
                  <td className="px-6 py-4">
                    {u.id === currentUser.id ? (
                      <span className={`px-2 py-1 rounded-full text-xs font-medium ${roleColors[u.role] || roleColors.MEMBER}`}>
                        {roleLabels[u.role] || u.role} (you)
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
                  <td className="px-6 py-4 text-gray-500 hidden sm:table-cell">
                    {new Date(u.createdAt).toLocaleDateString()}
                  </td>
                  <td className="px-6 py-4 text-right">
                    {u.id !== currentUser.id && (
                      <button
                        onClick={() => handleRemove(u.id, displayName)}
                        className="text-red-600 hover:underline text-sm">
                        Remove
                      </button>
                    )}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
}
