import React from 'react';
import ReactDOM from 'react-dom/client';
import { BrowserRouter } from 'react-router-dom';
import { AuthProvider } from './contexts/AuthContext';
import { ToastProvider } from './contexts/ToastContext';
import { UsageProvider } from './contexts/UsageContext';
import App from './App';
import './index.css';

ReactDOM.createRoot(document.getElementById('root')).render(
  <React.StrictMode>
    <BrowserRouter>
      <AuthProvider>
        <UsageProvider>
          <ToastProvider>
            <App />
          </ToastProvider>
        </UsageProvider>
      </AuthProvider>
    </BrowserRouter>
  </React.StrictMode>
);
