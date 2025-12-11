import React, { useState, useEffect } from 'react';
import { Save, Eye, EyeOff, RotateCcw, GitBranch } from 'lucide-react';
import { AppConfig, CategoryTree } from '../types';

interface SettingsFormProps {
  config: AppConfig;
  onSave: (cfg: AppConfig) => void;
}

export const SettingsForm: React.FC<SettingsFormProps> = ({ config, onSave }) => {
  const [formData, setFormData] = useState<AppConfig>(config);
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

  useEffect(() => {
    setFormData(config);
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

    fetch('/api/git/current')
        .then(res => res.json())
        .then(data => {
            setCurrentBranch(data.branch);
            setSelectedBranch(data.branch);
        })
        .catch(console.error);
  }, []);

  const handleChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const { name, value } = e.target;
    setFormData(prev => ({ ...prev, [name]: value }));
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
    if (!confirm(`Are you sure you want to switch to branch "${selectedBranch}"?\n\nThe server will rebuild and restart.`)) return;
    
    setIsSwitching(true);
    try {
        await fetch('/api/git/switch', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ branch: selectedBranch })
        });
        alert('Switch process started. Page will reload in 15 seconds.');
        setTimeout(() => window.location.reload(), 15000);
    } catch (e) {
        setIsSwitching(false);
        alert('Failed to switch branch.');
    }
  };

  return (
    <div className="space-y-8 animate-fade-in">

      {/* Git Branch Management */}
      <section className="bg-slate-900 p-6 rounded-xl border border-slate-800">
        <h2 className="text-xl font-bold text-white mb-4 flex items-center gap-2">
          <div className="w-1 h-6 bg-orange-500 rounded-full"></div>
          Git Repository Control
        </h2>
        <div className="grid grid-cols-1 md:grid-cols-2 gap-6 items-end">
            <div className="space-y-2">
                <label className="text-sm text-slate-400">Host Project Path (Required for Self-Update)</label>
                <input
                    type="text"
                    name="hostProjectRoot"
                    value={formData.hostProjectRoot || ''}
                    onChange={handleChange}
                    className="w-full bg-slate-950 border border-slate-700 rounded-lg px-4 py-2 focus:ring-2 focus:ring-orange-500 outline-none transition-all font-mono text-sm"
                    placeholder="e.g. /home/user/Investec-ActualBudget"
                />
                <p className="text-xs text-slate-500">
                    The absolute path to this folder on your server.
                </p>
            </div>
            <div className="space-y-2">
                <label className="text-sm text-slate-400">Target Branch</label>
                <div className="relative">
                    <select
                        value={selectedBranch}
                        onChange={(e) => setSelectedBranch(e.target.value)}
                        className="w-full bg-slate-950 border border-slate-700 rounded-lg px-4 py-2 focus:ring-2 focus:ring-orange-500 outline-none transition-all appearance-none"
                        disabled={isSwitching}
                    >
                        {branches.map(b => (
                            <option key={b} value={b}>{b}</option>
                        ))}
                    </select>
                    <GitBranch size={16} className="absolute right-3 top-3 text-slate-500 pointer-events-none" />
                </div>
                <p className="text-xs text-slate-500">
                    Current Branch: <span className="font-mono text-orange-400">{currentBranch}</span>
                </p>
            </div>
            <div>
                <button
                    onClick={handleBranchSwitch}
                    disabled={isSwitching || selectedBranch === currentBranch}
                    className={`flex items-center gap-2 px-6 py-2 rounded-lg font-bold transition-all ${
                        isSwitching || selectedBranch === currentBranch
                        ? 'bg-slate-800 text-slate-500 cursor-not-allowed'
                        : 'bg-orange-600 hover:bg-orange-500 text-white'
                    }`}
                >
                    <GitBranch size={18} />
                    {isSwitching ? 'Switching...' : 'Switch & Rebuild'}
                </button>
            </div>
        </div>
      </section>
      
      {/* Investec Section */}
      <section className="bg-slate-900 p-6 rounded-xl border border-slate-800">
        <h2 className="text-xl font-bold text-white mb-4 flex items-center gap-2">
          <div className="w-1 h-6 bg-investec-500 rounded-full"></div>
          Investec Configuration
        </h2>
        <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
          <div className="space-y-2">
            <label className="text-sm text-slate-400">Client ID</label>
            <input
              type="text"
              name="investecClientId"
              value={formData.investecClientId}
              onChange={handleChange}
              className="w-full bg-slate-950 border border-slate-700 rounded-lg px-4 py-2 focus:ring-2 focus:ring-investec-500 outline-none transition-all"
              placeholder="Iv1. ..."
            />
          </div>
          <div className="space-y-2">
            <label className="text-sm text-slate-400">Secret ID</label>
            <div className="relative">
              <input
                type={showPass ? "text" : "password"}
                name="investecSecretId"
                value={formData.investecSecretId}
                onChange={handleChange}
                className="w-full bg-slate-950 border border-slate-700 rounded-lg px-4 py-2 focus:ring-2 focus:ring-investec-500 outline-none transition-all"
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
            <label className="text-sm text-slate-400">API Key</label>
            <input
              type="password"
              name="investecApiKey"
              value={formData.investecApiKey}
              onChange={handleChange}
              className="w-full bg-slate-950 border border-slate-700 rounded-lg px-4 py-2 focus:ring-2 focus:ring-investec-500 outline-none transition-all font-mono text-sm"
              placeholder="Key from Programmable Banking..."
            />
          </div>
        </div>
      </section>

      {/* Actual Section */}
      <section className="bg-slate-900 p-6 rounded-xl border border-slate-800">
        <h2 className="text-xl font-bold text-white mb-4 flex items-center gap-2">
          <div className="w-1 h-6 bg-purple-500 rounded-full"></div>
          Actual Budget Configuration
        </h2>
        <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
          <div className="space-y-2">
            <label className="text-sm text-slate-400">Server URL</label>
            <input
              type="text"
              name="actualServerUrl"
              value={formData.actualServerUrl}
              onChange={handleChange}
              className="w-full bg-slate-950 border border-slate-700 rounded-lg px-4 py-2 focus:ring-2 focus:ring-purple-500 outline-none transition-all"
              placeholder="http://localhost:5006"
            />
          </div>
          <div className="space-y-2">
            <label className="text-sm text-slate-400">Budget Sync ID</label>
            <input
              type="text"
              name="actualBudgetId"
              value={formData.actualBudgetId}
              onChange={handleChange}
              className="w-full bg-slate-950 border border-slate-700 rounded-lg px-4 py-2 focus:ring-2 focus:ring-purple-500 outline-none transition-all"
            />
          </div>
          <div className="space-y-2 md:col-span-2">
            <label className="text-sm text-slate-400">Budget Password (Optional)</label>
            <input
              type="password"
              name="actualPassword"
              value={formData.actualPassword}
              onChange={handleChange}
              className="w-full bg-slate-950 border border-slate-700 rounded-lg px-4 py-2 focus:ring-2 focus:ring-purple-500 outline-none transition-all"
              placeholder="Required for E2E Encrypted files"
            />
          </div>
        </div>
      </section>

      {/* Categories Section */}
      <section className="bg-slate-900 p-6 rounded-xl border border-slate-800">
        <div className="flex justify-between items-center mb-4">
            <h2 className="text-xl font-bold text-white flex items-center gap-2">
                <div className="w-1 h-6 bg-blue-500 rounded-full"></div>
                Category Management
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

      {/* Schedule Section */}
      <section className="bg-slate-900 p-6 rounded-xl border border-slate-800">
        <h2 className="text-xl font-bold text-white mb-4 flex items-center gap-2">
          <div className="w-1 h-6 bg-green-500 rounded-full"></div>
          Automation
        </h2>
        <div className="space-y-2">
            <label className="text-sm text-slate-400">Cron Schedule</label>
            <div className="flex gap-2">
                <input
                    type="text"
                    name="syncSchedule"
                    value={formData.syncSchedule}
                    onChange={handleChange}
                    className="flex-1 bg-slate-950 border border-slate-700 rounded-lg px-4 py-2 focus:ring-2 focus:ring-green-500 outline-none transition-all font-mono"
                    placeholder="0 0 * * *"
                />
                <button 
                    onClick={() => setFormData(p => ({...p, syncSchedule: '0 0 * * *'}))}
                    className="px-3 py-2 bg-slate-800 hover:bg-slate-700 rounded-lg text-slate-300"
                    title="Daily at Midnight"
                >
                    <RotateCcw size={16} />
                </button>
            </div>
            <p className="text-xs text-slate-500">
                Format: <span className="font-mono">Minute Hour Day Month DayOfWeek</span>
            </p>
        </div>
      </section>

      {/* Save Button */}
      <div className="sticky bottom-6 flex justify-end">
        <button
            onClick={() => onSave(formData)}
            className="flex items-center gap-2 bg-investec-500 hover:bg-yellow-400 text-black px-8 py-3 rounded-xl font-bold shadow-lg shadow-yellow-900/20 transition-all transform hover:scale-105"
        >
            <Save size={20} />
            Save Configuration
        </button>
      </div>

    </div>
  );
};
