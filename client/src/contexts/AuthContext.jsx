import { createContext, useContext, useState, useEffect } from 'react';
import { api, API_BASE } from '../utils/api';

const AuthContext = createContext(null);

export function AuthProvider({ children }) {
  const [user, setUser] = useState(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const token = localStorage.getItem('accessToken');
    if (token) {
      api.get('/auth/me')
        .then(setUser)
        .catch(() => {
          localStorage.removeItem('accessToken');
          localStorage.removeItem('refreshToken');
        })
        .finally(() => setLoading(false));
    } else {
      setLoading(false);
    }
  }, []);

  const storeSession = (data) => {
    if (!data?.accessToken || !data?.refreshToken) return false;
    localStorage.setItem('accessToken', data.accessToken);
    localStorage.setItem('refreshToken', data.refreshToken);
    setUser(data.user);
    return true;
  };

  const login = async (email, password) => {
    const data = await api.post('/auth/login', { email, password });
    storeSession(data);
    return data.user;
  };

  const signup = async (formData) => {
    const data = await api.post('/auth/signup', formData);
    storeSession(data);
    return data;
  };

  const loginWithGoogle = async (credential, orgName) => {
    const data = await api.post('/auth/google', { credential, orgName });
    storeSession(data);
    return data.user;
  };

  const refreshUser = async () => {
    const me = await api.get('/auth/me');
    setUser(me);
    return me;
  };

  const logout = async () => {
    const refreshToken = localStorage.getItem('refreshToken');
    const accessToken = localStorage.getItem('accessToken');
    try {
      await fetch(`${API_BASE}/auth/logout`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          ...(accessToken ? { Authorization: `Bearer ${accessToken}` } : {}),
        },
        body: JSON.stringify({ refreshToken }),
      });
    } catch (_) {
      // Local logout still proceeds if the network call fails.
    }
    localStorage.removeItem('accessToken');
    localStorage.removeItem('refreshToken');
    setUser(null);
  };

  return (
    <AuthContext.Provider value={{ user, loading, login, signup, loginWithGoogle, logout, refreshUser }}>
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth() {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error('useAuth must be used within AuthProvider');
  return ctx;
}
