'use client';

import { useEffect, useState, useRef } from 'react';
import { useRouter } from 'next/navigation';
import { apiFetch, UserProfile, Sender, EmailMessage } from '../../lib/api';
import { useForm } from 'react-hook-form';
import confetti from 'canvas-confetti';
import {
  Mail, Plus, LogOut, Clock, CheckCircle2, AlertCircle, Calendar,
  User, Upload, X, Search, FileText, Settings, RefreshCw, ChevronRight,
  TrendingUp, AlertTriangle, Eye, Inbox, Trash2
} from 'lucide-react';

interface ComposeFormData {
  senderId: string;
  subject: string;
  body: string;
  scheduledAt: string;
  delayBetweenSeconds: number;
  hourlyLimit: number;
}

export default function DashboardPage() {
  const router = useRouter();
  
  // States
  const [user, setUser] = useState<UserProfile | null>(null);
  const [senders, setSenders] = useState<Sender[]>([]);
  const [scheduledEmails, setScheduledEmails] = useState<EmailMessage[]>([]);
  const [sentEmails, setSentEmails] = useState<EmailMessage[]>([]);
  const [loadingUser, setLoadingUser] = useState(true);
  const [loadingData, setLoadingData] = useState(true);
  const [activeTab, setActiveTab] = useState<'scheduled' | 'sent'>('scheduled');
  
  // Compose modal states
  const [isComposeOpen, setIsComposeOpen] = useState(false);
  const [showReviewStep, setShowReviewStep] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);

  // File upload stats
  const [fileStats, setFileStats] = useState({
    total: 0,
    valid: 0,
    invalid: 0,
    duplicates: 0
  });
  const [parsedRecipients, setParsedRecipients] = useState<string[]>([]);
  const [fileName, setFileName] = useState<string | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  // Search state
  const [searchTerm, setSearchTerm] = useState('');

  // Form setup
  const { register, handleSubmit, reset, watch, setValue, formState: { errors } } = useForm<ComposeFormData>({
    defaultValues: {
      scheduledAt: '',
      delayBetweenSeconds: 2,
      hourlyLimit: 200
    }
  });

  // Watch form values for summary review step
  const watchAllFields = watch();

  // Authentication check
  useEffect(() => {
    async function initAuth() {
      const response = await apiFetch<UserProfile>('/auth/me');
      if (response.success && response.data) {
        setUser(response.data);
        setLoadingUser(false);
        // Load initial data
        fetchSenders();
        fetchEmails();
      } else {
        router.push('/');
      }
    }
    initAuth();
  }, [router]);

  // Real-time status update polling
  useEffect(() => {
    if (!user) return;

    // Poll email tables every 5 seconds to show real-time changes
    const timer = setInterval(() => {
      fetchEmails(false); // Silent fetch without loading skeleton
    }, 5000);

    return () => clearInterval(timer);
  }, [user]);

  // Set default scheduled start time on modal open
  useEffect(() => {
    if (isComposeOpen) {
      const now = new Date();
      // Format to yyyy-MM-ddThh:mm matching datetime-local input requirements
      const offsetMs = now.getTimezoneOffset() * 60 * 1000;
      const localISOTime = new Date(now.getTime() - offsetMs).toISOString().slice(0, 16);
      setValue('scheduledAt', localISOTime);
    }
  }, [isComposeOpen, setValue]);

  // Fetch functions
  const fetchSenders = async () => {
    const response = await apiFetch<Sender[]>('/senders');
    if (response.success && response.data) {
      setSenders(response.data);
      if (response.data.length > 0) {
        setValue('senderId', response.data[0].id);
      }
    }
  };

  const fetchEmails = async (showSkeleton = true) => {
    if (showSkeleton) setLoadingData(true);
    
    const [scheduledRes, sentRes] = await Promise.all([
      apiFetch<EmailMessage[]>('/emails/scheduled'),
      apiFetch<EmailMessage[]>('/emails/sent')
    ]);

    if (scheduledRes.success && scheduledRes.data) {
      setScheduledEmails(scheduledRes.data);
    }
    if (sentRes.success && sentRes.data) {
      setSentEmails(sentRes.data);
    }
    
    setLoadingData(false);
  };

  // Logout handler
  const handleLogout = async () => {
    const response = await apiFetch('/auth/logout', { method: 'POST' });
    if (response.success) {
      router.push('/');
    }
  };

  // CSV/TXT Client-side Parsing
  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    setFileName(file.name);
    const reader = new FileReader();

    reader.onload = (event) => {
      const text = event.target?.result as string;
      if (!text) return;

      // Split lines and trim whitespace
      const lines = text.split(/\r?\n/).map(line => line.trim()).filter(line => line.length > 0);
      
      const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
      const parsedEmails: string[] = [];
      let validCount = 0;
      let invalidCount = 0;
      let duplicateCount = 0;

      // Basic structure validation: skip header lines if present
      const firstLineParts = lines[0].toLowerCase().split(',');
      const hasHeader = firstLineParts.includes('email') || firstLineParts.includes('name');
      const dataLines = hasHeader ? lines.slice(1) : lines;

      dataLines.forEach((line) => {
        // Handle CSV comma splits or raw lists
        const parts = line.split(',');
        // Extract email field (matches regex or is the last element)
        let emailCandidate = parts[parts.length - 1].trim();
        
        // If it's name,email format:
        if (parts.length > 1) {
          const emailIndex = firstLineParts.indexOf('email');
          if (emailIndex >= 0 && emailIndex < parts.length) {
            emailCandidate = parts[emailIndex].trim();
          }
        }

        if (emailRegex.test(emailCandidate)) {
          if (parsedEmails.includes(emailCandidate)) {
            duplicateCount++;
          } else {
            parsedEmails.push(emailCandidate);
            validCount++;
          }
        } else {
          invalidCount++;
        }
      });

      setFileStats({
        total: dataLines.length,
        valid: validCount,
        invalid: invalidCount,
        duplicates: duplicateCount
      });
      setParsedRecipients(parsedEmails);
      setFormError(null);
    };

    reader.readAsText(file);
  };

  const triggerFileSelect = () => {
    fileInputRef.current?.click();
  };

  const removeSelectedFile = () => {
    setFileName(null);
    setFileStats({ total: 0, valid: 0, invalid: 0, duplicates: 0 });
    setParsedRecipients([]);
    if (fileInputRef.current) fileInputRef.current.value = '';
  };

  // Submit flow
  const onComposeSubmit = () => {
    if (parsedRecipients.length === 0) {
      setFormError('Please upload a file containing at least one valid recipient email address.');
      return;
    }
    // Proceed to summary review step before execution
    setFormError(null);
    setShowReviewStep(true);
  };

  const confirmSchedule = async () => {
    setSubmitting(true);
    setFormError(null);

    const inputData = watchAllFields;
    // Map local local datetime-local string to ISO Date representation
    const scheduledISO = new Date(inputData.scheduledAt).toISOString();
    const delayBetweenMs = inputData.delayBetweenSeconds * 1000;

    const payload = {
      senderId: inputData.senderId,
      subject: inputData.subject,
      body: inputData.body,
      scheduledAt: scheduledISO,
      delayBetweenMs,
      hourlyLimit: Number(inputData.hourlyLimit)
    };

    const response = await apiFetch<any>('/emails/schedule', {
      method: 'POST',
      body: JSON.stringify({
        ...payload,
        recipients: parsedRecipients
      })
    });

    setSubmitting(false);

    if (response.success) {
      // Trigger canvas-confetti celebration
      confetti({
        particleCount: 120,
        spread: 70,
        origin: { y: 0.6 }
      });

      // Reset form states
      setIsComposeOpen(false);
      setShowReviewStep(false);
      removeSelectedFile();
      reset();
      
      // Reload emails list
      fetchEmails();
    } else {
      setFormError(response.error?.message || 'Failed to schedule emails. Please try again.');
      setShowReviewStep(false);
    }
  };

  // Search filtering
  const filterEmails = (emails: EmailMessage[]) => {
    if (!searchTerm) return emails;
    const term = searchTerm.toLowerCase();
    return emails.filter(e => 
      e.recipient.toLowerCase().includes(term) ||
      e.subject.toLowerCase().includes(term) ||
      e.sender.email.toLowerCase().includes(term)
    );
  };

  const currentScheduled = filterEmails(scheduledEmails);
  const currentSent = filterEmails(sentEmails);

  return (
    <div className="min-h-screen bg-slate-950 flex flex-col text-slate-200 font-sans">
      {/* Top Header */}
      <header className="border-b border-slate-900 bg-slate-950/80 backdrop-blur-md sticky top-0 z-20 w-full">
        <div className="max-w-7xl mx-auto px-6 h-16 flex items-center justify-between">
          {/* Logo */}
          <div className="flex items-center gap-3">
            <div className="w-9 h-9 rounded-xl bg-gradient-to-tr from-indigo-600 to-cyan-500 flex items-center justify-center shadow-lg shadow-indigo-500/20">
              <Mail className="w-4.5 h-4.5 text-white" />
            </div>
            <div>
              <span className="font-extrabold text-lg tracking-tight bg-gradient-to-r from-white to-slate-200 bg-clip-text text-transparent">ReachInbox</span>
              <span className="text-[10px] font-bold uppercase tracking-widest text-cyan-400 block -mt-1 ml-0.5">Scheduler</span>
            </div>
          </div>

          {/* User Section & CTA */}
          <div className="flex items-center gap-4">
            {user && (
              <div className="flex items-center gap-3 border-r border-slate-850 pr-4">
                <img
                  src={user.avatar || 'https://lh3.googleusercontent.com/a/default-user'}
                  alt={user.name || 'User'}
                  className="w-8 h-8 rounded-full border border-slate-850 bg-slate-900 object-cover"
                />
                <div className="hidden md:block text-left">
                  <div className="text-xs font-semibold text-white leading-tight">{user.name || 'Sandbox User'}</div>
                  <div className="text-[10px] text-slate-400">{user.email}</div>
                </div>
              </div>
            )}
            
            <button
              onClick={handleLogout}
              className="p-2 rounded-xl text-slate-400 hover:text-white hover:bg-slate-900 transition-colors"
              title="Logout"
            >
              <LogOut className="w-5 h-5" />
            </button>
          </div>
        </div>
      </header>

      {/* Main Content Space */}
      <main className="flex-1 max-w-7xl w-full mx-auto px-6 py-8 flex flex-col gap-6">
        {/* Upper Dashboard Metric Section */}
        <section className="grid sm:grid-cols-3 gap-6">
          <div className="bg-slate-900/50 border border-slate-900 p-5 rounded-2xl backdrop-blur-sm flex items-center justify-between">
            <div>
              <p className="text-xs font-bold uppercase tracking-wider text-slate-400">Scheduled Queue</p>
              <h3 className="text-3xl font-black text-white mt-2">{scheduledEmails.filter(e => e.status === 'SCHEDULED').length}</h3>
            </div>
            <div className="w-12 h-12 rounded-xl bg-indigo-500/10 border border-indigo-500/20 flex items-center justify-center text-indigo-400">
              <Clock className="w-6 h-6" />
            </div>
          </div>
          <div className="bg-slate-900/50 border border-slate-900 p-5 rounded-2xl backdrop-blur-sm flex items-center justify-between">
            <div>
              <p className="text-xs font-bold uppercase tracking-wider text-slate-400">Successfully Sent</p>
              <h3 className="text-3xl font-black text-emerald-400 mt-2">{sentEmails.filter(e => e.status === 'SENT').length}</h3>
            </div>
            <div className="w-12 h-12 rounded-xl bg-emerald-500/10 border border-emerald-500/20 flex items-center justify-center text-emerald-400">
              <CheckCircle2 className="w-6 h-6" />
            </div>
          </div>
          <div className="bg-slate-900/50 border border-slate-900 p-5 rounded-2xl backdrop-blur-sm flex items-center justify-between">
            <div>
              <p className="text-xs font-bold uppercase tracking-wider text-slate-400">Failed / Retrying</p>
              <h3 className="text-3xl font-black text-rose-400 mt-2">
                {sentEmails.filter(e => e.status === 'FAILED').length + scheduledEmails.filter(e => e.status === 'RETRYING').length}
              </h3>
            </div>
            <div className="w-12 h-12 rounded-xl bg-rose-500/10 border border-rose-500/20 flex items-center justify-center text-rose-400">
              <AlertCircle className="w-6 h-6" />
            </div>
          </div>
        </section>

        {/* Search & Actions Toolbar */}
        <section className="flex flex-col md:flex-row md:items-center justify-between gap-4">
          {/* Tab Navigation */}
          <div className="flex bg-slate-900 p-1 rounded-xl border border-slate-850/50 w-fit">
            <button
              onClick={() => setActiveTab('scheduled')}
              className={`px-4 py-2 rounded-lg text-sm font-semibold transition-all duration-200 flex items-center gap-2 ${
                activeTab === 'scheduled' ? 'bg-slate-800 text-white shadow-sm' : 'text-slate-400 hover:text-slate-200'
              }`}
            >
              <Clock className="w-4 h-4" />
              Scheduled Emails
              <span className={`text-[10px] px-1.5 py-0.5 rounded-full ${
                activeTab === 'scheduled' ? 'bg-indigo-600 text-white' : 'bg-slate-800 text-slate-400'
              }`}>{scheduledEmails.length}</span>
            </button>
            <button
              onClick={() => setActiveTab('sent')}
              className={`px-4 py-2 rounded-lg text-sm font-semibold transition-all duration-200 flex items-center gap-2 ${
                activeTab === 'sent' ? 'bg-slate-800 text-white shadow-sm' : 'text-slate-400 hover:text-slate-200'
              }`}
            >
              <CheckCircle2 className="w-4 h-4" />
              Sent & Failed
              <span className={`text-[10px] px-1.5 py-0.5 rounded-full ${
                activeTab === 'sent' ? 'bg-indigo-600 text-white' : 'bg-slate-800 text-slate-400'
              }`}>{sentEmails.length}</span>
            </button>
          </div>

          <div className="flex items-center gap-3 w-full md:w-auto">
            {/* Search Input */}
            <div className="relative w-full md:w-64">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-500" />
              <input
                type="text"
                placeholder="Search emails..."
                value={searchTerm}
                onChange={(e) => setSearchTerm(e.target.value)}
                className="w-full bg-slate-900 border border-slate-850 rounded-xl pl-9 pr-4 py-2 text-sm focus:outline-none focus:border-indigo-500 placeholder:text-slate-600 text-slate-200 transition-colors"
              />
            </div>

            {/* Refresh Button */}
            <button
              onClick={() => fetchEmails(true)}
              className="p-2.5 rounded-xl border border-slate-850 bg-slate-900 text-slate-400 hover:text-white transition-colors hover:bg-slate-850 shrink-0"
              title="Refresh Lists"
            >
              <RefreshCw className="w-4 h-4" />
            </button>

            {/* Compose CTA */}
            <button
              onClick={() => setIsComposeOpen(true)}
              className="py-2.5 px-4 rounded-xl bg-indigo-600 hover:bg-indigo-500 text-white text-sm font-semibold transition-all duration-200 flex items-center gap-2 shadow-lg shadow-indigo-600/10 active:scale-[0.98] shrink-0"
            >
              <Plus className="w-4.5 h-4.5" />
              Compose Email
            </button>
          </div>
        </section>

        {/* Data Table */}
        <section className="bg-slate-900/25 border border-slate-900 rounded-2xl backdrop-blur-sm overflow-hidden flex-1 flex flex-col">
          {loadingData ? (
            /* Skeleton Loading State */
            <div className="p-6 flex flex-col gap-4 animate-pulse">
              {[1, 2, 3, 4, 5].map((i) => (
                <div key={i} className="h-14 bg-slate-900 rounded-xl w-full"></div>
              ))}
            </div>
          ) : (
            /* Table rendering */
            <div className="overflow-x-auto">
              <table className="w-full text-left border-collapse">
                <thead>
                  <tr className="border-b border-slate-900 text-xs font-bold uppercase tracking-wider text-slate-400 bg-slate-950/20">
                    <th className="px-6 py-4">Recipient</th>
                    <th className="px-6 py-4">Subject</th>
                    <th className="px-6 py-4">Sender</th>
                    <th className="px-6 py-4">
                      {activeTab === 'scheduled' ? 'Scheduled Time' : 'Sent/Failed Time'}
                    </th>
                    <th className="px-6 py-4">Status</th>
                    {activeTab === 'sent' && <th className="px-6 py-4">Actions</th>}
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-900 text-sm text-slate-350">
                  {activeTab === 'scheduled' ? (
                    currentScheduled.length === 0 ? (
                      /* Empty State */
                      <tr>
                        <td colSpan={5} className="py-20 text-center text-slate-500 font-medium">
                          <Inbox className="w-12 h-12 mx-auto text-slate-700 stroke-[1.5]" />
                          <p className="mt-4 text-slate-400">No scheduled emails in queue</p>
                          <p className="text-xs text-slate-500 mt-1">Compose a new email batch to see them here</p>
                        </td>
                      </tr>
                    ) : (
                      currentScheduled.map((e) => (
                        <tr key={e.id} className="hover:bg-slate-900/30 transition-colors">
                          <td className="px-6 py-4 font-semibold text-slate-200">{e.recipient}</td>
                          <td className="px-6 py-4 truncate max-w-xs">{e.subject}</td>
                          <td className="px-6 py-4 text-xs font-medium text-slate-400">
                            {e.sender.name}
                            <span className="block text-[10px] text-slate-500">{e.sender.email}</span>
                          </td>
                          <td className="px-6 py-4 text-xs text-slate-400">
                            {new Date(e.scheduledAt).toLocaleString()}
                          </td>
                          <td className="px-6 py-4">
                            <span className={`inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-semibold ${
                              e.status === 'PROCESSING' ? 'bg-amber-500/10 text-amber-400 border border-amber-500/20' :
                              e.status === 'RETRYING' ? 'bg-purple-500/10 text-purple-400 border border-purple-500/20 animate-pulse' :
                              'bg-indigo-500/10 text-indigo-400 border border-indigo-500/20'
                            }`}>
                              <span className={`w-1.5 h-1.5 rounded-full ${
                                e.status === 'PROCESSING' ? 'bg-amber-400' :
                                e.status === 'RETRYING' ? 'bg-purple-400' :
                                'bg-indigo-400'
                              }`} />
                              {e.status}
                            </span>
                          </td>
                        </tr>
                      ))
                    )
                  ) : (
                    currentSent.length === 0 ? (
                      /* Empty State */
                      <tr>
                        <td colSpan={6} className="py-20 text-center text-slate-500 font-medium">
                          <Inbox className="w-12 h-12 mx-auto text-slate-700 stroke-[1.5]" />
                          <p className="mt-4 text-slate-400">No sent or failed emails found</p>
                          <p className="text-xs text-slate-500 mt-1 font-normal">Your completed scheduled batches will display here</p>
                        </td>
                      </tr>
                    ) : (
                      currentSent.map((e) => (
                        <tr key={e.id} className="hover:bg-slate-900/30 transition-colors">
                          <td className="px-6 py-4 font-semibold text-slate-200">{e.recipient}</td>
                          <td className="px-6 py-4 truncate max-w-xs">{e.subject}</td>
                          <td className="px-6 py-4 text-xs font-medium text-slate-400">
                            {e.sender.name}
                            <span className="block text-[10px] text-slate-500">{e.sender.email}</span>
                          </td>
                          <td className="px-6 py-4 text-xs text-slate-400">
                            {e.sentAt 
                              ? new Date(e.sentAt).toLocaleString() 
                              : e.failedAt 
                                ? new Date(e.failedAt).toLocaleString()
                                : 'N/A'
                            }
                          </td>
                          <td className="px-6 py-4">
                            <span className={`inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-semibold ${
                              e.status === 'SENT' 
                                ? 'bg-emerald-500/10 text-emerald-400 border border-emerald-500/20' 
                                : 'bg-rose-500/10 text-rose-400 border border-rose-500/20'
                            }`}>
                              <span className={`w-1.5 h-1.5 rounded-full ${
                                e.status === 'SENT' ? 'bg-emerald-400' : 'bg-rose-400'
                              }`} />
                              {e.status}
                            </span>
                            {e.status === 'FAILED' && e.failureReason && (
                              <span className="block text-[10px] text-rose-500 mt-1 max-w-[200px] truncate" title={e.failureReason}>
                                {e.failureReason}
                              </span>
                            )}
                          </td>
                          <td className="px-6 py-4">
                            {e.status === 'SENT' && e.failureReason && e.failureReason.startsWith('Preview URL: ') ? (
                              <a
                                href={e.failureReason.replace('Preview URL: ', '')}
                                target="_blank"
                                rel="noopener noreferrer"
                                className="inline-flex items-center gap-1 text-xs text-cyan-400 hover:text-cyan-300 font-semibold hover:underline"
                              >
                                <Eye className="w-3.5 h-3.5" />
                                Preview Mail
                              </a>
                            ) : (
                              <span className="text-xs text-slate-600">-</span>
                            )}
                          </td>
                        </tr>
                      ))
                    )
                  )}
                </tbody>
              </table>
            </div>
          )}
        </section>
      </main>

      {/* Compose Form Modal Container */}
      {isComposeOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-950/80 backdrop-blur-sm">
          <div className="bg-slate-900 border border-slate-850 w-full max-w-2xl rounded-3xl overflow-hidden shadow-2xl flex flex-col relative animate-in fade-in zoom-in duration-200">
            {/* Modal Header */}
            <div className="px-6 py-5 border-b border-slate-850 flex items-center justify-between">
              <div>
                <h3 className="text-lg font-bold text-white">
                  {showReviewStep ? 'Review Configuration' : 'Compose Email Campaign'}
                </h3>
                <p className="text-xs text-slate-400 mt-1">
                  {showReviewStep ? 'Double check scheduling details' : 'Configure email list and scheduling intervals'}
                </p>
              </div>
              <button
                onClick={() => {
                  setIsComposeOpen(false);
                  setShowReviewStep(false);
                  removeSelectedFile();
                }}
                className="p-1 rounded-lg text-slate-400 hover:text-white hover:bg-slate-800 transition-colors"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            {/* Modal Body */}
            <div className="p-6 overflow-y-auto max-h-[70vh]">
              {formError && (
                <div className="mb-6 p-4 rounded-xl bg-rose-500/10 border border-rose-500/25 text-rose-400 text-sm flex items-start gap-3">
                  <AlertCircle className="w-5 h-5 shrink-0 mt-0.5" />
                  <p>{formError}</p>
                </div>
              )}

              {!showReviewStep ? (
                /* Camapign Compose Step Form */
                <form onSubmit={handleSubmit(onComposeSubmit)} className="flex flex-col gap-5">
                  <div className="grid sm:grid-cols-2 gap-5">
                    {/* Sender Selection */}
                    <div className="flex flex-col gap-1.5">
                      <label className="text-xs font-bold uppercase tracking-wider text-slate-400">Send From Account</label>
                      <select
                        {...register('senderId', { required: 'Please select a sender' })}
                        className="bg-slate-950 border border-slate-800 rounded-xl px-4 py-2.5 text-sm text-slate-200 focus:outline-none focus:border-indigo-500 transition-colors"
                      >
                        {senders.map((s) => (
                          <option key={s.id} value={s.id}>
                            {s.name} ({s.email})
                          </option>
                        ))}
                      </select>
                    </div>

                    {/* Start Time */}
                    <div className="flex flex-col gap-1.5">
                      <label className="text-xs font-bold uppercase tracking-wider text-slate-400">Scheduled Start Time</label>
                      <input
                        type="datetime-local"
                        required
                        {...register('scheduledAt', { required: 'Scheduled start time is required' })}
                        className="bg-slate-950 border border-slate-800 rounded-xl px-4 py-2 text-sm text-slate-200 focus:outline-none focus:border-indigo-500 transition-colors"
                      />
                    </div>
                  </div>

                  <div className="grid sm:grid-cols-2 gap-5">
                    {/* Delay Slider */}
                    <div className="flex flex-col gap-1.5">
                      <div className="flex items-center justify-between">
                        <label className="text-xs font-bold uppercase tracking-wider text-slate-400">Delay Between Sends</label>
                        <span className="text-xs font-bold text-cyan-400">{watchAllFields.delayBetweenSeconds}s</span>
                      </div>
                      <div className="flex items-center gap-3 mt-1">
                        <input
                          type="range"
                          min="2"
                          max="60"
                          {...register('delayBetweenSeconds', { valueAsNumber: true })}
                          className="flex-1 accent-indigo-500 bg-slate-950 h-1.5 rounded-lg cursor-pointer"
                        />
                      </div>
                      <p className="text-[10px] text-slate-500">Provider-mimic throttling delay. Min 2 seconds.</p>
                    </div>

                    {/* Hourly Rate Limit */}
                    <div className="flex flex-col gap-1.5">
                      <label className="text-xs font-bold uppercase tracking-wider text-slate-400">Hourly Rate Limit</label>
                      <input
                        type="number"
                        min="1"
                        {...register('hourlyLimit', { required: 'Hourly rate limit is required', valueAsNumber: true })}
                        className="bg-slate-950 border border-slate-800 rounded-xl px-4 py-2 text-sm text-slate-200 focus:outline-none focus:border-indigo-500 transition-colors"
                      />
                      <p className="text-[10px] text-slate-500">Overflows are rescheduled to next available hour window.</p>
                    </div>
                  </div>

                  {/* CSV / TXT Upload component */}
                  <div className="flex flex-col gap-1.5">
                    <label className="text-xs font-bold uppercase tracking-wider text-slate-400">Upload Leads List (CSV/TXT)</label>
                    
                    {!fileName ? (
                      /* Uploader drag area */
                      <div
                        onClick={triggerFileSelect}
                        className="border-2 border-dashed border-slate-800 hover:border-indigo-500/50 hover:bg-indigo-500/[0.01] rounded-2xl p-6 text-center cursor-pointer transition-all flex flex-col items-center gap-2 group"
                      >
                        <Upload className="w-8 h-8 text-slate-500 group-hover:text-indigo-400 transition-colors shrink-0" />
                        <span className="text-sm font-semibold text-slate-350">Drag and drop or browse files</span>
                        <span className="text-xs text-slate-500">Supports comma-separated emails, name+email CSV or raw TXT line format</span>
                        <input
                          type="file"
                          accept=".csv,.txt"
                          ref={fileInputRef}
                          onChange={handleFileChange}
                          className="hidden"
                        />
                      </div>
                    ) : (
                      /* Uploaded file summary stats card */
                      <div className="p-4 rounded-2xl bg-slate-950 border border-slate-850 flex items-start gap-4">
                        <div className="w-10 h-10 rounded-xl bg-indigo-500/10 border border-indigo-500/25 flex items-center justify-center text-indigo-400 shrink-0">
                          <FileText className="w-5 h-5" />
                        </div>
                        <div className="flex-1 text-left">
                          <h4 className="text-sm font-bold text-white truncate">{fileName}</h4>
                          
                          {/* Grid stats */}
                          <div className="grid grid-cols-4 gap-2 mt-3 text-center">
                            <div className="bg-slate-900 rounded-lg p-1.5 border border-slate-850/50">
                              <span className="block text-xs font-extrabold text-slate-200">{fileStats.valid}</span>
                              <span className="text-[9px] uppercase tracking-wider font-bold text-slate-500">Valid</span>
                            </div>
                            <div className="bg-slate-900 rounded-lg p-1.5 border border-slate-850/50">
                              <span className="block text-xs font-extrabold text-rose-400">{fileStats.invalid}</span>
                              <span className="text-[9px] uppercase tracking-wider font-bold text-slate-500">Invalid</span>
                            </div>
                            <div className="bg-slate-900 rounded-lg p-1.5 border border-slate-850/50">
                              <span className="block text-xs font-extrabold text-amber-400">{fileStats.duplicates}</span>
                              <span className="text-[9px] uppercase tracking-wider font-bold text-slate-500">Dupes</span>
                            </div>
                            <div className="bg-slate-900 rounded-lg p-1.5 border border-slate-850/50">
                              <span className="block text-xs font-extrabold text-white">{fileStats.total}</span>
                              <span className="text-[9px] uppercase tracking-wider font-bold text-slate-500">Total</span>
                            </div>
                          </div>
                        </div>
                        <button
                          onClick={removeSelectedFile}
                          className="p-1.5 rounded-lg text-slate-500 hover:text-white hover:bg-slate-900 transition-colors self-start"
                        >
                          <Trash2 className="w-4 h-4 text-rose-500" />
                        </button>
                      </div>
                    )}
                  </div>

                  {/* Subject */}
                  <div className="flex flex-col gap-1.5">
                    <label className="text-xs font-bold uppercase tracking-wider text-slate-400">Campaign Subject</label>
                    <input
                      type="text"
                      placeholder="e.g. Scaling outreach with AI workflows..."
                      required
                      {...register('subject', { required: 'Campaign subject is required' })}
                      className="w-full bg-slate-950 border border-slate-800 rounded-xl px-4 py-2.5 text-sm focus:outline-none focus:border-indigo-500 placeholder:text-slate-700 text-slate-200 transition-colors"
                    />
                  </div>

                  {/* Body */}
                  <div className="flex flex-col gap-1.5">
                    <label className="text-xs font-bold uppercase tracking-wider text-slate-400">Campaign Message Body</label>
                    <textarea
                      placeholder="Write your cold outreach content here..."
                      rows={5}
                      required
                      {...register('body', { required: 'Message body content is required' })}
                      className="w-full bg-slate-950 border border-slate-800 rounded-xl px-4 py-3 text-sm focus:outline-none focus:border-indigo-500 placeholder:text-slate-700 text-slate-200 transition-colors font-sans resize-none"
                    />
                  </div>

                  {/* Submit buttons */}
                  <div className="flex items-center justify-end gap-3 mt-4 border-t border-slate-850 pt-5">
                    <button
                      type="button"
                      onClick={() => {
                        setIsComposeOpen(false);
                        removeSelectedFile();
                        reset();
                      }}
                      className="px-4 py-2.5 rounded-xl border border-slate-800 text-sm font-semibold hover:bg-slate-800 transition-colors"
                    >
                      Cancel
                    </button>
                    <button
                      type="submit"
                      className="px-5 py-2.5 rounded-xl bg-indigo-600 hover:bg-indigo-500 text-white text-sm font-semibold transition-all shadow-lg shadow-indigo-600/10 active:scale-[0.98]"
                    >
                      Review & Schedule
                    </button>
                  </div>
                </form>
              ) : (
                /* Campaign Summary Review step */
                <div className="flex flex-col gap-6 text-left">
                  <div className="p-4 rounded-2xl bg-amber-500/5 border border-amber-500/15 text-amber-400 text-sm flex items-start gap-3">
                    <AlertTriangle className="w-5 h-5 shrink-0 mt-0.5" />
                    <div>
                      <h5 className="font-bold">Review Scheduling Rules</h5>
                      <p className="text-xs mt-1 text-slate-400">
                        Emails are queued individually using deterministic IDs. All throttling limits are checked dynamically inside the worker at send time.
                      </p>
                    </div>
                  </div>

                  <div className="grid grid-cols-2 gap-4 text-sm bg-slate-950 p-5 rounded-2xl border border-slate-850">
                    <div>
                      <span className="text-slate-500 block text-xs uppercase font-bold">Sender Identity</span>
                      <span className="font-semibold text-slate-200 mt-1 block">
                        {senders.find(s => s.id === watchAllFields.senderId)?.name || 'Default Sender'}
                      </span>
                      <span className="text-xs text-slate-400 block mt-0.5">
                        {senders.find(s => s.id === watchAllFields.senderId)?.email}
                      </span>
                    </div>
                    <div>
                      <span className="text-slate-500 block text-xs uppercase font-bold">Campaign Target</span>
                      <span className="font-semibold text-slate-200 mt-1 block">
                        {fileStats.valid} Valid Recipients
                      </span>
                      <span className="text-xs text-slate-400 block mt-0.5">
                        (Excluded {fileStats.invalid + fileStats.duplicates} invalid/dupes)
                      </span>
                    </div>
                    <div className="mt-2 border-t border-slate-900 pt-3">
                      <span className="text-slate-500 block text-xs uppercase font-bold">Start Time</span>
                      <span className="font-semibold text-slate-200 mt-1 block">
                        {new Date(watchAllFields.scheduledAt).toLocaleString()}
                      </span>
                    </div>
                    <div className="mt-2 border-t border-slate-900 pt-3">
                      <span className="text-slate-500 block text-xs uppercase font-bold">Throttling Rules</span>
                      <span className="font-semibold text-slate-200 mt-1 block">
                        Min Delay: {watchAllFields.delayBetweenSeconds}s
                      </span>
                      <span className="text-xs text-cyan-400 block mt-0.5">
                        Hourly Limit: {watchAllFields.hourlyLimit}/hr
                      </span>
                    </div>
                  </div>

                  {/* Mail previews */}
                  <div className="flex flex-col gap-2">
                    <span className="text-slate-500 text-xs uppercase font-bold">Campaign Subject & Content</span>
                    <div className="bg-slate-950/50 border border-slate-850 p-4 rounded-xl">
                      <div className="font-bold text-white border-b border-slate-900 pb-2 mb-2">
                        Subject: {watchAllFields.subject}
                      </div>
                      <p className="text-slate-400 text-xs whitespace-pre-line leading-relaxed">
                        {watchAllFields.body}
                      </p>
                    </div>
                  </div>

                  {/* Execution actions */}
                  <div className="flex items-center justify-end gap-3 mt-4 border-t border-slate-850 pt-5">
                    <button
                      type="button"
                      disabled={submitting}
                      onClick={() => setShowReviewStep(false)}
                      className="px-4 py-2.5 rounded-xl border border-slate-800 text-sm font-semibold hover:bg-slate-850 transition-colors disabled:opacity-50"
                    >
                      Back
                    </button>
                    <button
                      type="button"
                      disabled={submitting}
                      onClick={confirmSchedule}
                      className="px-5 py-2.5 rounded-xl bg-indigo-600 hover:bg-indigo-500 disabled:bg-indigo-600/50 text-white text-sm font-semibold transition-all shadow-lg shadow-indigo-600/10 flex items-center gap-2 active:scale-[0.98]"
                    >
                      {submitting && <RefreshCw className="w-4 h-4 animate-spin" />}
                      {submitting ? 'Creating Jobs...' : 'Confirm & Schedule Batch'}
                    </button>
                  </div>
                </div>
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
