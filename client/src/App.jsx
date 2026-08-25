import { Routes, Route, Navigate } from 'react-router-dom';
import { useAuth } from './contexts/AuthContext';
import Layout from './components/Layout';
import Login from './pages/Login';
import Signup from './pages/Signup';
import Dashboard from './pages/Dashboard';
import Vendors from './pages/Vendors';
import VendorDetail from './pages/VendorDetail';
import Cois from './pages/Cois';
import CoiDetail from './pages/CoiDetail';
import Settings from './pages/Settings';
import Users from './pages/Users';
import Integrations from './pages/Integrations';

import Portal from './pages/Portal';
import Apply from './pages/Apply';
import Replies from './pages/Replies';
import Import from './pages/Import';
import AcceptInvite from './pages/AcceptInvite';
import ForgotPassword from './pages/ForgotPassword';
import ResetPassword from './pages/ResetPassword';
import VerifyEmail from './pages/VerifyEmail';

function PrivateRoute({ children }) {
  const { user, loading } = useAuth();
  if (loading) return <div className="flex items-center justify-center h-screen">Loading...</div>;
  return user ? children : <Navigate to="/login" />;
}

function AdminRoute({ children }) {
  const { user, loading } = useAuth();
  if (loading) return <div className="flex items-center justify-center h-screen">Loading...</div>;
  if (!user) return <Navigate to="/login" />;
  if (user.role !== 'ADMIN') return <Navigate to="/" />;
  return children;
}

export default function App() {
  return (
    <Routes>
      <Route path="/login" element={<Login />} />
      <Route path="/signup" element={<Signup />} />
      <Route path="/forgot-password" element={<ForgotPassword />} />
      <Route path="/reset-password" element={<ResetPassword />} />
      <Route path="/verify-email" element={<VerifyEmail />} />
      <Route path="/portal/:token" element={<Portal />} />
      <Route path="/apply/:slug" element={<Apply />} />
      <Route path="/accept-invite" element={<AcceptInvite />} />
      <Route
        path="/*"
        element={
          <PrivateRoute>
            <Layout>
              <Routes>
                <Route path="/" element={<Dashboard />} />
                <Route path="/vendors" element={<Vendors />} />
                <Route path="/vendors/:id" element={<VendorDetail />} />
                <Route path="/cois" element={<Cois />} />
                <Route path="/cois/:id" element={<CoiDetail />} />
                <Route path="/replies" element={<Replies />} />
                <Route path="/settings" element={<Settings />} />
                <Route path="/settings/users" element={<AdminRoute><Users /></AdminRoute>} />
                <Route path="/settings/integrations" element={<AdminRoute><Integrations /></AdminRoute>} />

                <Route path="/import" element={<Import />} />
              </Routes>
            </Layout>
          </PrivateRoute>
        }
      />
    </Routes>
  );
}
