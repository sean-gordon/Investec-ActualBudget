import React, { useEffect, useState } from 'react';
import { AppConfig } from '../types';
import { Save, Eye, EyeOff, Clock, CheckCircle, AlertCircle, Loader2 } from 'lucide-react';

interface Props {
  config: AppConfig;
  onSave: (config: AppConfig) => void;
}

export const SettingsForm: React.FC<Props> = ({ config, onSave }) => {
  const [localConfig, setLocalConfig] = useState<AppConfig>(config);
  const [showSecrets, setShowSecrets] = useState(false);
  
  // Test States
  const [testingInvestec, setTestingInvestec] = useState(false);
  const [investecResult, setInvestecResult] = useState<{success: boolean, msg: string} | null>(null);
  
  const [testingActual, setTestingActual] = useState(false);
  const [actualResult, setActualResult] = useState<{success: boolean, msg: string} | null>(null);

  useEffect(() => {
    setLocalConfig(config);
  }, [config]);

  const handleChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const { name, value } = e.target;
    setLocalConfig(prev => ({ ...prev, [name]: value }));
    // Clear test results when typing
    if (name.startsWith('investec')) setInvestecResult(null);
    if (name.startsWith('actual')) setActualResult(null);
  };

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    onSave(localConfig);
  };

  const testInvestec = async () => {
    setTestingInvestec(true);
    setInvestecResult(null);
    try {
        const res = await fetch('/api/test/investec', {
            method: 'POST',
            headers: {'Content-Type': 'application/json'},
            body: JSON.stringify({
                clientId: localConfig.investecClientId,
                secretId: localConfig.investecSecretId,
                apiKey: localConfig.investecApiKey
            })
        });
        const data = await res.json();
        setInvestecResult({ success: data.success, msg: data.message });
    } catch (e) {
        setInvestecResult({ success: false, msg: "Network Error" });
    } finally {
        setTestingInvestec(false);
    }
  };

  const testActual = async () => {
    setTestingActual(true);
    setActualResult(null);
    try {
        const res = await fetch('/api/test/actual', {
            method: 'POST',
            headers: {'Content-Type': 'application/json'},
            body: JSON.stringify({
                serverUrl: localConfig.actualServerUrl,
                budgetId: localConfig.actualBudgetId,
                password: localConfig.actualPassword
            })
        });
        const data = await res.json();
        setActualResult({ success: data.success, msg: data.message });
    } catch (e) {
        setActualResult({ success: false, msg: "Network Error" });
    } finally {
        setTestingActual(false);
    }
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
        {/* INVESTEC SECTION */}
        <div className="p-3 bg-slate-800/50 rounded-md border border-slate-700/50 mb-4">
          <div className="flex justify-between items-center mb-2">
            <h3 className="text-investec-500 font-bold text-sm uppercase tracking-wider">Investec Credentials</h3>
            <button 
                type="button" 
                onClick={testInvestec} 
                disabled={testingInvestec || !localConfig.investecClientId}
                className="text-xs bg-slate-700 hover:bg-slate-600 px-2 py-1 rounded text-white flex items-center gap-1 disabled:opacity-50"
            >
                {testingInvestec && <Loader2 size={10} className="animate-spin"/>}
                Test Investec
            </button>
          </div>
          
          {investecResult && (
             <div className={`text-xs p-2 rounded mb-2 flex items-start gap-2 ${investecResult.success ? 'bg-green-900/30 text-green-400' : 'bg-red-900/30 text-red-400'}`}>
                {investecResult.success ? <CheckCircle size={14} className="mt-0.5"/> : <AlertCircle size={14} className="mt-0.5"/>}
                {investecResult.msg}
             </div>
          )}

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

        {/* ACTUAL SECTION */}
        <div className="p-3 bg-slate-800/50 rounded-md border border-slate-700/50">
          <div className="flex justify-between items-center mb-2">
            <h3 className="text-actual-500 font-bold text-sm uppercase tracking-wider">Actual Budget Settings</h3>
             <button 
                type="button" 
                onClick={testActual} 
                disabled={testingActual || !localConfig.actualServerUrl}
                className="text-xs bg-slate-700 hover:bg-slate-600 px-2 py-1 rounded text-white flex items-center gap-1 disabled:opacity-50"
            >
                {testingActual && <Loader2 size={10} className="animate-spin"/>}
                Test Connection
            </button>
          </div>

          {actualResult && (
             <div className={`text-xs p-2 rounded mb-2 flex items-start gap-2 ${actualResult.success ? 'bg-green-900/30 text-green-400' : 'bg-red-900/30 text-red-400'}`}>
                {actualResult.success ? <CheckCircle size={14} className="mt-0.5"/> : <AlertCircle size={14} className="mt-0.5"/>}
                {actualResult.msg}
             </div>
          )}

          <div className="grid grid-cols-1 gap-4">
             <div>
              <label className="block text-xs text-slate-400 mb-1">Server URL</label>
              <input
                name="actualServerUrl"
                value={localConfig.actualServerUrl || ''}
                onChange={handleChange}
                type="text"
                className="w-full bg-slate-950 border border-slate-700 rounded px-3 py-2 text-sm focus:ring-1 focus:ring-actual-500 outline-none text-slate-200"
                placeholder="http://127.0.0.1:5006"
              />
              <p className="text-[10px] text-slate-500 mt-1">
                <span className="text-yellow-500">Host Mode:</span> Use <code className="bg-slate-800 px-1 rounded text-slate-300">http://127.0.0.1:5006</code> or <code className="bg-slate-800 px-1 rounded text-slate-300">http://localhost:5006</code> since the container shares the host network.
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

        {/* AUTOMATION */}
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