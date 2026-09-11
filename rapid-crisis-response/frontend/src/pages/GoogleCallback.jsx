import React, { useEffect, useState } from 'react';
import { useNavigate, useLocation } from 'react-router-dom';
import { loginWithCustomToken } from '../firebase';
import toast from 'react-hot-toast';

const API = process.env.REACT_APP_API_URL || 'http://localhost:3001';

export default function GoogleCallback() {
  const navigate = useNavigate();
  const location = useLocation();
  const [status, setStatus] = useState('Authenticating with Google...');

  useEffect(() => {
    const processCallback = async () => {
      const params = new URLSearchParams(location.search);
      const code = params.get('code');
      const error = params.get('error');

      if (error) {
        toast.error(`Google Auth Error: ${error}`);
        navigate('/auth');
        return;
      }

      if (!code) {
        toast.error('No authorization code found in URL');
        navigate('/auth');
        return;
      }

      setStatus('Exchanging authorization code...');

      try {
        const response = await fetch(`${API}/api/auth/google`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ code })
        });

        const data = await response.json();

        if (!response.ok) {
          throw new Error(data.error || 'Failed to exchange token');
        }

        setStatus('Logging in securely...');

        // We receive a Firebase Custom Token from our backend to maintain architecture
        if (data.firebaseCustomToken) {
          await loginWithCustomToken(data.firebaseCustomToken);
          toast.success('Successfully signed in with Google');
          navigate('/'); // App.js will route to correct dashboard based on role
        } else {
          throw new Error('No custom token received from backend');
        }

      } catch (err) {
        console.error('[GoogleCallback] Error:', err);
        toast.error(err.message || 'Authentication failed');
        navigate('/auth');
      }
    };

    processCallback();
  }, [location, navigate]);

  return (
    <div style={{ minHeight: '100vh', background: '#0A0A0F', display: 'flex', alignItems: 'center', justifyContent: 'center', flexDirection: 'column', gap: '16px' }}>
      <div style={{ width: '48px', height: '48px', borderRadius: '50%', border: '3px solid #2A2A3A', borderTopColor: '#E24B4A', animation: 'spin 1s linear infinite' }} />
      <p style={{ color: '#E5E7EB', fontSize: '15px', fontFamily: "'DM Sans',sans-serif" }}>{status}</p>
      <style>{`@keyframes spin{to{transform:rotate(360deg)}}`}</style>
    </div>
  );
}
