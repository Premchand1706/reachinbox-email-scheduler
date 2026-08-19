'use client';

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { apiFetch, UserProfile } from '../lib/api';
import { Mail, ShieldCheck, Zap, Server, ChevronRight, LogIn } from 'lucide-react';

export default function LoginPage() {
  const router = useRouter();
  const [loading, setLoading] = useState(true);
  const [devEmail, setDevEmail] = useState('intern@reachinbox.ai');

  // Check if user is already logged in
  useEffect(() => {
    async function checkAuth() {
      const response = await apiFetch<UserProfile>('/auth/me');
      if (response.success && response.data) {
        router.push('/dashboard');
      } else {
        setLoading(false);
      }
    }
    checkAuth();
  }, [router]);

  const handleGoogleLogin = () => {
    // Redirect browser to backend Google OAuth initiation endpoint
    window.location.href = 'http://localhost:4000/api/auth/google';
  };

  const handleDevLogin = (e: React.FormEvent) => {
    e.preventDefault();
    window.location.href = `http://localhost:4000/api/auth/dev-login?email=${encodeURIComponent(devEmail)}`;
  };

  if (loading) {
    return (
      <div className="min-h-screen bg-slate-950 flex flex-col items-center justify-center text-slate-200">
        <div className="relative w-16 h-16">
          <div className="absolute inset-0 rounded-full border-4 border-indigo-500/25 animate-ping"></div>
          <div className="absolute inset-0 rounded-full border-4 border-indigo-500 border-t-transparent animate-spin"></div>
        </div>
        <p className="mt-6 text-sm text-slate-400 font-medium tracking-wide">Securing session...</p>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-slate-950 text-slate-200 flex flex-col relative overflow-hidden font-sans">
      {/* Background Gradients */}
      <div className="absolute top-[-10%] left-[-10%] w-[50%] h-[50%] rounded-full bg-indigo-900/20 blur-[120px] pointer-events-none"></div>
      <div className="absolute bottom-[-10%] right-[-10%] w-[50%] h-[50%] rounded-full bg-cyan-900/20 blur-[120px] pointer-events-none"></div>

      {/* Header */}
      <header className="w-full max-w-7xl mx-auto px-6 py-6 flex items-center justify-between z-10">
        <div className="flex items-center gap-3">
          <div className="w-10 h-10 rounded-xl bg-gradient-to-tr from-indigo-600 to-cyan-500 flex items-center justify-center shadow-lg shadow-indigo-500/20">
            <Mail className="w-5 h-5 text-white" />
          </div>
          <div>
            <span className="font-extrabold text-xl tracking-tight bg-gradient-to-r from-white via-slate-100 to-indigo-400 bg-clip-text text-transparent">ReachInbox</span>
            <span className="text-xs font-semibold uppercase tracking-widest text-cyan-400 block -mt-1 ml-0.5">Scheduler</span>
          </div>
        </div>
      </header>

      {/* Main Grid */}
      <main className="flex-1 max-w-7xl w-full mx-auto px-6 grid lg:grid-cols-12 gap-12 items-center z-10 py-12">
        {/* Left Side: Product Intro */}
        <div className="lg:col-span-7 flex flex-col gap-6 text-left">
          <div className="inline-flex items-center gap-2 px-3 py-1 rounded-full bg-indigo-500/10 border border-indigo-500/20 text-xs font-semibold text-indigo-400 w-fit">
            <Zap className="w-3.5 h-3.5" /> High-Performance Email Queue
          </div>
          <h1 className="text-4xl md:text-5xl lg:text-6xl font-black leading-tight tracking-tight text-white">
            Scale Your Outreach <br />
            <span className="bg-gradient-to-r from-indigo-400 via-purple-400 to-cyan-400 bg-clip-text text-transparent">
              Reliably and Persistently
            </span>
          </h1>
          <p className="text-slate-400 text-lg max-w-xl leading-relaxed">
            Build scheduled email sequences that survive restarts, respect per-sender rate limits, throttle execution atomically, and offer absolute deliverability monitoring.
          </p>

          <div className="grid sm:grid-cols-2 gap-6 mt-4">
            <div className="p-5 rounded-2xl bg-slate-900/50 border border-slate-800/80 backdrop-blur-sm flex items-start gap-4">
              <div className="w-10 h-10 rounded-xl bg-indigo-500/10 border border-indigo-500/25 flex items-center justify-center text-indigo-400 shrink-0">
                <Server className="w-5 h-5" />
              </div>
              <div>
                <h3 className="font-bold text-white text-base">Persistent Queues</h3>
                <p className="text-slate-400 text-sm mt-1">Powered by BullMQ & Redis delayed jobs. Zero job loss on server downtime.</p>
              </div>
            </div>
            <div className="p-5 rounded-2xl bg-slate-900/50 border border-slate-800/80 backdrop-blur-sm flex items-start gap-4">
              <div className="w-10 h-10 rounded-xl bg-cyan-500/10 border border-cyan-500/25 flex items-center justify-center text-cyan-400 shrink-0">
                <ShieldCheck className="w-5 h-5" />
              </div>
              <div>
                <h3 className="font-bold text-white text-base">Atomic Idempotency</h3>
                <p className="text-slate-400 text-sm mt-1">Row-level database locks ensure double sends are strictly impossible.</p>
              </div>
            </div>
          </div>
        </div>

        {/* Right Side: Auth Form Container */}
        <div className="lg:col-span-5 flex justify-center w-full">
          <div className="w-full max-w-md p-8 rounded-3xl bg-slate-900/80 border border-slate-850 backdrop-blur-md shadow-2xl flex flex-col gap-6 relative">
            <div className="absolute top-0 right-0 w-[40%] h-[40%] bg-indigo-500/10 blur-[50px] pointer-events-none rounded-full"></div>
            
            <div className="text-center">
              <h2 className="text-2xl font-bold text-white tracking-tight">Access Dashboard</h2>
              <p className="text-sm text-slate-400 mt-2">Sign in using OAuth or the testing sandbox below</p>
            </div>

            {/* Google OAuth Login */}
            <button
              onClick={handleGoogleLogin}
              className="w-full py-3.5 px-5 rounded-xl bg-white text-slate-900 hover:bg-slate-100 font-semibold text-sm transition-all duration-200 shadow-lg shadow-white/5 flex items-center justify-center gap-3 border border-slate-200 group active:scale-[0.98]"
            >
              <svg className="w-5 h-5 shrink-0" viewBox="0 0 24 24" fill="none">
                <path d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z" fill="#4285F4"/>
                <path d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z" fill="#34A853"/>
                <path d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.06H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.94l2.85-2.22.81-.63z" fill="#FBBC05"/>
                <path d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.06l3.66 2.84c.87-2.6 3.3-4.52 6.16-4.52z" fill="#EA4335"/>
              </svg>
              Sign in with Google
            </button>

            {process.env.NEXT_PUBLIC_ENABLE_DEV_SANDBOX === 'true' && (
              <>
                {/* Separator */}
                <div className="flex items-center gap-3">
                  <div className="h-px bg-slate-800 flex-1"></div>
                  <span className="text-xs font-semibold uppercase tracking-widest text-slate-500">or use sandbox</span>
                  <div className="h-px bg-slate-800 flex-1"></div>
                </div>

                {/* Developer Bypass Sandbox Form */}
                <form onSubmit={handleDevLogin} className="flex flex-col gap-4">
                  <div className="flex flex-col gap-1.5 text-left">
                    <label className="text-xs font-bold uppercase tracking-wider text-slate-400">Sandbox Email Address</label>
                    <input
                      type="email"
                      required
                      placeholder="intern@reachinbox.ai"
                      value={devEmail}
                      onChange={(e) => setDevEmail(e.target.value)}
                      className="w-full bg-slate-950 border border-slate-800 rounded-xl px-4 py-3 text-sm focus:outline-none focus:border-indigo-500 transition-colors placeholder:text-slate-600"
                    />
                  </div>

                  <button
                    type="submit"
                    className="w-full py-3 px-5 rounded-xl bg-indigo-600 hover:bg-indigo-500 text-white font-semibold text-sm transition-all duration-200 shadow-lg shadow-indigo-600/25 flex items-center justify-center gap-2 group active:scale-[0.98]"
                  >
                    <LogIn className="w-4.5 h-4.5" />
                    Enter Sandbox Environment
                    <ChevronRight className="w-4 h-4 group-hover:translate-x-0.5 transition-transform" />
                  </button>
                </form>
              </>
            )}
          </div>
        </div>
      </main>

      {/* Footer */}
      <footer className="w-full max-w-7xl mx-auto px-6 py-6 text-center text-xs text-slate-500 tracking-wide mt-auto z-10 border-t border-slate-900/50">
        ReachInbox Hiring Assignment • Built with Node, Express, Next.js, Redis, BullMQ, and PostgreSQL.
      </footer>
    </div>
  );
}
