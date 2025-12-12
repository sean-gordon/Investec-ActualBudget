import React, { useEffect, useRef } from 'react';
import { LogEntry } from '../types';
import { Terminal, CheckCircle, AlertCircle, Info } from 'lucide-react';

interface LogConsoleProps {
  logs: LogEntry[];
}

export const LogConsole: React.FC<LogConsoleProps> = ({ logs }) => {
  const bottomRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [logs]);

  const getIcon = (type: LogEntry['type']) => {
    switch (type) {
      case 'success': return <CheckCircle size={14} className="text-green-500" />;
      case 'error': return <AlertCircle size={14} className="text-red-500" />;
      default: return <Info size={14} className="text-blue-500" />;
    }
  };

  const getTime = (ts: number) => {
    return new Date(ts).toLocaleTimeString();
  };

  return (
    <div className="bg-slate-950 rounded-lg border border-slate-800 overflow-hidden flex flex-col h-[500px]">
      <div className="flex items-center gap-2 px-4 py-2 bg-slate-900 border-b border-slate-800">
        <Terminal size={14} className="text-slate-400" />
        <span className="text-xs font-mono text-slate-400">System Output</span>
      </div>
      
      <div className="h-full overflow-y-auto p-4 space-y-2 font-mono text-xs bg-slate-950">
        {logs.length === 0 && (
          <div className="text-slate-600 italic text-center py-10">No logs available.</div>
        )}
        
        {logs.map((log, idx) => (
          <div key={idx} className="flex gap-3 hover:bg-slate-900/50 p-1 rounded transition-colors">
            <span className="text-slate-600 shrink-0 select-none">[{getTime(log.timestamp)}]</span>
            <div className="mt-0.5 shrink-0">{getIcon(log.type)}</div>
            <span className={`break-all ${
              log.type === 'error' ? 'text-red-400' : 
              log.type === 'success' ? 'text-green-400' : 'text-slate-300'
            }`}>
              {log.message}
            </span>
          </div>
        ))}
        <div ref={bottomRef} />
      </div>
    </div>
  );
};
