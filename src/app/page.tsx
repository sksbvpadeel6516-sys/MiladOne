'use client';

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { motion, AnimatePresence } from 'framer-motion';
import { supabase } from '@/lib/supabase';
import { handleUserRedirect } from '@/lib/auth-utils';

export default function AuthPage() {
  const router = useRouter();
  const [loading, setLoading] = useState(true);
  const [tab, setTab] = useState<'signin' | 'signup'>('signin');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [formError, setFormError] = useState('');
  const [formLoading, setFormLoading] = useState(false);
  const [googleLoading, setGoogleLoading] = useState(false);
  const [successMsg, setSuccessMsg] = useState('');
  const [showPass, setShowPass] = useState(false);

  useEffect(() => {
    supabase.auth.getSession().then(({ data: { session } }) => {
      if (session?.user?.email) handleUserRedirect(session.user.email, router, setFormError).then(() => setLoading(false));
      else setLoading(false);
    });
    const { data: { subscription } } = supabase.auth.onAuthStateChange(
      (_e, session) => { if (session?.user?.email) handleUserRedirect(session.user.email, router, setFormError); }
    );
    return () => subscription.unsubscribe();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const handleEmailAuth = async (e: React.FormEvent) => {
    e.preventDefault();
    setFormError(''); setSuccessMsg(''); setFormLoading(true);
    try {
      if (tab === 'signup') {
        const { error } = await supabase.auth.signUp({ email, password });
        if (error) throw error;
        setSuccessMsg('Account created! Check your email to confirm, then sign in.');
        setTab('signin');
      } else {
        const { error } = await supabase.auth.signInWithPassword({ email, password });
        if (error) throw error;
        // redirection is handled by onAuthStateChange
      }
    } catch (err: unknown) {
      setFormError(err instanceof Error ? err.message : 'Something went wrong.');
    } finally {
      setFormLoading(false);
    }
  };

  const handleGoogle = async () => {
    setGoogleLoading(true); setFormError('');
    const { error } = await supabase.auth.signInWithOAuth({
      provider: 'google',
      options: {
        redirectTo: `${window.location.origin}/auth/callback`,
        queryParams: { access_type: 'offline', prompt: 'select_account' },
      },
    });
    if (error) { setFormError(error.message); setGoogleLoading(false); }
  };

  if (loading) {
    return (
      <div className="auth-loading-screen">
        <div className="auth-loading-spinner" />
        <p>Loading…</p>
      </div>
    );
  }

  return (
    <div className="auth-page-v2">
      {/* Animated background blobs */}
      <div className="auth-blob auth-blob-1" aria-hidden />
      <div className="auth-blob auth-blob-2" aria-hidden />
      <div className="auth-blob auth-blob-3" aria-hidden />

      <motion.div
        className="auth-split-card"
        initial={{ opacity: 0, y: 40, scale: 0.96 }}
        animate={{ opacity: 1, y: 0, scale: 1 }}
        transition={{ duration: 0.55, ease: [0.22, 1, 0.36, 1] }}
      >
        {/* ── LEFT: Form Panel ── */}
        <div className="auth-form-panel">
          <div className="auth-logo-row">
            <div className="auth-logo-badge" style={{ background: 'white', display: 'flex', alignItems: 'center', justifyContent: 'center', overflow: 'hidden', padding: 4 }}>
              <img src="/logo/logo.png" alt="MiladOne Logo" style={{ width: '100%', height: '100%', objectFit: 'contain' }} />
            </div>
            <span className="auth-logo-name">Milad<span>One</span></span>
          </div>

          {/* Greeting */}
          <AnimatePresence mode="wait">
            <motion.div
              key={tab}
              initial={{ opacity: 0, y: 8 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -8 }}
              transition={{ duration: 0.2 }}
            >
              <h1 className="auth-greeting">
                {tab === 'signin' ? 'Welcome back!' : 'Hello, friend!'}
              </h1>
              <p className="auth-subtext">
                {tab === 'signin'
                  ? 'Sign in to continue to your dashboard.'
                  : 'Create your account to get started.'}
              </p>
            </motion.div>
          </AnimatePresence>

          {/* Success */}
          <AnimatePresence>
            {successMsg && (
              <motion.div
                className="auth-alert auth-alert-success"
                initial={{ opacity: 0, y: -8, height: 0 }}
                animate={{ opacity: 1, y: 0, height: 'auto' }}
                exit={{ opacity: 0, y: -8, height: 0 }}
              >
                <span className="auth-alert-icon">✓</span>
                {successMsg}
              </motion.div>
            )}
          </AnimatePresence>

          {/* Error */}
          <AnimatePresence>
            {formError && (
              <motion.div
                className="auth-alert auth-alert-error"
                initial={{ opacity: 0, y: -8, height: 0 }}
                animate={{ opacity: 1, y: 0, height: 'auto' }}
                exit={{ opacity: 0, y: -8, height: 0 }}
              >
                <span className="auth-alert-icon">✕</span>
                {formError}
              </motion.div>
            )}
          </AnimatePresence>

          {/* Form */}
          <form onSubmit={handleEmailAuth} className="auth-form">
            {/* Email */}
            <div className="auth-input-group">
              <span className="auth-input-icon">
                <MailIcon />
              </span>
              <input
                id="input-email"
                type="email"
                className="auth-input"
                placeholder="E-mail"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                required
                autoComplete="email"
              />
            </div>

            {/* Password */}
            <div className="auth-input-group">
              <span className="auth-input-icon">
                <LockIcon />
              </span>
              <input
                id="input-password"
                type={showPass ? 'text' : 'password'}
                className="auth-input"
                placeholder="Password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                required
                autoComplete={tab === 'signup' ? 'new-password' : 'current-password'}
              />
              <button
                type="button"
                className="auth-input-toggle"
                onClick={() => setShowPass(!showPass)}
                aria-label="Toggle password visibility"
              >
                {showPass ? <EyeOffIcon /> : <EyeIcon />}
              </button>
            </div>

            <motion.button
              id="btn-email-auth"
              type="submit"
              className="auth-submit-btn"
              disabled={formLoading}
              whileHover={{ scale: formLoading ? 1 : 1.02 }}
              whileTap={{ scale: formLoading ? 1 : 0.97 }}
            >
              {formLoading ? (
                <><div className="auth-spinner" /> {tab === 'signin' ? 'Signing in…' : 'Creating account…'}</>
              ) : tab === 'signin' ? 'SIGN IN' : 'CREATE ACCOUNT'}
            </motion.button>
          </form>

          {/* Divider */}
          <div className="auth-or-divider"><span>or continue with</span></div>

          {/* Google */}
          <motion.button
            id="btn-google-signin"
            onClick={handleGoogle}
            disabled={googleLoading}
            className="auth-google-btn"
            whileHover={{ scale: 1.02 }}
            whileTap={{ scale: 0.97 }}
          >
            {googleLoading
              ? <><div className="auth-spinner auth-spinner-sm" /> Redirecting…</>
              : <><GoogleIcon /> Continue with Google</>}
          </motion.button>

          {/* Tab switch */}
          <p className="auth-switch-text">
            {tab === 'signin' ? "Don't have an account? " : 'Already have an account? '}
            <button
              className="auth-switch-link"
              onClick={() => { setTab(tab === 'signin' ? 'signup' : 'signin'); setFormError(''); setSuccessMsg(''); }}
            >
              {tab === 'signin' ? 'Sign Up' : 'Sign In'}
            </button>
          </p>
        </div>

        {/* ── RIGHT: Gradient Panel ── */}
        <div className="auth-right-panel">
          <div className="auth-right-glow" aria-hidden />
          <motion.div
            className="auth-right-content"
            initial={{ opacity: 0, x: 20 }}
            animate={{ opacity: 1, x: 0 }}
            transition={{ delay: 0.2, duration: 0.5 }}
          >
            <div className="auth-right-icon" style={{ background: 'white', display: 'flex', alignItems: 'center', justifyContent: 'center', overflow: 'hidden', padding: 8 }}>
              <img src="/logo/logo.png" alt="MiladOne Logo" style={{ width: '100%', height: '100%', objectFit: 'contain' }} />
            </div>
            <h2 className="auth-right-title">
              {tab === 'signin' ? 'Glad to see You!' : 'Join MiladOne!'}
            </h2>
            <p className="auth-right-desc">
              {tab === 'signin'
                ? 'The real-time judge scoring platform built for competition excellence.'
                : 'Set up your judge account and start scoring events in real time.'}
            </p>
            <div className="auth-right-features">
              {['Real-time scores', 'Live leaderboard', 'Multi-judge support'].map((f) => (
                <div key={f} className="auth-right-feature-item">
                  <span className="auth-right-check">✓</span>
                  {f}
                </div>
              ))}
            </div>
          </motion.div>
        </div>
      </motion.div>

      {/* Footer */}
      <div className="auth-page-footer">
        Developed by <strong>MeridianTech</strong> · MiladOne © {new Date().getFullYear()}
      </div>
    </div>
  );
}

/* ── Icons ── */
function MailIcon() {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <rect x="2" y="4" width="20" height="16" rx="2" />
      <path d="m22 7-8.97 5.7a1.94 1.94 0 0 1-2.06 0L2 7" />
    </svg>
  );
}

function LockIcon() {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <rect x="3" y="11" width="18" height="11" rx="2" ry="2" />
      <path d="M7 11V7a5 5 0 0 1 10 0v4" />
    </svg>
  );
}

