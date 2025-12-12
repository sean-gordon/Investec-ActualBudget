import React, { useState, useEffect, useMemo } from 'react';
import { Activity, Settings, Play, CreditCard, ExternalLink, Wifi, Download, Github, Trash2, Power, PauseCircle, MousePointerClick } from 'lucide-react';
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
  
  const [isConnected, setIsConnected] = useState(false);
  const [processingProfiles, setProcessingProfiles] = useState<string[]>([]);
  const [serverVersion, setServerVersion] = useState<string>('Unknown');
  const [updateInfo, setUpdateInfo] = useState<{ available: boolean; latest: string } | null>(null);
  const [isUpdating, setIsUpdating] = useState(false);

  const fetchJson = async (url: string, options?: RequestInit) => {
    try {
      const res = await fetch(url, options);
      if (!res.ok) {
        const text = await res.text().catch(() => 'No error details');
        throw new Error(`API Error ${res.status}: ${text.substring(0, 100)}`);
      }
      const contentType = res.headers.get('content-type');
      if (contentType && contentType.includes('application/json')) {
        return await res.json();
      }
      throw new Error(`Invalid response type: ${contentType}`);
    } catch (error) {
      throw error;
    }
  };

  // Initial Load & Version Check
  useEffect(() => {
    fetchJson(`${API_BASE}/config`)
      .then(data => {
        setConfig(data);
        // Default to first enabled profile
        if (data.profiles && data.profiles.length > 0) {
            const firstEnabled = data.profiles.find((p: any) => p.enabled) || data.profiles[0];
            setActiveProfileId(firstEnabled.id);
        }
      })
      .catch(console.error);

    fetchJson(`${API_BASE}/version-check`)
      .then(data => {
        if (data.updateAvailable) {
          setUpdateInfo({ available: true, latest: data.latest });
        }
      })
      .catch(console.error);
  }, []);

  // System Polling (Status + System Logs)
  useEffect(() => {
    const poll = async () => {
      try {
        const statusData = await fetchJson(`${API_BASE}/status`);
        setIsConnected(true);
        setProcessingProfiles(statusData.processingProfiles || []);
        setServerVersion(statusData.version);

        const logsData = await fetchJson(`${API_BASE}/logs`);
        // Tag system logs
        const taggedLogs = logsData.map((l: LogEntry) => ({ ...l, source: 'System' }));
        setSystemLogs(taggedLogs);

      } catch (e) {
        setIsConnected(false);
      }
    };
    poll();
    const interval = setInterval(poll, 2000);
    return () => clearInterval(interval);
  }, []);

  // AI Logs Polling (Based on Active Profile)
  useEffect(() => {
    if (!activeProfileId) {
        setRawAiLogs('');
        return;
    }

    const pollAi = async () => {
        const profile = config.profiles.find(p => p.id === activeProfileId);
        if (!profile || !profile.actualAiContainer) {
            setRawAiLogs('');
            return;
        }

        try {
            const res = await fetchJson(`${API_BASE}/docker/logs?container=${profile.actualAiContainer}`);
            setRawAiLogs(res.logs || '');
        } catch (e) {
            console.error("Failed to fetch AI logs", e);
        }
    };

    pollAi();
    const interval = setInterval(pollAi, 5000);
    return () => clearInterval(interval);
  }, [activeProfileId, config.profiles]);

  // Compute Merged Logs
  const mergedLogs = useMemo(() => {
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

            parsedAiLogs.push({
                timestamp,
                message,
                type: message.toLowerCase().includes('error') ? 'error' : 'info',
                source: 'Actual AI'
            });
        });
    }

    // Combine and Sort
    return [...systemLogs, ...parsedAiLogs].sort((a, b) => a.timestamp - b.timestamp);
  }, [systemLogs, rawAiLogs]);


  const handleSaveSettings = async (newConfig: AppConfig) => {
    try {
      await fetchJson(`${API_BASE}/config`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(newConfig)
      });
      setConfig(newConfig);
      setView('dashboard');
    } catch (e) {
      alert("Failed to save settings. Check console.");
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
      alert("Failed to start sync.");
    }
  };

  const toggleProfile = async (profileId: string, enabled: boolean) => {
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
    } catch (e) { console.error(e); }
  };

  const deleteProfile = async (profileId: string) => {
      if (!confirm("Delete profile?")) return;
      const updatedProfiles = config.profiles.filter(p => p.id !== profileId);
      setConfig({ ...config, profiles: updatedProfiles });
      if (activeProfileId === profileId) setActiveProfileId(null);

      try {
          await fetchJson(`${API_BASE}/config`, {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({ ...config, profiles: updatedProfiles })
          });
      } catch (e) { console.error(e); }
  };

  const activeProfileName = config.profiles.find(p => p.id === activeProfileId)?.name || 'System';

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
                  alert("Update started! Reload in 10s.");
                  setTimeout(() => window.location.reload(), 10000);
                } catch (e) { setIsUpdating(false); }
              }}
              disabled={isUpdating}
              className="flex items-center gap-2 px-3 py-1.5 bg-blue-600 hover:bg-blue-500 text-white text-sm font-semibold rounded-full animate-pulse"
            >
              <Download size={14} />
              Update
            </button>
          )}
          <a href="https://github.com/sean-gordon/Investec-ActualBudget" target="_blank" className="p-2 rounded-full hover:bg-slate-800 text-slate-400">
            <Github size={20} />
          </a>
          <button
            onClick={() => setView(view === 'dashboard' ? 'settings' : 'dashboard')}
            className={`p-2 rounded-full hover:bg-slate-800 ${view === 'settings' ? 'bg-slate-800 text-white' : 'text-slate-400'}`}
          >
            <Settings size={20} />
          </button>
        </div>
      </header>

      {/* Content */}
      <main className="flex-1 overflow-hidden p-8">
        <div className="max-w-7xl mx-auto h-full">
          
          {view === 'settings' ? (
            <div className="h-full overflow-y-auto">
                <SettingsForm config={config} onSave={handleSaveSettings} />
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
                                    <th className="px-6 py-3 text-right bg-slate-900">Actions</th>
                                </tr>
                            </thead>
                            <tbody className="divide-y divide-slate-800/50">
                                {config.profiles && config.profiles.length > 0 ? (
                                    config.profiles.map(profile => {
                                        const isSyncing = processingProfiles.includes(profile.id);
                                        const isEnabled = profile.enabled !== false;
                                        const isActive = activeProfileId === profile.id;
                                        
                                        return (
                                            <tr 
                                                key={profile.id} 
                                                onClick={() => setActiveProfileId(profile.id)}
                                                className={`cursor-pointer transition-colors border-l-4 ${isActive 
                                                    ? 'bg-slate-800/60 border-investec-500' 
                                                    : 'hover:bg-slate-800/30 border-transparent'
                                                } ${!isEnabled ? 'opacity-50 grayscale' : ''}`}
                                            >
                                                <td className="px-6 py-4 whitespace-nowrap">
                                                    {isSyncing ? (
                                                        <span className="text-blue-400 text-xs flex items-center gap-1"><div className="w-1.5 h-1.5 bg-blue-500 rounded-full animate-pulse"/> Syncing</span>
                                                    ) : isEnabled ? (
                                                        <span className="text-emerald-400 text-xs flex items-center gap-1"><div className="w-1.5 h-1.5 bg-emerald-500 rounded-full"/> Ready</span>
                                                    ) : (
                                                        <span className="text-slate-500 text-xs">Disabled</span>
                                                    )}
                                                </td>
                                                <td className="px-6 py-4 font-medium text-white">
                                                    {profile.name}
                                                </td>
                                                <td className="px-6 py-4 font-mono text-xs text-slate-500 truncate max-w-[150px]">
                                                    {profile.actualServerUrl}
                                                </td>
                                                <td className="px-6 py-4 text-right" onClick={e => e.stopPropagation()}>
                                                    <div className="flex items-center justify-end gap-2">
                                                        <button
                                                            onClick={() => triggerSync(profile.id)}
                                                            disabled={!isEnabled || isSyncing || !isConnected}
                                                            className={`p-1.5 rounded-md ${!isEnabled || isSyncing ? 'text-slate-600' : 'text-investec-500 hover:bg-investec-500/10'}`}
                                                        >
                                                            <Play size={16} fill={isSyncing ? "none" : "currentColor"} />
                                                        </button>
                                                        <button
                                                            onClick={() => toggleProfile(profile.id, !isEnabled)}
                                                            className={`p-1.5 rounded-md ${isEnabled ? 'text-slate-400 hover:text-orange-400' : 'text-slate-600 hover:text-green-400'}`}
                                                        >
                                                            {isEnabled ? <PauseCircle size={16} /> : <Power size={16} />}
                                                        </button>
                                                        <button onClick={() => deleteProfile(profile.id)} className="p-1.5 rounded-md text-slate-500 hover:text-red-400">
                                                            <Trash2 size={16} />
                                                        </button>
                                                    </div>
                                                </td>
                                            </tr>
                                        );
                                    })
                                ) : (
                                    <tr><td colSpan={4} className="px-6 py-8 text-center text-slate-500 italic">No profiles found.</td></tr>
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
                    <div className="px-5 py-4 border-b border-slate-800 bg-slate-900/50 flex-none">
                         <h2 className="text-lg font-semibold text-white">Live Logs: <span className="text-investec-500">{activeProfileName}</span></h2>
                         <p className="text-[10px] text-slate-500 mt-1">Showing System Events & Actual AI Output</p>
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
