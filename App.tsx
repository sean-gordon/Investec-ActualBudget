import React, { useState, useEffect } from 'react';
import { Activity, Settings, Play, CreditCard, ExternalLink, Wifi, Clock, Download, Github, Trash2, Power, PauseCircle } from 'lucide-react';
import { AppConfig, LogEntry, SyncProfile } from './types';
import { SettingsForm } from './components/SettingsForm';
import { LogConsole } from './components/LogConsole';

const API_BASE = '/api';

export default function App() {
  const [view, setView] = useState<'dashboard' | 'settings'>('dashboard');
  const [config, setConfig] = useState<AppConfig>({
    profiles: [],
    hostProjectRoot: ''
  });
  const [logs, setLogs] = useState<LogEntry[]>([]);
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

  useEffect(() => {
    // Initial Load
    fetchJson(`${API_BASE}/config`)
      .then(data => setConfig(data))
      .catch(console.error);

    // Check for updates
    fetchJson(`${API_BASE}/version-check`)
      .then(data => {
        if (data.updateAvailable) {
          setUpdateInfo({ available: true, latest: data.latest });
        }
      })
      .catch(console.error);

    // Poll Status and Logs
    const poll = async () => {
      try {
        // 1. Get Status
        const statusData = await fetchJson(`${API_BASE}/status`);
        setIsConnected(true);
        setProcessingProfiles(statusData.processingProfiles || []);
        setServerVersion(statusData.version);

        // 2. Get Logs
        const logsData = await fetchJson(`${API_BASE}/logs`);
        setLogs(logsData);

      } catch (e) {
        setIsConnected(false);
      }
    };

    poll();
    const interval = setInterval(poll, 2000);
    return () => clearInterval(interval);
  }, []);

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
    
    // Optimistic update
    setProcessingProfiles(prev => [...prev, profileId]);
    
    try {
      await fetchJson(`${API_BASE}/sync`, { 
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ profileId })
      });
    } catch (e) {
      console.error("Failed to trigger sync:", e);
      setProcessingProfiles(prev => prev.filter(id => id !== profileId));
      alert("Failed to start sync. Check server connection.");
    }
  };

  const toggleProfile = async (profileId: string, enabled: boolean) => {
    // 1. Create updated profiles array
    const updatedProfiles = config.profiles.map(p => 
        p.id === profileId ? { ...p, enabled } : p
    );
    
    // 2. Create full new config object
    const newConfig = { ...config, profiles: updatedProfiles };
    
    // 3. Optimistic UI Update
    setConfig(newConfig);
    
    try {
        await fetchJson(`${API_BASE}/config`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(newConfig)
        });
    } catch (e) {
        console.error("Failed to toggle profile:", e);
        // Revert on error would be ideal, but usually next poll fixes it
    }
  };

  const deleteProfile = async (profileId: string) => {
      if (!confirm("Are you sure you want to delete this profile? This cannot be undone.")) return;
      
      const updatedProfiles = config.profiles.filter(p => p.id !== profileId);
      const newConfig = { ...config, profiles: updatedProfiles };
      
      setConfig(newConfig);
      
      try {
          await fetchJson(`${API_BASE}/config`, {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify(newConfig)
          });
      } catch (e) {
          console.error("Failed to delete profile:", e);
          alert("Failed to delete profile.");
      }
  };

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
                if (!confirm(`Update to version ${updateInfo.latest}? The server will restart.`)) return;
                setIsUpdating(true);
                try {
                  await fetchJson(`${API_BASE}/update`, { method: 'POST' });
                  alert("Update started! The page will reload in 10 seconds.");
                  setTimeout(() => window.location.reload(), 10000);
                } catch (e) {
                  alert("Update failed to start.");
                  setIsUpdating(false);
                }
              }}
              disabled={isUpdating}
              className="flex items-center gap-2 px-3 py-1.5 bg-blue-600 hover:bg-blue-500 text-white text-sm font-semibold rounded-full transition-all animate-pulse"
            >
              <Download size={14} />
              {isUpdating ? 'Updating...' : 'Update Available'}
            </button>
          )}
          <a 
            href="https://github.com/sean-gordon/Investec-ActualBudget" 
            target="_blank" 
            rel="noopener noreferrer"
            className="p-2 rounded-full hover:bg-slate-800 transition-colors text-slate-400"
            title="View on GitHub"
          >
            <Github size={20} />
          </a>
          <button
            onClick={() => setView(view === 'dashboard' ? 'settings' : 'dashboard')}
            className={`p-2 rounded-full hover:bg-slate-800 transition-colors ${view === 'settings' ? 'bg-slate-800 text-white' : 'text-slate-400'}`}
          >
            <Settings size={20} />
          </button>
        </div>
      </header>

      {/* Content */}
      <main className="flex-1 overflow-y-auto p-8">
        <div className="max-w-7xl mx-auto h-full">
          
          {view === 'settings' ? (
            <SettingsForm config={config} onSave={handleSaveSettings} />
          ) : (
            <div className="grid grid-cols-1 xl:grid-cols-3 gap-8 h-full">
              
              {/* Left Col: Profiles Table */}
              <div className="xl:col-span-2 flex flex-col gap-6">
                
                {/* Profiles Table */}
                <div className="bg-slate-900 rounded-xl border border-slate-800 shadow-lg overflow-hidden flex-none">
                    <div className="px-6 py-4 border-b border-slate-800 flex justify-between items-center bg-slate-900/50">
                        <h2 className="text-lg font-semibold text-white flex items-center gap-2">
                            <CreditCard size={18} className="text-investec-500" />
                            Sync Profiles
                        </h2>
                        <button 
                            onClick={() => setView('settings')}
                            className="text-xs bg-slate-800 hover:bg-slate-700 px-3 py-1.5 rounded-lg text-slate-300 transition-colors"
                        >
                            Manage Profiles
                        </button>
                    </div>

                    <div className="overflow-x-auto">
                        <table className="w-full text-left text-sm text-slate-400">
                            <thead className="bg-slate-950/50 text-xs uppercase text-slate-500 font-semibold">
                                <tr>
                                    <th className="px-6 py-3">Status</th>
                                    <th className="px-6 py-3">Profile Name</th>
                                    <th className="px-6 py-3">Target</th>
                                    <th className="px-6 py-3">Schedule</th>
                                    <th className="px-6 py-3 text-right">Actions</th>
                                </tr>
                            </thead>
                            <tbody className="divide-y divide-slate-800/50">
                                {config.profiles && config.profiles.length > 0 ? (
                                    config.profiles.map(profile => {
                                        const isSyncing = processingProfiles.includes(profile.id);
                                        const isEnabled = profile.enabled !== false; // Default true if undefined
                                        return (
                                            <tr key={profile.id} className={`hover:bg-slate-800/30 transition-colors ${!isEnabled ? 'opacity-50 grayscale' : ''}`}>
                                                <td className="px-6 py-4 whitespace-nowrap">
                                                    {isSyncing ? (
                                                        <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-medium bg-blue-500/10 text-blue-400 border border-blue-500/20">
                                                            <div className="w-1.5 h-1.5 rounded-full bg-blue-500 animate-pulse" />
                                                            Syncing
                                                        </span>
                                                    ) : isEnabled ? (
                                                        <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-medium bg-emerald-500/10 text-emerald-400 border border-emerald-500/20">
                                                            <div className="w-1.5 h-1.5 rounded-full bg-emerald-500" />
                                                            Ready
                                                        </span>
                                                    ) : (
                                                        <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-medium bg-slate-500/10 text-slate-400 border border-slate-500/20">
                                                            <div className="w-1.5 h-1.5 rounded-full bg-slate-500" />
                                                            Disabled
                                                        </span>
                                                    )}
                                                </td>
                                                <td className="px-6 py-4 font-medium text-white">
                                                    {profile.name}
                                                </td>
                                                <td className="px-6 py-4 font-mono text-xs text-slate-500 truncate max-w-[200px]" title={profile.actualServerUrl}>
                                                    {profile.actualServerUrl}
                                                </td>
                                                <td className="px-6 py-4 font-mono text-xs">
                                                    {profile.syncSchedule || <span className="text-slate-600">Manual Only</span>}
                                                </td>
                                                <td className="px-6 py-4 text-right">
                                                    <div className="flex items-center justify-end gap-2">
                                                        <button
                                                            onClick={() => triggerSync(profile.id)}
                                                            disabled={!isEnabled || isSyncing || !isConnected}
                                                            className={`p-1.5 rounded-md transition-all ${
                                                                !isEnabled || isSyncing || !isConnected 
                                                                ? 'text-slate-600 cursor-not-allowed' 
                                                                : 'text-investec-500 hover:bg-investec-500/10 hover:text-yellow-400'
                                                            }`}
                                                            title="Run Sync Now"
                                                        >
                                                            <Play size={16} fill={isSyncing ? "none" : "currentColor"} />
                                                        </button>
                                                        
                                                        <button
                                                            onClick={() => toggleProfile(profile.id, !isEnabled)}
                                                            className={`p-1.5 rounded-md transition-all ${
                                                                isEnabled 
                                                                ? 'text-slate-400 hover:text-orange-400 hover:bg-orange-400/10' 
                                                                : 'text-slate-600 hover:text-green-400 hover:bg-green-400/10'
                                                            }`}
                                                            title={isEnabled ? "Disable Profile" : "Enable Profile"}
                                                        >
                                                            {isEnabled ? <PauseCircle size={16} /> : <Power size={16} />}
                                                        </button>

                                                        <button
                                                            onClick={() => deleteProfile(profile.id)}
                                                            className="p-1.5 rounded-md text-slate-500 hover:text-red-400 hover:bg-red-400/10 transition-all"
                                                            title="Delete Profile"
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
                                        <td colSpan={5} className="px-6 py-8 text-center text-slate-500 italic">
                                            No sync profiles found. Create one in Settings.
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
              <div className="xl:col-span-1 flex flex-col h-full min-h-[400px]">
                <div className="bg-slate-900 rounded-xl border border-slate-800 shadow-lg flex flex-col h-full overflow-hidden">
                    <div className="px-5 py-4 border-b border-slate-800 bg-slate-900/50 flex-none">
                         <h2 className="text-lg font-semibold text-white">Live Logs</h2>
                    </div>
                    <div className="flex-1 overflow-hidden p-0 relative">
                         <div className="absolute inset-0">
                            <LogConsole logs={logs} />
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
