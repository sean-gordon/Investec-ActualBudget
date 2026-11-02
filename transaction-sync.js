// Investec's postedOrder is 0 while pending and changes when the payment posts.
// Promote the existing Actual row to its posted ID before importing the batch.
// Keep posted IDs intact: separate payments can share a date, payee and amount.
export async function reconcilePendingTransactions(actual, accountId, transactions) {
  const posted = transactions.filter(t => /:[1-9]\d*$/.test(t.imported_id));
  if (posted.length === 0) return 0;

  const existing = await actual.getTransactions(accountId);
  const existingIds = new Set(existing.map(t => t.imported_id));
  const pendingById = new Map(
    existing.filter(t => t.imported_id?.endsWith(':0')).map(t => [t.imported_id, t])
  );
  let updated = 0;

  for (const transaction of posted) {
    if (existingIds.has(transaction.imported_id)) continue;

    const pendingId = transaction.imported_id.replace(/:\d+$/, ':0');
    const pending = pendingById.get(pendingId);
    if (!pending || pending.amount !== transaction.amount ||
        pending.imported_payee !== transaction.imported_payee) continue;

    // Change only the bank ID, preserving user edits, categories and splits.
    await actual.updateTransaction(pending.id, { imported_id: transaction.imported_id });
    pendingById.delete(pendingId);
    existingIds.add(transaction.imported_id);
    updated++;
  }

  return updated;
}
