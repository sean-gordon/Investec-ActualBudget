import React, { useState, useEffect } from 'react';
import { Save, Eye, EyeOff, RotateCcw, GitBranch, Plus, Trash2, Copy } from 'lucide-react';
import { AppConfig, CategoryTree, SyncProfile } from '../types';
import { v4 as uuidv4 } from 'uuid';

interface SettingsFormProps {
  config: AppConfig;
  onSave: (cfg: AppConfig) => void;
}

const EMPTY_PROFILE: SyncProfile = {
    id: '',
    name: 'New Profile',
    investecClientId: '',
    investecSecretId: '',
    investecApiKey: '',
    actualServerUrl: '',
    actualPassword: '',
    actualBudgetId: '',
    syncSchedule: ''
};

export const SettingsForm: React.FC<SettingsFormProps> = ({ config, onSave }) => {
  const [profiles, setProfiles] = useState<SyncProfile[]>(config.profiles || []);
  const [selectedProfileId, setSelectedProfileId] = useState<string | null>(null);
  const [hostProjectRoot, setHostProjectRoot] = useState(config.hostProjectRoot || '');
  
  // UI States
  const [showPass, setShowPass] = useState(false);
  const [categories, setCategories] = useState<CategoryTree>({});
  const [jsonError, setJsonError] = useState<string | null>(null);
  const [jsonText, setJsonText] = useState('');
  const [isEditingCats, setIsEditingCats] = useState(false);
  
  // Git State
  const [branches, setBranches] = useState<string[]>([]);
  const [currentBranch, setCurrentBranch] = useState<string>('unknown');
  const [selectedBranch, setSelectedBranch] = useState<string>('');
  const [isSwitching, setIsSwitching] = useState(false);
  const [updateAvailable, setUpdateAvailable] = useState(false);

  useEffect(() => {
    setProfiles(config.profiles || []);
    setHostProjectRoot(config.hostProjectRoot || '');
    // Select first profile by default if none selected
    if (config.profiles && config.profiles.length > 0 && !selectedProfileId) {
        setSelectedProfileId(config.profiles[0].id);
    }
  }, [config]);

  useEffect(() => {
    // Fetch categories
    fetch('/api/categories')
      .then(res => res.json())
      .then(data => {
        setCategories(data);
        setJsonText(JSON.stringify(data, null, 2));
      })
      .catch(console.error);
      
    // Fetch Git Info
    fetch('/api/git/branches')
        .then(res => res.json())
        .then(data => {
            if (Array.isArray(data)) setBranches(data);
        })
        .catch(console.error);

    const checkGitStatus = () => {
        fetch('/api/git/status')
            .then(res => res.json())
            .then(data => {
                setCurrentBranch(data.branch);
                setSelectedBranch(prev => prev === '' || prev === data.branch ? data.branch : prev);
                setUpdateAvailable(data.updateAvailable);
            })
            .catch(console.error);
    };

    checkGitStatus();
    const interval = setInterval(checkGitStatus, 5 * 60 * 1000);
    return () => clearInterval(interval);
  }, []);

  const handleProfileChange = (field: keyof SyncProfile, value: string) => {
    if (!selectedProfileId) return;
    setProfiles(prev => prev.map(p => 
        p.id === selectedProfileId ? { ...p, [field]: value } : p
    ));
  };

  const handleAddProfile = () => {
    const newProfile = { ...EMPTY_PROFILE, id: uuidv4() };
    setProfiles(prev => [...prev, newProfile]);
    setSelectedProfileId(newProfile.id);
  };

  const handleDeleteProfile = (id: string) => {
    if (!confirm('Are you sure you want to delete this profile?')) return;
    const newProfiles = profiles.filter(p => p.id !== id);
    setProfiles(newProfiles);
    if (selectedProfileId === id) {
        setSelectedProfileId(newProfiles.length > 0 ? newProfiles[0].id : null);
    }
  };

  const handleDuplicateProfile = (id: string) => {
      const p = profiles.find(x => x.id === id);
      if (!p) return;
      const newProfile = { ...p, id: uuidv4(), name: `${p.name} (Copy)` };
      setProfiles(prev => [...prev, newProfile]);
      setSelectedProfileId(newProfile.id);
  };

  const handleSaveCategories = async () => {
    try {
      const parsed = JSON.parse(jsonText);
      await fetch('/api/categories', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(parsed)
      });
      setCategories(parsed);
      setIsEditingCats(false);
      setJsonError(null);
      alert('Categories saved!');
    } catch (e: any) {
      setJsonError(e.message);
    }
  };

  const handleBranchSwitch = async () => {
    if (!selectedBranch) return;
    let msg = `Are you sure you want to switch to branch "${selectedBranch}"?\n\nThe server will rebuild and restart.`;
    if (selectedBranch === currentBranch && updateAvailable) {
        msg = `Ready to upgrade branch "${selectedBranch}" to the latest version?\n\nThe server will pull changes and rebuild.`;
    }
    if (!confirm(msg)) return;
    setIsSwitching(true);
    try {
        await fetch('/api/git/switch', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ branch: selectedBranch })
        });
        alert('Process started. Page will reload in 15 seconds.');
        setTimeout(() => window.location.reload(), 15000);
    } catch (e) {
        setIsSwitching(false);
        alert('Failed to trigger git operation.');
    }
  };

  const selectedProfile = profiles.find(p => p.id === selectedProfileId);

  return (
    <div className="space-y-8 animate-fade-in pb-20">

      {/* Git / System Config */}
      <section className="bg-slate-900 p-6 rounded-xl border border-slate-800">
        <div className="flex justify-between items-center mb-4">
            <h2 className="text-xl font-bold text-white flex items-center gap-2">
                <div className="w-1 h-6 bg-orange-500 rounded-full"></div>
                System & Git Control
            </h2>
        </div>
        <div className="grid grid-cols-1 md:grid-cols-2 gap-6 items-end">
            <div className="space-y-2">
                <label className="text-sm text-slate-400">Host Project Path</label>
                <input
                    type="text"
                    value={hostProjectRoot}
                    onChange={(e) => setHostProjectRoot(e.target.value)}
                    className="w-full bg-slate-950 border border-slate-700 rounded-lg px-4 py-2 focus:ring-2 focus:ring-orange-500 outline-none transition-all font-mono text-sm"
                    placeholder="e.g. /home/user/Investec-ActualBudget"
                />
            </div>
            <div className="space-y-2">
                <label className="text-sm text-slate-400">Target Branch</label>
                <div className="flex gap-2">
                    <select
                        value={selectedBranch}
                        onChange={(e) => setSelectedBranch(e.target.value)}
                        className="flex-1 bg-slate-950 border border-slate-700 rounded-lg px-4 py-2 focus:ring-2 focus:ring-orange-500 outline-none transition-all"
                        disabled={isSwitching}
                    >
                        {branches.map(b => (
                            <option key={b} value={b}>{b}</option>
                        ))}
                    </select>
                    <button
                        onClick={handleBranchSwitch}
                        disabled={isSwitching || (selectedBranch === currentBranch && !updateAvailable)}
                        className={`px-4 py-2 rounded-lg font-bold transition-all text-sm whitespace-nowrap ${isSwitching || (selectedBranch === currentBranch && !updateAvailable) ? 'bg-slate-800 text-slate-500 cursor-not-allowed' : 'bg-orange-600 hover:bg-orange-500 text-white'}`}
                    >
                        {isSwitching ? '...' : 
                            selectedBranch === currentBranch && updateAvailable ? 'Upgrade' : 
                            'Switch'
                        }
                    </button>
                </div>
            </div>
        </div>
      </section>
      
      {/* PROFILE MANAGER */}
      <div className="grid grid-cols-1 lg:grid-cols-4 gap-6">
        
        {/* Profile List */}
        <div className="lg:col-span-1 space-y-4">
            <div className="flex justify-between items-center">
                <h3 className="text-lg font-bold text-white">Profiles</h3>
                <button onClick={handleAddProfile} className="p-2 bg-blue-600 hover:bg-blue-500 rounded-lg text-white transition-colors" title="Add Profile">
                    <Plus size={16} />
                </button>
            </div>
            <div className="space-y-2">
                {profiles.map(p => (
                    <div 
                        key={p.id}
                        onClick={() => setSelectedProfileId(p.id)}
                        className={`p-3 rounded-lg cursor-pointer border transition-all flex justify-between items-center group ${selectedProfileId === p.id ? 'bg-investec-900 border-investec-500 text-white' : 'bg-slate-900 border-slate-800 text-slate-400 hover:border-slate-600'}`}
                    >
                        <span className="truncate font-medium">{p.name}</span>
                        <div className="flex gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
                            <button 
                                onClick={(e) => { e.stopPropagation(); handleDuplicateProfile(p.id); }}
                                className="p-1 hover:text-blue-400" title="Duplicate"
                            >
                                <Copy size={14} />
                            </button>
                            <button 
                                onClick={(e) => { e.stopPropagation(); handleDeleteProfile(p.id); }}
                                className="p-1 hover:text-red-400" title="Delete"
                            >
                                <Trash2 size={14} />
                            </button>
                        </div>
                    </div>
                ))}
                {profiles.length === 0 && (
                    <p className="text-sm text-slate-500 italic">No profiles. Click + to add one.</p>
                )}
            </div>
        </div>

        {/* Profile Editor */}
        <div className="lg:col-span-3">
            {selectedProfile ? (
                <div className="space-y-6 bg-slate-900 p-6 rounded-xl border border-slate-800">
                    <div className="flex justify-between items-center border-b border-slate-800 pb-4">
                        <h2 className="text-xl font-bold text-white flex items-center gap-2">
                            <div className="w-1 h-6 bg-investec-500 rounded-full"></div>
                            Editing: {selectedProfile.name}
                        </h2>
                    </div>

                    <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                        <div className="space-y-2 md:col-span-2">
                            <label className="text-sm text-slate-400">Profile Name</label>
                            <input
                                type="text"
                                value={selectedProfile.name}
                                onChange={(e) => handleProfileChange('name', e.target.value)}
                                className="w-full bg-slate-950 border border-slate-700 rounded-lg px-4 py-2 focus:ring-2 focus:ring-investec-500 outline-none"
                            />
                        </div>

                        {/* Investec */}
                        <div className="space-y-2">
                            <label className="text-sm text-slate-400">Investec Client ID</label>
                            <input
                                type="text"
                                value={selectedProfile.investecClientId}
                                onChange={(e) => handleProfileChange('investecClientId', e.target.value)}
                                className="w-full bg-slate-950 border border-slate-700 rounded-lg px-4 py-2 focus:ring-2 focus:ring-investec-500 outline-none"
                            />
                        </div>
                        <div className="space-y-2">
                            <label className="text-sm text-slate-400">Investec Secret ID</label>
                            <div className="relative">
                                <input
                                    type={showPass ? "text" : "password"}
                                    value={selectedProfile.investecSecretId}
                                    onChange={(e) => handleProfileChange('investecSecretId', e.target.value)}
                                    className="w-full bg-slate-950 border border-slate-700 rounded-lg px-4 py-2 focus:ring-2 focus:ring-investec-500 outline-none"
                                />
                                <button
                                    type="button"
                                    onClick={() => setShowPass(!showPass)}
                                    className="absolute right-3 top-2.5 text-slate-500 hover:text-slate-300"
                                >
                                    {showPass ? <EyeOff size={16} /> : <Eye size={16} />}
                                </button>
                            </div>
                        </div>
                        <div className="space-y-2 md:col-span-2">
                            <label className="text-sm text-slate-400">Investec API Key</label>
                            <input
                                type="password"
                                value={selectedProfile.investecApiKey}
                                onChange={(e) => handleProfileChange('investecApiKey', e.target.value)}
                                className="w-full bg-slate-950 border border-slate-700 rounded-lg px-4 py-2 focus:ring-2 focus:ring-investec-500 outline-none font-mono text-sm"
                            />
                        </div>

                        {/* Actual */}
                        <div className="space-y-2">
                            <label className="text-sm text-slate-400">Actual Server URL</label>
                            <input
                                type="text"
                                value={selectedProfile.actualServerUrl}
                                onChange={(e) => handleProfileChange('actualServerUrl', e.target.value)}
                                className="w-full bg-slate-950 border border-slate-700 rounded-lg px-4 py-2 focus:ring-2 focus:ring-purple-500 outline-none"
                                placeholder="http://localhost:5006"
                            />
                        </div>
                        <div className="space-y-2">
                            <label className="text-sm text-slate-400">Budget Sync ID</label>
                            <input
                                type="text"
                                value={selectedProfile.actualBudgetId}
                                onChange={(e) => handleProfileChange('actualBudgetId', e.target.value)}
                                className="w-full bg-slate-950 border border-slate-700 rounded-lg px-4 py-2 focus:ring-2 focus:ring-purple-500 outline-none"
                            />
                        </div>
                        <div className="space-y-2 md:col-span-2">
                            <label className="text-sm text-slate-400">Budget Password (Optional)</label>
                            <input
                                type="password"
                                value={selectedProfile.actualPassword || ''}
                                onChange={(e) => handleProfileChange('actualPassword', e.target.value)}
                                className="w-full bg-slate-950 border border-slate-700 rounded-lg px-4 py-2 focus:ring-2 focus:ring-purple-500 outline-none"
                            />
                        </div>

                        {/* Schedule */}
                        <div className="space-y-2 md:col-span-2">
                            <label className="text-sm text-slate-400">Cron Schedule</label>
                            <div className="flex gap-2">
                                <input
                                    type="text"
                                    value={selectedProfile.syncSchedule}
                                    onChange={(e) => handleProfileChange('syncSchedule', e.target.value)}
                                    className="flex-1 bg-slate-950 border border-slate-700 rounded-lg px-4 py-2 focus:ring-2 focus:ring-green-500 outline-none font-mono"
                                    placeholder="0 0 * * *"
                                />
                                <button 
                                    onClick={() => handleProfileChange('syncSchedule', '0 0 * * *')}
                                    className="px-3 py-2 bg-slate-800 hover:bg-slate-700 rounded-lg text-slate-300"
                                    title="Daily at Midnight"
                                >
                                    <RotateCcw size={16} />
                                </button>
                            </div>
                        </div>
                    </div>
                </div>
            ) : (
                <div className="h-full flex items-center justify-center text-slate-500 bg-slate-900 rounded-xl border border-slate-800">
                    <p>Select a profile to edit or create a new one.</p>
                </div>
            )}
        </div>
      </div>

      {/* Global Categories (Collapsible?) */}
      <section className="bg-slate-900 p-6 rounded-xl border border-slate-800">
        <div className="flex justify-between items-center mb-4">
            <h2 className="text-xl font-bold text-white flex items-center gap-2">
                <div className="w-1 h-6 bg-blue-500 rounded-full"></div>
                Global Category Mapping
            </h2>
            <button
                onClick={() => setIsEditingCats(!isEditingCats)}
                className="text-sm bg-slate-800 hover:bg-slate-700 px-3 py-1 rounded text-slate-300 transition-colors"
            >
                {isEditingCats ? 'Cancel' : 'Edit JSON'}
            </button>
        </div>

        {isEditingCats ? (
            <div className="space-y-4">
                <textarea
                    value={jsonText}
                    onChange={(e) => setJsonText(e.target.value)}
                    className="w-full h-64 bg-slate-950 border border-slate-700 rounded-lg p-4 font-mono text-xs text-slate-300 focus:ring-2 focus:ring-blue-500 outline-none"
                />
                {jsonError && <p className="text-red-500 text-sm">{jsonError}</p>}
                <button
                    onClick={handleSaveCategories}
                    className="bg-blue-600 hover:bg-blue-500 text-white px-4 py-2 rounded-lg text-sm font-bold"
                >
                    Save Categories
                </button>
            </div>
        ) : (
            <div className="bg-slate-950 rounded-lg border border-slate-800 p-4 max-h-64 overflow-y-auto">
                <pre className="text-xs font-mono text-slate-400">
                    {JSON.stringify(categories, null, 2)}
                </pre>
            </div>
        )}
      </section>

      {/* Save Button */}
      <div className="sticky bottom-6 flex justify-end">
        <button
            onClick={() => onSave({ profiles, hostProjectRoot })}
            className="flex items-center gap-2 bg-investec-500 hover:bg-yellow-400 text-black px-8 py-3 rounded-xl font-bold shadow-lg shadow-yellow-900/20 transition-all transform hover:scale-105"
        >
            <Save size={20} />
            Save All Configurations
        </button>
      </div>

    </div>
  );
};