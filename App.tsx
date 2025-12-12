import React, { useState, useEffect } from 'react';
import { Activity, Settings, Play, CreditCard, ExternalLink, Wifi, Clock, Download, Github, Plus, Trash2, Edit2 } from 'lucide-react';
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

  return (
    <div className="flex flex-col h-full bg-slate-950 text-slate-200">
      {/* Header */}
      <header className="flex items-center justify-between px-8 py-6 border-b border-slate-800 bg-slate-950/50 backdrop-blur-sm sticky top-0 z-10">
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
        <div className="max-w-6xl mx-auto">
          
          {view === 'settings' ? (
            <SettingsForm config={config} onSave={handleSaveSettings} />
          ) : (
            <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
              
              {/* Left Col: Profiles & Controls */}
              <div className="lg:col-span-1 space-y-6">
                
                {/* Profiles List */}
                {config.profiles && config.profiles.length > 0 ? (
                    config.profiles.map(profile => {
                        const isSyncing = processingProfiles.includes(profile.id);
                        return (
                            <div key={profile.id} className="bg-slate-900 p-6 rounded-xl border border-slate-800 shadow-lg relative overflow-hidden">
                                {isSyncing && (
                                    <div className="absolute top-0 left-0 w-full h-1 bg-investec-500 animate-loading-bar"></div>
                                )}
                                <div className="flex justify-between items-start mb-4">
                                    <h2 className="text-lg font-bold text-white flex items-center gap-2">
                                        <CreditCard size={18} className="text-investec-500" />
                                        {profile.name}
                                    </h2>
                                    {isSyncing && <span className="text-xs text-investec-400 animate-pulse font-mono">SYNCING...</span>}
                                </div>
                                
                                <p className="text-xs text-slate-500 mb-4 font-mono truncate">
                                    Target: {profile.actualServerUrl}
                                </p>

                                <button
                                    onClick={() => triggerSync(profile.id)}
                                    disabled={isSyncing || !isConnected}
                                    className={`w-full flex items-center justify-center gap-2 py-3 rounded-lg font-bold transition-all ${
                                    isSyncing || !isConnected
                                        ? 'bg-slate-800 text-slate-500 cursor-not-allowed' 
                                        : 'bg-investec-500 hover:bg-yellow-400 text-black shadow-lg shadow-yellow-900/20'
                                    }`}
                                >
                                    {isSyncing ? (
                                    <div className="animate-spin h-5 w-5 border-2 border-slate-500 border-t-transparent rounded-full" />
                                    ) : (
                                    <Play size={20} fill="currentColor" />
                                    )}
                                    <span>{isSyncing ? 'Syncing...' : 'Sync Now'}</span>
                                </button>
                                
                                <div className="mt-4 pt-4 border-t border-slate-800 flex justify-between text-xs text-slate-500">
                                    <span>Schedule: {profile.syncSchedule || 'None'}</span>
                                    {/* Placeholder for specific last sync time if we track it per profile later */}
                                </div>
                            </div>
                        );
                    })
                ) : (
                    <div className="bg-slate-900 p-8 rounded-xl border border-slate-800 text-center">
                        <p className="text-slate-400 mb-4">No sync profiles configured.</p>
                        <button 
                            onClick={() => setView('settings')}
                            className="bg-blue-600 text-white px-4 py-2 rounded-lg text-sm font-bold"
                        >
                            Create Profile
                        </button>
                    </div>
                )}

                {/* System Status */}
                <div className="bg-slate-900 p-6 rounded-xl border border-slate-800">
                   <h3 className="text-sm font-semibold text-slate-300 mb-2">System Status</h3>
                   <div className="flex items-center gap-3 mb-3">
                      <Wifi size={16} className={isConnected ? "text-green-500" : "text-red-500"} />
                      <span className="text-sm text-slate-400">
                        {isConnected ? 'Service Connected' : 'Service Disconnected'}
                      </span>
                   </div>
                   <div className="flex items-center gap-3 mb-3">
                      <div className={`w-3 h-3 rounded-full ${processingProfiles.length > 0 ? 'bg-blue-500 animate-pulse' : 'bg-slate-600'}`}></div>
                      <span className="text-sm text-slate-400">
                        Active Tasks: <span className="text-slate-200">{processingProfiles.length}</span>
                      </span>
                   </div>
                </div>
              </div>

              {/* Right Col: Logs & Output */}
              <div className="lg:col-span-2 flex flex-col gap-6">
                <div>
                  <h2 className="text-lg font-semibold text-white mb-4">Server Logs</h2>
                  <LogConsole logs={logs} />
                </div>
              </div>
            </div>
          )}
        </div>
      </main>
      
      <footer className="p-4 text-center text-xs text-slate-600">
        <a href="https://actualbudget.com" target="_blank" rel="noreferrer" className="hover:text-slate-400 inline-flex items-center gap-1">
          Powered by Actual Budget <ExternalLink size={10} />
        </a>
      </footer>
    </div>
  );
}