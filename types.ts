export interface AppConfig {
  investecClientId: string;
  investecSecretId: string;
  investecApiKey: string;
  actualServerUrl: string;
  actualPassword?: string;
  actualBudgetId: string;
  syncSchedule: string; // Cron expression
}

export interface LogEntry {
  timestamp: number;
  message: string;
  type: 'info' | 'error' | 'success';
}

// Investec Types
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
  type: 'DEBIT' | 'CREDIT';
  transactionType: string;
  status: string;
  description: string;
  cardNumber: string;
  postedOrder: number;
  postingDate: string; // YYYY-MM-DD
  valueDate: string;
  actionDate: string;
  transactionDate: string;
  amount: number;
  runningBalance: number;
}

// Actual Budget Types
export interface ActualTransaction {
  date: string; // YYYY-MM-DD
  amount: number; // integer, milliunits
  payee_name?: string;
  imported_payee?: string;
  notes?: string;
  imported_id: string; // Unique ID to prevent duplicates
  account?: string; // Account ID mapping if needed
  cleared?: boolean;
}