function EyeIcon() {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z" />
      <circle cx="12" cy="12" r="3" />
    </svg>
  );
}

function EyeOffIcon() {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M17.94 17.94A10.07 10.07 0 0 1 12 20c-7 0-11-8-11-8a18.45 18.45 0 0 1 5.06-5.94M9.9 4.24A9.12 9.12 0 0 1 12 4c7 0 11 8 11 8a18.5 18.5 0 0 1-2.16 3.19m-6.72-1.07a3 3 0 1 1-4.24-4.24" />
      <line x1="1" y1="1" x2="23" y2="23" />
    </svg>
  );
}

function GoogleIcon() {
  return (
    <svg width="18" height="18" viewBox="0 0 20 20" fill="none" style={{ flexShrink: 0 }}>
      <path d="M19.6 10.23c0-.68-.06-1.36-.17-2H10v3.77h5.38a4.6 4.6 0 01-2 3.02v2.51h3.22c1.89-1.74 2.98-4.3 2.98-7.3z" fill="#4285F4" />
      <path d="M10 20c2.7 0 4.96-.9 6.61-2.42l-3.22-2.5c-.9.6-2.04.96-3.39.96-2.6 0-4.81-1.76-5.6-4.12H1.08v2.59A9.99 9.99 0 0010 20z" fill="#34A853" />
      <path d="M4.4 11.92A5.97 5.97 0 014.1 10c0-.67.12-1.32.3-1.92V5.49H1.08A9.99 9.99 0 000 10c0 1.61.39 3.14 1.08 4.51l3.32-2.59z" fill="#FBBC05" />
      <path d="M10 3.96c1.47 0 2.79.51 3.83 1.5l2.86-2.86C14.96.9 12.7 0 10 0A9.99 9.99 0 001.08 5.49L4.4 8.08C5.19 5.72 7.4 3.96 10 3.96z" fill="#EA4335" />
    </svg>
  );
}
