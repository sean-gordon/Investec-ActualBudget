import { useState, useEffect, useMemo, useRef } from 'react';
import { Activity, Settings, Play, CreditCard, ExternalLink, Wifi, Download, Github, Trash2, Power, PauseCircle, MousePointerClick, FileText, LogOut, RefreshCw } from 'lucide-react';
import { AppConfig, LogEntry } from './types';
import { SettingsForm } from './components/SettingsForm';
import { LogConsole } from './components/LogConsole';

const API_BASE = '/api';

export default function App() {
  const [view, setView] = useState<'dashboard' | 'settings'>('dashboard');
  const [config, setConfig] = useState<AppConfig>({
    profiles: [],
    hostProjectRoot: ''
  });
  
  // State
  const [activeProfileId, setActiveProfileId] = useState<string | null>(null);
  const [systemLogs, setSystemLogs] = useState<LogEntry[]>([]);
  const [rawAiLogs, setRawAiLogs] = useState<string>('');
  
  // Update Log View State
  const [logViewMode, setLogViewMode] = useState<'live' | 'file'>('live');
  const logViewModeRef = useRef<'live' | 'file'>('live');
  const [updateLogData, setUpdateLogData] = useState<LogEntry[]>([]);
  const [isLoadingUpdateLog, setIsLoadingUpdateLog] = useState(false);
  
  const [isConnected, setIsConnected] = useState(false);
  const [processingProfiles, setProcessingProfiles] = useState<string[]>([]);
  const [serverVersion, setServerVersion] = useState<string>('Unknown');
  const [updateInfo, setUpdateInfo] = useState<{ available: boolean; latest: string } | null>(null);
  const [isUpdating, setIsUpdating] = useState(false);
  const [loginError, setLoginError] = useState<string | null>(null);

  const [sessionToken, setSessionToken] = useState<string | null>(localStorage.getItem('sync_token'));

  const handleLogout = () => {
    setSessionToken(null);
    localStorage.removeItem('sync_token');
    setLoginError(null);
  };

  const fetchJson = async (url: string, options: RequestInit = {}) => {
    const headers = {
      ...(options.headers || {}),
      'x-session-token': sessionToken || ''
    };

    const res = await fetch(url, { ...options, headers });
    if (res.status === 401 && !url.includes('/login')) {
      handleLogout();
      throw new Error('Unauthorized');
    }
    if (!res.ok) {
      const contentType = res.headers.get('content-type') || '';
      if (contentType.includes('application/json')) {
        const errJson = await res.json().catch(() => null);
        throw new Error(errJson?.error || `API Error ${res.status}`);
      }
      const text = await res.text().catch(() => 'No error details');
      const isHtml = contentType.includes('text/html') || /^\s*<!doctype html|^\s*<html/i.test(text);
      if (isHtml && [502, 503, 504].includes(res.status)) {
        throw new Error(`Server is temporarily unreachable (HTTP ${res.status}). If an update or restart is in progress, wait a moment and reload.`);
      }
      if (isHtml) {
        throw new Error(`Server returned HTTP ${res.status}.`);
      }
      throw new Error(`API Error ${res.status}: ${text.substring(0, 120)}`);
    }
    const contentType = res.headers.get('content-type');
    if (contentType && contentType.includes('application/json')) {
      return await res.json();
    }
    return null;
  };

  const handleLogin = async (password: string) => {
    setLoginError(null);
    try {
        const res = await fetch(`${API_BASE}/login`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ password })
        });
        if (res.status === 401) {
            setLoginError('Invalid password. Please try again.');
            return false;
        }
        if (!res.ok) {
            const text = await res.text().catch(() => 'No error details');
            setLoginError(`Login failed (${res.status}): ${text.substring(0, 100)}`);
            return false;
        }
        const data = await res.json();
        if (data?.token) {
            setSessionToken(data.token);
            localStorage.setItem('sync_token', data.token);
            return true;
        }
        setLoginError('Login failed: no session token returned.');
        return false;
    } catch (e) {
        setLoginError(`Login failed: ${(e as Error).message}`);
        return false;
    }
  };

  const fetchUpdateLog = async (silent = false) => {
      if (!silent) setIsLoadingUpdateLog(true);
      try {
          const res = await fetch(`${API_BASE}/debug/update-log`, {
              headers: { 'x-session-token': sessionToken || '' },
              cache: 'no-store'
          });
          if (res.status === 401) {
              handleLogout();
              throw new Error("Unauthorized");
          }
          if (!res.ok) throw new Error(`HTTP ${res.status}`);
          const text = await res.text();
          
          const parsed: LogEntry[] = [];
          const lines = text.split('\n');
          // Regex to match: [2024-12-12T10:00:00.000Z] Message
          const regex = /^\[(.*?)\] (.*)$/;
          let lastTimestamp = Date.now();
          
          lines.forEach(line => {
              const cleanLine = line.replace(/\x1b\[[0-9;]*[a-zA-Z]/g, '');
              const match = cleanLine.match(regex);
              if (match) {
                  const ts = Date.parse(match[1]);
                  const msg = match[2];
                  lastTimestamp = isNaN(ts) ? lastTimestamp : ts;
                  parsed.push({
                      timestamp: lastTimestamp,
                      message: msg,
                      type: msg.toLowerCase().includes('error') || msg.toLowerCase().includes('failed') ? 'error' : 'info',
                      source: 'System'
                  });
              } else if (cleanLine.trim()) {
                  parsed.push({
                      timestamp: lastTimestamp,
                      message: cleanLine,
                      type: cleanLine.toLowerCase().includes('error') ? 'error' : 'info',
                      source: 'System'
                  });
              }
          });
          setUpdateLogData(parsed);
          
      } catch (e) {
          console.error("Fetch update log failed", e);
          if (!silent && (e as Error).message !== 'Unauthorized') {
              alert(`Could not fetch update log: ${(e as Error).message}`);
          }
      } finally {
          if (!silent) setIsLoadingUpdateLog(false);
      }
  };

  useEffect(() => {
    logViewModeRef.current = logViewMode;
  }, [logViewMode]);

  useEffect(() => {
    if (!sessionToken || logViewMode !== 'file') return;
    fetchUpdateLog();
    if (!isUpdating) return;
    const interval = setInterval(() => fetchUpdateLog(true), 3000);
    return () => clearInterval(interval);
  }, [sessionToken, logViewMode, isUpdating]);

  // Initial Load & Version Check
  useEffect(() => {
    if (!sessionToken) return;
    
    fetchJson(`${API_BASE}/config`)
      .then(data => {
        if (!data) return;
        setConfig(data);
        // Default to first enabled profile
        if (data.profiles && data.profiles.length > 0) {
            const firstEnabled = data.profiles.find((p: any) => p.enabled !== false) || data.profiles[0];
            setActiveProfileId(firstEnabled.id);
        }
      })
      .catch(console.error);

    fetchJson(`${API_BASE}/version-check`)
      .then(data => {
        if (data?.updateAvailable) {
          setUpdateInfo({ available: true, latest: data.latest });
        }
      })
      .catch(console.error);
  }, [sessionToken]);

  // System Polling (Status + System Logs)
  useEffect(() => {
    if (!sessionToken) return;

    const poll = async () => {
      try {
        const statusData = await fetchJson(`${API_BASE}/status`);
        if (!statusData) return;
        setIsConnected(true);
        setProcessingProfiles(statusData.processingProfiles || []);
        setServerVersion(statusData.version);
        if (typeof statusData.isUpdating === 'boolean') {
          setIsUpdating(statusData.isUpdating);
        }

        if (logViewModeRef.current === 'live') {
            const logsData = await fetchJson(`${API_BASE}/logs`);
            if (!logsData) return;
            // Tag system logs
            const taggedLogs = logsData.map((l: LogEntry) => ({ ...l, source: 'System' }));
            setSystemLogs(taggedLogs);
        }

      } catch (e) {
        if ((e as Error).message !== 'Unauthorized') {
            setIsConnected(false);
        }
      }
    };
    poll();
    const interval = setInterval(poll, 2000);
    return () => clearInterval(interval);
  }, [sessionToken]);

  // Reset AI logs when switching profiles
  useEffect(() => {
    setRawAiLogs('');
  }, [activeProfileId]);

  // AI Logs Polling (Based on Active Profile)
  useEffect(() => {
    if (!sessionToken || !activeProfileId || logViewMode !== 'live') {
        if (logViewMode !== 'live') setRawAiLogs(''); // Clear if not looking at live
        return;
    }

    const pollAi = async () => {
        const profile = config.profiles.find(p => p.id === activeProfileId);
        if (!profile || !profile.actualAiContainer) {
            setRawAiLogs('');
            return;
        }

        try {
            const containerName = encodeURIComponent(profile.actualAiContainer);
            const res = await fetchJson(`${API_BASE}/docker/logs?container=${containerName}`);
            if (res) setRawAiLogs(res.logs || '');
        } catch (e) {
            console.error("Failed to fetch AI logs", e);
        }
    };

    pollAi();
    const interval = setInterval(pollAi, 5000);
    return () => clearInterval(interval);
  }, [sessionToken, activeProfileId, config.profiles, logViewMode]);

  // Compute Merged Logs
  const mergedLogs = useMemo(() => {
    if (logViewMode === 'file') return updateLogData;

    // 1. Filter System Logs based on Active Profile
    const activeProfile = config.profiles.find(p => p.id === activeProfileId);
    const filteredSystemLogs = systemLogs.filter(log => {
        if (!activeProfile) return true;
        
        // 1. Bracket Check (Worker Logs: [Profile Name] ...)
        const match = log.message.match(/^\[(.*?)\]/);
        if (match) {
            return match[1].trim() === activeProfile.name.trim();
        }

        // 2. Generic Logs (Scheduler/System: "Schedule set for 'Profile Name'")
        // Strategy: Find the longest profile name mentioned in the log.
        // If the longest match is the Active Profile -> Show.
        // If the longest match is Another Profile -> Hide.
        // If no profile names are found -> Show (Generic System Log).
        
        const allProfiles = config.profiles;
        // Sort by length desc to match "Sean Investec" before "Sean"
        const sortedNames = [...allProfiles]
            .map(p => p.name)
            .sort((a, b) => b.length - a.length);

        const matchedName = sortedNames.find(name => log.message.includes(name));

        if (matchedName) {
            // A profile was mentioned. Only show if it matches the active profile.
            return matchedName === activeProfile.name;
        }

        // No profiles mentioned (e.g. "System Online") -> Keep it
        return true;
    });

    const parsedAiLogs: LogEntry[] = [];
    
    if (rawAiLogs) {
        const lines = rawAiLogs.split('\n');
        lines.forEach(line => {
            if (!line.trim()) return;
            // Docker --timestamps format: 2024-12-12T10:00:00.000000000Z Message...
            const parts = line.split(' ');
            let timestamp = Date.now();
            let message = line;
            
            // Try to parse leading ISO string
            if (parts.length > 1) {
                const potentialDate = Date.parse(parts[0]);
                if (!isNaN(potentialDate)) {
                    timestamp = potentialDate;
                    message = parts.slice(1).join(' '); // Remainder is message
                }
            }

            // Strip ANSI escape codes from container output
            message = message.replace(/\x1b\[[0-9;]*[a-zA-Z]/g, '');
            // Strip duplicate leading ISO timestamp if the app logs its own timestamp after Docker's
            message = message.replace(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?Z\s+/, '');

            parsedAiLogs.push({
                timestamp,
                message,
                type: message.toLowerCase().includes('error') ? 'error' : 'info',
                source: 'Actual AI'
            });
        });
    }

    // Combine and Sort
    return [...filteredSystemLogs, ...parsedAiLogs].sort((a, b) => a.timestamp - b.timestamp);
  }, [systemLogs, rawAiLogs, logViewMode, updateLogData, activeProfileId, config.profiles]);


  const handleProfileSelect = (id: string) => {
      setRawAiLogs(''); // Clear immediately to prevent ghost logs
      setActiveProfileId(id);
  };

  const handleSaveSettings = async (newConfig: AppConfig) => {
    try {
      const result = await fetchJson(`${API_BASE}/config`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(newConfig)
      });
      const savedConfig: AppConfig = (await fetchJson(`${API_BASE}/config`)) || newConfig;
      setConfig(savedConfig);
      setActiveProfileId(currentId => {
        const profiles = savedConfig.profiles || [];
        if (profiles.length === 0) return null;
        if (currentId && profiles.some(p => p.id === currentId)) return currentId;
        const firstEnabled = profiles.find(p => p.enabled !== false) || profiles[0];
        return firstEnabled.id;
      });
      setView('dashboard');
      if (result?.warnings?.length) {
        alert(`Settings saved, but some schedules were not enabled:\n\n${result.warnings.join('\n')}`);
      }
    } catch (e) {
      alert(`Failed to save settings: ${(e as Error).message}`);
    }
  };

  const triggerSync = async (profileId: string) => {
    if (processingProfiles.includes(profileId)) return;
    setProcessingProfiles(prev => [...prev, profileId]);
    try {
      await fetchJson(`${API_BASE}/sync`, { 
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ profileId })
      });
    } catch (e) {
      setProcessingProfiles(prev => prev.filter(id => id !== profileId));
      alert(`Failed to start sync: ${(e as Error).message}`);
    }
  };

  const toggleProfile = async (profileId: string, enabled: boolean) => {
    const previousConfig = config;
    const updatedProfiles = config.profiles.map(p => 
        p.id === profileId ? { ...p, enabled } : p
    );
    setConfig({ ...config, profiles: updatedProfiles });
    
    try {
        await fetchJson(`${API_BASE}/config`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ ...config, profiles: updatedProfiles })
        });
    } catch (e) {
        setConfig(previousConfig);
        alert(`Failed to update profile state: ${(e as Error).message}`);
    }
  };

  const deleteProfile = async (profileId: string) => {
      if (!confirm("Delete profile?")) return;
      const previousConfig = config;
      const previousActiveProfileId = activeProfileId;
      const updatedProfiles = config.profiles.filter(p => p.id !== profileId);
      setConfig({ ...config, profiles: updatedProfiles });
      if (activeProfileId === profileId) {
          const nextProfile = updatedProfiles.find(p => p.enabled !== false) || updatedProfiles[0];
          setActiveProfileId(nextProfile?.id || null);
      }

      try {
          await fetchJson(`${API_BASE}/config`, {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({ ...config, profiles: updatedProfiles })
          });
      } catch (e) {
          setConfig(previousConfig);
          setActiveProfileId(previousActiveProfileId);
          alert(`Failed to delete profile: ${(e as Error).message}`);
      }
  };

  const activeProfileName = config.profiles.find(p => p.id === activeProfileId)?.name || 'System';

  if (!sessionToken) {
    return (
        <div className="flex items-center justify-center h-screen bg-slate-950 text-slate-200 p-8">
            <div className="max-w-md w-full bg-slate-900 p-8 rounded-2xl border border-slate-800 shadow-2xl">
                <div className="flex flex-col items-center gap-4 mb-8">
                    <div className="bg-investec-900 p-4 rounded-2xl border border-slate-700">
                        <Activity className="text-investec-500" size={32} />
                    </div>
                    <h1 className="text-2xl font-bold text-white">Investec / Actual Sync</h1>
                    <p className="text-sm text-slate-500 text-center">Enter your master password to access the sync manager.</p>
                </div>
                <form 
                    onSubmit={async (e) => {
                        e.preventDefault();
                        const pass = (e.currentTarget.elements.namedItem('password') as HTMLInputElement).value;
                        await handleLogin(pass);
                    }}
                    className="space-y-4"
                >
                    <input 
                        name="password"
                        type="password" 
                        placeholder="Master Password"
                        onChange={() => { if (loginError) setLoginError(null); }}
                        className="w-full bg-slate-950 border border-slate-700 rounded-xl px-4 py-3 focus:ring-2 focus:ring-investec-500 outline-none transition-all"
                        autoFocus
                    />
                    {loginError && (
                        <p className="text-sm text-red-400 text-center" role="alert">{loginError}</p>
                    )}
                    <button 
                        type="submit"
                        className="w-full bg-investec-500 hover:bg-yellow-400 text-black font-bold py-3 rounded-xl transition-all shadow-lg shadow-yellow-900/10"
                    >
                        Login
                    </button>
                </form>
            </div>
        </div>
    );
  }

  return (
    <div className="flex flex-col h-screen overflow-hidden bg-slate-950 text-slate-200">
      {/* Header */}
      <header className="flex-none flex items-center justify-between px-8 py-6 border-b border-slate-800 bg-slate-950/50 backdrop-blur-sm z-10">
        <div className="flex items-center gap-3">
          <div className="bg-investec-900 p-2 rounded-lg border border-slate-700">
            <Activity className="text-investec-500" size={24} />
          </div>
          <div>
            <h1 className="text-xl font-bold text-white tracking-tight">Investec <span className="text-slate-500 mx-1">/</span> Actual Sync</h1>
            <div className="flex items-center gap-2">
                <span className={`w-2 h-2 rounded-full ${isConnected ? 'bg-green-500' : 'bg-red-500'}`}></span>
                <p className="text-xs text-slate-500">Server v{serverVersion}</p>
            </div>
          </div>
        </div>
        <div className="flex items-center gap-3">
          {updateInfo?.available && (
            <button
              onClick={async () => {
                if (!confirm(`Update to version ${updateInfo.latest}?`)) return;
                setIsUpdating(true);
                try {
                  await fetchJson(`${API_BASE}/update`, { method: 'POST' });
                  alert("Update started. Docker is building the new image and will restart automatically (typically 30-60 seconds). Check Update History logs for progress.");
                } catch (e) {
                  setIsUpdating(false);
                  alert(`Failed to start update: ${(e as Error).message}`);
                }
              }}
              disabled={isUpdating}
              className={`flex items-center gap-2 px-3 py-1.5 text-white text-sm font-semibold rounded-full ${isUpdating ? 'bg-blue-800 cursor-not-allowed opacity-75' : 'bg-blue-600 hover:bg-blue-500 animate-pulse'}`}
            >
              <Download size={14} />
              {isUpdating ? 'Updating...' : 'Update'}
            </button>
          )}
          <a
            href="https://github.com/sean-gordon/Investec-ActualBudget"
            target="_blank"
            rel="noreferrer"
            title="GitHub Repository"
            aria-label="GitHub Repository"
            className="p-2 rounded-full hover:bg-slate-800 text-slate-400"
          >
            <Github size={20} />
          </a>
          <button
            onClick={() => setView(view === 'dashboard' ? 'settings' : 'dashboard')}
            title={view === 'settings' ? 'Back to Dashboard' : 'Settings'}
            aria-label={view === 'settings' ? 'Back to Dashboard' : 'Settings'}
            className={`p-2 rounded-full hover:bg-slate-800 ${view === 'settings' ? 'bg-slate-800 text-white' : 'text-slate-400'}`}
          >
            <Settings size={20} />
          </button>
          <button
            onClick={handleLogout}
            title="Log out"
            aria-label="Log out"
            className="p-2 rounded-full hover:bg-slate-800 text-slate-400 hover:text-red-400"
          >
            <LogOut size={20} />
          </button>
        </div>
      </header>

      {/* Content */}
      <main className="flex-1 overflow-hidden p-8">
        <div className="max-w-7xl mx-auto h-full">
          
          {view === 'settings' ? (
            <div className="h-full overflow-y-auto">
                <SettingsForm config={config} onSave={handleSaveSettings} sessionToken={sessionToken} onUnauthorized={handleLogout} />
            </div>
          ) : (
            <div className="grid grid-cols-1 xl:grid-cols-3 gap-8 h-full">
              
              {/* Left Col */}
              <div className="xl:col-span-2 flex flex-col gap-6 h-full overflow-hidden">
                
                {/* Profiles Table */}
                <div className="bg-slate-900 rounded-xl border border-slate-800 shadow-lg overflow-hidden flex flex-col flex-1 min-h-0">
                    <div className="px-6 py-4 border-b border-slate-800 flex justify-between items-center bg-slate-900/50 flex-none">
                        <h2 className="text-lg font-semibold text-white flex items-center gap-2">
                            <CreditCard size={18} className="text-investec-500" />
                            Sync Profiles
                        </h2>
                        <span className="text-xs text-slate-500 flex items-center gap-1">
                            <MousePointerClick size={12} /> Click row to view logs
                        </span>
                    </div>

                    <div className="flex-1 overflow-auto">
                        <table className="w-full text-left text-sm text-slate-400">
                            <thead className="bg-slate-950/50 text-xs uppercase text-slate-500 font-semibold sticky top-0 z-10">
                                <tr>
                                    <th className="px-6 py-3 bg-slate-900">Status</th>
                                    <th className="px-6 py-3 bg-slate-900">Profile Name</th>
                                    <th className="px-6 py-3 bg-slate-900">Target</th>
                                    <th className="px-6 py-3 bg-slate-900">Schedule</th>
                                    <th className="px-6 py-3 text-right bg-slate-900">Actions</th>
                                </tr>
                            </thead>
                            <tbody className="divide-y divide-slate-800/50">
                                {config.profiles && config.profiles.length > 0 ? (
                                    config.profiles.map(profile => {
                                        const isSyncing = processingProfiles.includes(profile.id);
                                        const isEnabled = profile.enabled !== false;
                                        const isActive = activeProfileId === profile.id;
                                        const syncDisabled = !isEnabled || isSyncing || !isConnected;
                                        
                                        return (
                                            <tr 
                                                key={profile.id} 
                                                onClick={() => handleProfileSelect(profile.id)}
                                                className={`cursor-pointer transition-colors border-l-4 ${
                                                    isActive 
                                                    ? 'bg-slate-800/60 border-investec-500' 
                                                    : 'hover:bg-slate-800/30 border-transparent'
                                                } ${!isEnabled ? 'opacity-50 grayscale' : ''}`}
                                            >
                                                <td className="px-6 py-4 whitespace-nowrap">
                                                    {isSyncing ? (
                                                        <span className="text-blue-400 text-xs flex items-center gap-1"><span className="inline-block w-1.5 h-1.5 bg-blue-500 rounded-full animate-pulse"/> Syncing</span>
                                                    ) : isEnabled ? (
                                                        <span className="text-emerald-400 text-xs flex items-center gap-1"><span className="inline-block w-1.5 h-1.5 bg-emerald-500 rounded-full"/> Ready</span>
                                                    ) : (
                                                        <span className="text-slate-500 text-xs">Disabled</span>
                                                    )}
                                                </td>
                                                <td className="px-6 py-4 font-medium text-white">
                                                    {profile.name}
                                                </td>
                                                <td className="px-6 py-4 font-mono text-xs text-slate-500 truncate max-w-[180px]" title={profile.actualServerUrl}>
                                                    {profile.actualServerUrl}
                                                </td>
                                                <td className="px-6 py-4 font-mono text-xs text-slate-500 whitespace-nowrap">
                                                    {profile.syncSchedule || 'Manual'}
                                                </td>
                                                <td className="px-6 py-4 text-right" onClick={e => e.stopPropagation()}>
                                                    <div className="flex items-center justify-end gap-2">
                                                        <button
                                                            onClick={() => triggerSync(profile.id)}
                                                            disabled={syncDisabled}
                                                            title={isSyncing ? 'Sync running' : !isConnected ? 'Server offline' : !isEnabled ? 'Profile disabled' : 'Run sync now'}
                                                            aria-label={`Sync ${profile.name}`}
                                                            className={`p-1.5 rounded-md ${syncDisabled ? 'text-slate-600 cursor-not-allowed' : 'text-investec-500 hover:bg-investec-500/10'}`}
                                                        >
                                                            <Play size={16} fill={isSyncing ? "none" : "currentColor"} />
                                                        </button>
                                                        <button
                                                            onClick={() => toggleProfile(profile.id, !isEnabled)}
                                                            title={isEnabled ? 'Disable profile' : 'Enable profile'}
                                                            aria-label={isEnabled ? `Disable ${profile.name}` : `Enable ${profile.name}`}
                                                            className={`p-1.5 rounded-md ${isEnabled ? 'text-slate-400 hover:text-orange-400' : 'text-slate-600 hover:text-green-400'}`}
                                                        >
                                                            {isEnabled ? <PauseCircle size={16} /> : <Power size={16} />}
                                                        </button>
                                                        <button
                                                            onClick={() => deleteProfile(profile.id)}
                                                            title="Delete profile"
                                                            aria-label={`Delete ${profile.name}`}
                                                            className="p-1.5 rounded-md text-slate-500 hover:text-red-400"
                                                        >
                                                            <Trash2 size={16} />
                                                        </button>
                                                    </div>
                                                </td>
                                            </tr>
                                        );
                                    })
                                ) : (
                                    <tr>
                                        <td colSpan={5} className="px-6 py-10 text-center text-slate-500">
                                            <p className="italic mb-3">No profiles found.</p>
                                            <button
                                                onClick={() => setView('settings')}
                                                className="inline-flex items-center gap-2 px-4 py-2 bg-investec-500 hover:bg-yellow-400 text-black text-xs font-bold rounded-lg transition-colors"
                                            >
                                                <Settings size={14} />
                                                Open Settings to Add a Profile
                                            </button>
                                        </td>
                                    </tr>
                                )}
                            </tbody>
                        </table>
                    </div>
                </div>
                
                 {/* System Status Cards */}
                <div className="grid grid-cols-1 md:grid-cols-2 gap-6 flex-none">
                    <div className="bg-slate-900 p-5 rounded-xl border border-slate-800 flex items-center gap-4">
                        <div className={`p-3 rounded-full ${isConnected ? 'bg-green-500/10 text-green-500' : 'bg-red-500/10 text-red-500'}`}>
                            <Wifi size={20} />
                        </div>
                        <div>
                            <p className="text-xs text-slate-500 uppercase font-bold tracking-wider">Service Status</p>
                            <p className="text-sm font-medium text-white">{isConnected ? 'Online & Connected' : 'Offline'}</p>
                        </div>
                    </div>

                    <div className="bg-slate-900 p-5 rounded-xl border border-slate-800 flex items-center gap-4">
                        <div className="p-3 rounded-full bg-blue-500/10 text-blue-500">
                            <Activity size={20} />
                        </div>
                        <div>
                            <p className="text-xs text-slate-500 uppercase font-bold tracking-wider">Active Tasks</p>
                            <p className="text-sm font-medium text-white">{processingProfiles.length} Sync Jobs Running</p>
                        </div>
                    </div>
                </div>

              </div>

              {/* Right Col: Logs */}
              <div className="xl:col-span-1 flex flex-col h-full overflow-hidden">
                <div className="bg-slate-900 rounded-xl border border-slate-800 shadow-lg flex flex-col h-full overflow-hidden">
                    <div className="px-5 py-4 border-b border-slate-800 bg-slate-900/50 flex-none flex justify-between items-center">
                        <div>
                            <h2 className="text-lg font-semibold text-white">
                                {logViewMode === 'live' ? 'Live Logs:' : 'System Logs:'} <span className="text-investec-500">
                                    {logViewMode === 'live' ? activeProfileName : 'Update History'}
                                </span>
                            </h2>
                            <p className="text-[10px] text-slate-500 mt-1">
                                {logViewMode === 'live' ? 'Showing System Events & Actual AI Output' : 'Showing persistent update logs from disk'}
                            </p>
                        </div>
                        
                        <div className="flex items-center gap-1.5">
                            {logViewMode === 'file' && (
                                <button
                                    type="button"
                                    onClick={() => fetchUpdateLog()}
                                    disabled={isLoadingUpdateLog}
                                    className="p-2 rounded-lg transition-colors border bg-slate-800 text-slate-400 border-slate-700 hover:text-white disabled:opacity-50"
                                    title="Refresh Update History"
                                    aria-label="Refresh Update History"
                                >
                                    <RefreshCw size={14} className={isLoadingUpdateLog ? 'animate-spin' : ''} />
                                </button>
                            )}
                            <div className="flex rounded-lg border border-slate-700 bg-slate-950 p-0.5">
                                <button
                                    type="button"
                                    onClick={() => setLogViewMode('live')}
                                    className={`flex items-center gap-1 px-2.5 py-1.5 rounded-md text-xs font-medium transition-colors ${
                                        logViewMode === 'live'
                                        ? 'bg-slate-800 text-white'
                                        : 'text-slate-400 hover:text-slate-200'
                                    }`}
                                    title="View Live Stream"
                                    aria-pressed={logViewMode === 'live'}
                                >
                                    <Activity size={13} />
                                    Live
                                </button>
                                <button
                                    type="button"
                                    onClick={() => setLogViewMode('file')}
                                    className={`flex items-center gap-1 px-2.5 py-1.5 rounded-md text-xs font-medium transition-colors ${
                                        logViewMode === 'file'
                                        ? 'bg-investec-500/20 text-investec-500'
                                        : 'text-slate-400 hover:text-slate-200'
                                    }`}
                                    title="View Update History"
                                    aria-pressed={logViewMode === 'file'}
                                >
                                    <FileText size={13} />
                                    History
                                </button>
                            </div>
                        </div>
                    </div>
                    <div className="flex-1 overflow-hidden p-0 relative">
                         <div className="absolute inset-0">
                            <LogConsole logs={mergedLogs} />
                         </div>
                    </div>
                </div>
              </div>

            </div>
          )}
        </div>
      </main>
      
      <footer className="flex-none p-4 text-center text-xs text-slate-600 bg-slate-950/80 backdrop-blur-sm border-t border-slate-900">
        <a href="https://actualbudget.com" target="_blank" rel="noreferrer" className="hover:text-slate-400 inline-flex items-center gap-1">
          Powered by Actual Budget <ExternalLink size={10} />
        </a>
      </footer>
    </div>
  );
}
