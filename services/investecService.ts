import { InvestecAccount, InvestecTokenResponse, InvestecTransaction } from '../types';

// Get Base URL from Runtime Env (Docker) or Build Env, or default to direct API
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const getBaseUrl = () => (window as any)._env_?.VITE_INVESTEC_BASE_URL || (import.meta as any).env?.VITE_INVESTEC_BASE_URL || 'https://openapi.investec.com';

// Helper to handle Fetch errors
const handleResponse = async (response: Response, context: string) => {
  if (!response.ok) {
    const text = await response.text();
    throw new Error(`${context} failed (${response.status}): ${text}`);
  }
  return response.json();
};

export const getInvestecToken = async (
  clientId: string,
  secretId: string,
  apiKey: string
): Promise<string> => {
  const authString = `${clientId}:${secretId}`;
  const base64Auth = btoa(authString);
  const baseUrl = getBaseUrl();

  const response = await fetch(`${baseUrl}/identity/v2/oauth2/token`, {
    method: 'POST',
    headers: {
      'Authorization': `Basic ${base64Auth}`,
      'x-api-key': apiKey,
      'Content-Type': 'application/x-www-form-urlencoded',
    },
    body: new URLSearchParams({ 'grant_type': 'client_credentials' }),
  });

  const data: InvestecTokenResponse = await handleResponse(response, 'Get Token');
  return data.access_token;
};

export const getAccountIds = async (token: string): Promise<string[]> => {
  const baseUrl = getBaseUrl();
  const response = await fetch(`${baseUrl}/za/pb/v1/accounts`, {
    headers: {
      'Authorization': `Bearer ${token}`,
      'Accept': 'application/json'
    },
  });

  const data = await handleResponse(response, 'Get Accounts');
  return data.data.accounts.map((acc: InvestecAccount) => acc.accountId);
};

export const getTransactionsForAccount = async (
  token: string,
  accountId: string,
  startDateStr: string,
  endDateStr: string
): Promise<InvestecTransaction[]> => {
  const baseUrl = getBaseUrl();
  const url = `${baseUrl}/za/pb/v1/accounts/${accountId}/transactions?fromDate=${startDateStr}&toDate=${endDateStr}`;
  
  const response = await fetch(url, {
    headers: {
      'Authorization': `Bearer ${token}`,
      'Accept': 'application/json'
    },
  });

  const data = await handleResponse(response, `Get Transactions (${accountId})`);
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const rawTransactions = data.data.transactions || [];
  
  // Enrich with accountId for later processing
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  return rawTransactions.map((t: any) => ({ ...t, accountId }));
};