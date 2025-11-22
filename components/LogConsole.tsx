import React, { useRef, useEffect } from 'react';
import { LogEntry } from '../types';

interface Props {
  logs: LogEntry[];
}

export const LogConsole: React.FC<Props> = ({ logs }) => {
  const bottomRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [logs]);

  return (
    <div className="bg-black border border-slate-800 rounded-lg font-mono text-xs h-64 overflow-y-auto p-4 shadow-inner shadow-black">
      {logs.length === 0 && <div className="text-slate-600 italic">Waiting for process start...</div>}
      {logs.map((log, idx) => (
        <div key={idx} className="mb-1 break-words">
          <span className="text-slate-500 mr-2">
            {new Date(log.timestamp).toLocaleTimeString()}
          </span>
          <span className={
            log.type === 'error' ? 'text-red-400 font-bold' :
            log.type === 'success' ? 'text-green-400' :
            'text-slate-300'
          }>
            {log.type === 'success' ? '✅ ' : log.type === 'error' ? '❌ ' : '> '}
            {log.message}
          </span>
        </div>
      ))}
      <div ref={bottomRef} />
    </div>
  );
};
