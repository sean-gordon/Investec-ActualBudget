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

export interface InvestecTokenResponse {
  access_token: string;
  token_type: string;
  expires_in: number;
  scope: string;
}

export interface InvestecAccount {
  accountId: string;
  accountNumber: string;
  accountName: string;
  referenceName: string;
  productName: string;
}

export interface InvestecTransaction {
  accountId: string;
  type: string;
  transactionType: string;
  status: string;
  description: string;
  cardNumber: string;
  postedOrder: number;
  postingDate: string;
  valueDate: string;
  actionDate: string;
  transactionDate: string;
  amount: number;
  runningBalance: number;
}

export interface ActualTransaction {
  date: string;
  amount: number;
  payee_name: string;
  imported_payee: string;
  notes: string;
  imported_id: string;
  cleared: boolean;
}
