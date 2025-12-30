import React, { useEffect, useRef } from 'react';
import { LogEntry } from '../types';

interface LogConsoleProps {
  logs: LogEntry[];
}

export const LogConsole: React.FC<LogConsoleProps> = ({ logs }) => {
  const containerRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (containerRef.current) {
        // Use scrollTop instead of scrollIntoView to prevent parent page scrolling
        const { scrollHeight, clientHeight } = containerRef.current;
        containerRef.current.scrollTop = scrollHeight - clientHeight;
    }
  }, [logs]);

  return (
    <div 
        ref={containerRef}
        className="h-full overflow-y-auto p-4 space-y-1 font-mono text-xs bg-slate-950 scroll-smooth"
    >
      {(!logs || logs.length === 0) && <p className="text-slate-600 italic">Waiting for system logs...</p>}
      {logs?.map((log, i) => (
        <div key={i} className="flex gap-2 border-b border-slate-800/30 pb-1 last:border-0 hover:bg-white/5 transition-colors">
          <span className="text-slate-600 whitespace-nowrap flex-none w-[70px] text-right opacity-70">
            {new Date(log.timestamp).toLocaleTimeString([], { hour12: false, hour: '2-digit', minute:'2-digit', second:'2-digit' })}
          </span>
          
          <span className={`flex-none px-1.5 rounded text-[10px] font-bold uppercase tracking-wider py-0.5 h-fit mt-0.5 ${
              log.source === 'Actual AI' 
              ? 'bg-purple-500/20 text-purple-400' 
              : 'bg-blue-500/20 text-blue-400'
          }`}>
            {log.source === 'Actual AI' ? 'AI' : 'SYS'}
          </span>

          <span className={`break-all ${
            log.type === 'error' ? 'text-red-400 font-bold' : 
            log.type === 'success' ? 'text-green-400' : 'text-slate-300'
          }`}>
            {log.message}
          </span>
        </div>
      ))}
    </div>
  );
};