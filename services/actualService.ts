import { ActualTransaction, InvestecTransaction } from '../types';

// Transform Investec transaction to Actual Budget format
export const transformTransaction = (t: InvestecTransaction): ActualTransaction => {
  // Actual uses milliunits (integer). Investec uses float.
  let amount = t.amount * 100; 
  
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

// Push to Actual Server (Client-side logic removed)
// This is now handled entirely by the Backend (server.js) using @actual-app/api.
// This file remains for type definitions and potential client-side utils.
export const pushToActual = async (): Promise<void> => {
  console.warn("Client-side push is deprecated. Please use the Backend API.");
  throw new Error("Sync logic has moved to the backend server.");
};