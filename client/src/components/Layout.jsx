import { Link, useLocation } from 'react-router-dom';
import { useAuth } from '../contexts/AuthContext';

const nav = [
  { path: '/', label: 'Dashboard' },
  { path: '/vendors', label: 'Vendors' },
  { path: '/cois', label: 'COIs' },
  { path: '/import', label: 'Import' },
  { path: '/reports', label: 'Reports' },
  { path: '/settings', label: 'Settings' },
];

export default function Layout({ children }) {
  const { user, logout } = useAuth();
  const location = useLocation();

  return (
    <div className="min-h-screen flex">
      {/* Sidebar */}
      <aside className="w-64 bg-gray-900 text-white flex flex-col">
        <div className="p-6">
          <h1 className="text-2xl font-bold">Proof</h1>
          <p className="text-gray-400 text-sm mt-1">{user?.orgName}</p>
        </div>
        <nav className="flex-1 px-4">
          {nav.map((item) => (
            <Link
              key={item.path}
              to={item.path}
              className={`block px-4 py-2.5 rounded-lg mb-1 text-sm transition-colors ${
                location.pathname === item.path
                  ? 'bg-blue-600 text-white'
                  : 'text-gray-300 hover:bg-gray-800'
              }`}
            >
              {item.label}
            </Link>
          ))}
        </nav>
        <div className="p-4 border-t border-gray-800">
          <p className="text-sm text-gray-400 truncate">{user?.email}</p>
          <button
            onClick={logout}
            className="text-sm text-gray-400 hover:text-white mt-2"
          >
            Log out
          </button>
        </div>
      </aside>

      {/* Main content */}
      <main className="flex-1 p-8 overflow-auto">{children}</main>
    </div>
  );
}
