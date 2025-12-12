import React, { useEffect, useRef } from 'react';
import { LogEntry } from '../types';

interface LogConsoleProps {
  logs?: LogEntry[];
  rawLogs?: string;
}

export const LogConsole: React.FC<LogConsoleProps> = ({ logs, rawLogs }) => {
  const containerRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (containerRef.current) {
        // Use scrollTop instead of scrollIntoView to prevent parent page scrolling
        const { scrollHeight, clientHeight } = containerRef.current;
        containerRef.current.scrollTop = scrollHeight - clientHeight;
    }
  }, [logs, rawLogs]);

  if (rawLogs) {
      return (
        <div 
            ref={containerRef}
            className="h-full overflow-y-auto p-4 font-mono text-xs bg-slate-950 scroll-smooth text-slate-300 whitespace-pre-wrap"
        >
            {rawLogs || <p className="text-slate-600 italic">No logs available.</p>}
        </div>
      );
  }

  return (
    <div 
        ref={containerRef}
        className="h-full overflow-y-auto p-4 space-y-2 font-mono text-xs bg-slate-950 scroll-smooth"
    >
      {(!logs || logs.length === 0) && <p className="text-slate-600 italic">Waiting for system logs...</p>}
      {logs?.map((log, i) => (
        <div key={i} className="flex gap-3 border-b border-slate-800/50 pb-1 last:border-0 animate-fade-in">
          <span className="text-slate-500 whitespace-nowrap flex-none">
            {new Date(log.timestamp).toLocaleTimeString([], { hour12: false })}
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