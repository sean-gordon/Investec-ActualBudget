import React, { useEffect, useState } from 'react';
import { AppConfig } from '../types';
import { Save, Eye, EyeOff, Clock } from 'lucide-react';

interface Props {
  config: AppConfig;
  onSave: (config: AppConfig) => void;
}

export const SettingsForm: React.FC<Props> = ({ config, onSave }) => {
  const [localConfig, setLocalConfig] = useState<AppConfig>(config);
  const [showSecrets, setShowSecrets] = useState(false);

  useEffect(() => {
    setLocalConfig(config);
  }, [config]);

  const handleChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const { name, value } = e.target;
    setLocalConfig(prev => ({ ...prev, [name]: value }));
  };

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    onSave(localConfig);
  };

  return (
    <form onSubmit={handleSubmit} className="bg-slate-900 p-6 rounded-lg border border-slate-800 shadow-xl max-w-2xl mx-auto">
      <div className="flex items-center justify-between mb-6">
        <h2 className="text-xl font-semibold text-slate-100">Configuration</h2>
        <button
          type="button"
          onClick={() => setShowSecrets(!showSecrets)}
          className="text-slate-400 hover:text-white transition-colors"
        >
          {showSecrets ? <EyeOff size={20} /> : <Eye size={20} />}
        </button>
      </div>

      <div className="space-y-4">
        <div className="p-3 bg-slate-800/50 rounded-md border border-slate-700/50 mb-4">
          <h3 className="text-investec-500 font-bold text-sm uppercase tracking-wider mb-2">Investec Credentials</h3>
          <div className="grid grid-cols-1 gap-4">
            <div>
              <label className="block text-xs text-slate-400 mb-1">Client ID</label>
              <input
                name="investecClientId"
                value={localConfig.investecClientId || ''}
                onChange={handleChange}
                type="text"
                className="w-full bg-slate-950 border border-slate-700 rounded px-3 py-2 text-sm focus:ring-1 focus:ring-investec-500 outline-none text-slate-200"
                placeholder="Client ID"
              />
            </div>
            <div>
              <label className="block text-xs text-slate-400 mb-1">Secret ID</label>
              <input
                name="investecSecretId"
                value={localConfig.investecSecretId || ''}
                onChange={handleChange}
                type={showSecrets ? "text" : "password"}
                className="w-full bg-slate-950 border border-slate-700 rounded px-3 py-2 text-sm focus:ring-1 focus:ring-investec-500 outline-none text-slate-200"
                placeholder="Secret"
              />
            </div>
            <div>
              <label className="block text-xs text-slate-400 mb-1">API Key</label>
              <input
                name="investecApiKey"
                value={localConfig.investecApiKey || ''}
                onChange={handleChange}
                type={showSecrets ? "text" : "password"}
                className="w-full bg-slate-950 border border-slate-700 rounded px-3 py-2 text-sm focus:ring-1 focus:ring-investec-500 outline-none text-slate-200"
                placeholder="API Key"
              />
            </div>
          </div>
        </div>

        <div className="p-3 bg-slate-800/50 rounded-md border border-slate-700/50">
          <h3 className="text-actual-500 font-bold text-sm uppercase tracking-wider mb-2">Actual Budget Settings</h3>
          <div className="grid grid-cols-1 gap-4">
             <div>
              <label className="block text-xs text-slate-400 mb-1">Server URL</label>
              <input
                name="actualServerUrl"
                value={localConfig.actualServerUrl || ''}
                onChange={handleChange}
                type="text"
                className="w-full bg-slate-950 border border-slate-700 rounded px-3 py-2 text-sm focus:ring-1 focus:ring-actual-500 outline-none text-slate-200"
                placeholder="http://host.docker.internal:5006"
              />
              <p className="text-[10px] text-slate-500 mt-1">
                <span className="text-yellow-500">Docker Note:</span> Use <code className="bg-slate-800 px-1 rounded text-slate-300">http://host.docker.internal:5006</code> to access host services.
              </p>
            </div>
             <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className="block text-xs text-slate-400 mb-1">Budget ID (Sync ID)</label>
                  <input
                    name="actualBudgetId"
                    value={localConfig.actualBudgetId || ''}
                    onChange={handleChange}
                    type="text"
                    className="w-full bg-slate-950 border border-slate-700 rounded px-3 py-2 text-sm focus:ring-1 focus:ring-actual-500 outline-none text-slate-200"
                    placeholder="uuid"
                  />
                </div>
                <div>
                  <label className="block text-xs text-slate-400 mb-1">Password (Optional)</label>
                  <input
                    name="actualPassword"
                    value={localConfig.actualPassword || ''}
                    onChange={handleChange}
                    type="password"
                    className="w-full bg-slate-950 border border-slate-700 rounded px-3 py-2 text-sm focus:ring-1 focus:ring-actual-500 outline-none text-slate-200"
                  />
                </div>
             </div>
          </div>
        </div>

        <div className="p-3 bg-slate-800/50 rounded-md border border-slate-700/50">
          <h3 className="text-slate-400 font-bold text-sm uppercase tracking-wider mb-2 flex items-center gap-2">
            <Clock size={14} /> Automation
          </h3>
          <div>
            <label className="block text-xs text-slate-400 mb-1">Cron Schedule (e.g., "0 0 * * *" for daily)</label>
            <input
              name="syncSchedule"
              value={localConfig.syncSchedule || ''}
              onChange={handleChange}
              type="text"
              className="w-full bg-slate-950 border border-slate-700 rounded px-3 py-2 text-sm focus:ring-1 focus:ring-slate-500 outline-none text-slate-200 font-mono"
              placeholder="0 0 * * *"
            />
            <p className="text-[10px] text-slate-500 mt-1">Standard Cron syntax. Leave empty to disable auto-sync.</p>
          </div>
        </div>
      </div>

      <div className="mt-6 flex justify-end">
        <button
          type="submit"
          className="flex items-center space-x-2 bg-slate-100 text-slate-900 px-6 py-2 rounded font-bold hover:bg-white transition-colors shadow-lg shadow-slate-900/50"
        >
          <Save size={18} />
          <span>Save Configuration</span>
        </button>
      </div>
    </form>
  );
};