export interface SyncProfile {
  id: string;
  name: string;
  enabled: boolean;
  investecClientId: string;
  investecSecretId: string;
  investecApiKey: string;
  actualServerUrl: string;
  actualPassword?: string;
  actualBudgetId: string;
  actualAiContainer?: string;
  syncSchedule: string; // Cron expression
  categories?: CategoryTree;
}

export interface AppConfig {
  profiles: SyncProfile[];
  hostProjectRoot?: string; // Absolute path on the host machine
}

export interface CategoryTree {
  [groupName: string]: string[];
}

export interface LogEntry {
  timestamp: number;
  message: string;
  type: 'info' | 'error' | 'success';
  source?: 'System' | 'Actual AI';
}
