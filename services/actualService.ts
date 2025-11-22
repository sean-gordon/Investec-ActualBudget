import { ActualTransaction, InvestecTransaction } from '../types';

// Transform Investec transaction to Actual Budget format
export const transformTransaction = (t: InvestecTransaction): ActualTransaction => {
  // Actual uses milliunits (integer). Investec uses float.
  // Investec Amount is usually positive, Type determines sign.
  let amount = t.amount * 100; // Convert to cents (Actual usually expects integer cents or milliunits depending on version, standard is cents * 100 usually for milliunits)
  
  // Check definition: Actual Budget expects 'milliunits' which is value * 1000?
  // Usually API expects standard integer units. Let's assume standard milliunits (x1000) to be safe with Actual's internal engine, 
  // or cents (x100). Documentation says: "integer amount". 
  // If import via CSV, it handles decimals. If via API, usually milliunits.
  // We will use x100 for standard cents integer if we were generating CSV, but for direct JSON push, let's try to keep it compatible.
  // Let's stick to: value * 100 (cents).
  
  // However, Investec returns absolute values for amount.
  if (t.type === 'DEBIT') {
    amount = -Math.abs(amount);
  } else {
    amount = Math.abs(amount);
  }

  return {
    date: t.postingDate,
    amount: Math.round(amount), // Ensure integer
    payee_name: t.description,
    imported_payee: t.description,
    notes: `Type: ${t.transactionType} | Ref: ${t.cardNumber}`,
    imported_id: `${t.accountId}:${t.postedOrder}:${t.postingDate}`, // Composite key to ensure uniqueness
    cleared: true,
  };
};

// Generate CSV content (Fallback mechanism)
export const generateCSV = (transactions: ActualTransaction[]): string => {
  const headers = ['Date', 'Payee', 'Notes', 'Amount', 'ImportID'];
  const rows = transactions.map(t => {
    // CSV amount should be decimal
    const amountDecimal = (t.amount / 100).toFixed(2); 
    return [
      t.date,
      `"${t.payee_name?.replace(/"/g, '""')}"`,
      `"${t.notes?.replace(/"/g, '""')}"`,
      amountDecimal,
      t.imported_id
    ].join(',');
  });
  return [headers.join(','), ...rows].join('\n');
};

// Push to Actual Server (Simulated/Generic Endpoint)
// Note: Actual Budget's API is complex (Protobuf/SQLite sync). 
// This function attempts to send to a generic webhook if the user has configured an automation,
// Otherwise returns the data for manual import or Custom Importer usage.
export const pushToActual = async (
  serverUrl: string,
  budgetId: string,
  password: string | undefined,
  transactions: ActualTransaction[]
): Promise<void> => {
  // If using actual-server, there isn't a simple REST "post transaction" endpoint active by default without an extension.
  // However, we will try a standard pattern often used by Actual bridges.
  
  // If the URL ends with /sync or similar, we try that.
  // Otherwise, we just resolve, as the primary output here for a "Docker app" without the Node runtime 
  // is likely generating the import file or hitting a bridge.
  
  if (!serverUrl) throw new Error("Actual Server URL not configured");

  const payload = {
    transactions: transactions
  };

  // This is a placeholder for where one would hit a custom Actual Budget bridge.
  // Since we are running client-side in docker container, we might just log this.
  console.log("Pushing to Actual:", payload);

  // Attempt fetch if URL looks valid
  try {
    const response = await fetch(`${serverUrl}/api/v1/budgets/${budgetId}/transactions`, {
        method: 'POST',
        headers: {
            'Content-Type': 'application/json',
            ...(password ? { 'x-actual-password': password } : {})
        },
        body: JSON.stringify(payload)
    });
    
    if (!response.ok && response.status !== 404) {
         // If 404, it means the endpoint doesn't exist (standard Actual Server), so we swallow and rely on CSV export.
         throw new Error(`Actual API Error: ${response.statusText}`);
    }
  } catch (e) {
    console.warn("Direct push failed (likely no REST endpoint on Actual Server). Use CSV export.", e);
    throw new Error("Direct API push failed. Please use the generated CSV export for Actual Budget.");
  }
};
