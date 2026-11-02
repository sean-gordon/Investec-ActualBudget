import assert from 'node:assert/strict';
import test from 'node:test';
import { reconcilePendingTransactions } from '../transaction-sync.js';

const transaction = (order, overrides = {}) => ({
  date: '2026-10-30',
  amount: -12345,
  imported_payee: 'ONLINE_PAYMENT',
  imported_id: `bank-account:2026-10-30:ONLINEPAYMENT:${order}`,
  ...overrides
});

// Model Actual's strict imported_id matching: a different ID creates a new row.
const budget = (initial = []) => {
  const rows = structuredClone(initial);
  return {
    rows,
    getTransactions: async accountId => {
      assert.equal(accountId, 'actual-account');
      return structuredClone(rows);
    },
    updateTransaction: async (id, fields) => {
      const row = rows.find(t => t.id === id);
      assert.ok(row);
      Object.assign(row, fields);
    },
    importTransactions: async transactions => {
      for (const incoming of transactions) {
        if (!rows.some(t => t.imported_id === incoming.imported_id)) {
          rows.push({ id: `row-${rows.length}`, ...incoming });
        }
      }
    }
  };
};

const sync = async (actual, transactions) => {
  const updated = await reconcilePendingTransactions(actual, 'actual-account', transactions);
  await actual.importTransactions(transactions);
  return updated;
};

test('pending → posted → repeated sync keeps one row and preserves user edits', async () => {
  const actual = budget();
  await sync(actual, [transaction(0)]);
  Object.assign(actual.rows[0], {
    category: 'groceries', notes: 'My notes', payee: 'edited-payee',
    reconciled: true, subtransactions: [{ id: 'split', amount: -12345 }]
  });
  const original = structuredClone(actual.rows[0]);

  assert.equal(await sync(actual, [transaction(584)]), 1);
  assert.deepEqual(actual.rows, [{ ...original, imported_id: transaction(584).imported_id }]);
  assert.equal(await sync(actual, [transaction(584)]), 0);
  assert.equal(actual.rows.length, 1);
});

test('migrates a pending ID imported before the fix', async () => {
  const actual = budget([{ id: 'legacy', ...transaction(0) }]);
  assert.equal(await sync(actual, [transaction(584)]), 1);
  assert.equal(actual.rows.length, 1);
  assert.equal(actual.rows[0].id, 'legacy');
});

test('same date, payee and amount still allows separate posted payments', async () => {
  const actual = budget([{ id: 'pending', ...transaction(0) }]);
  assert.equal(await sync(actual, [transaction(584), transaction(585)]), 1);
  assert.equal(actual.rows.length, 2);
  assert.equal(new Set(actual.rows.map(t => t.imported_id)).size, 2);
  assert.equal(await sync(actual, [transaction(585), transaction(584)]), 0);
  assert.equal(actual.rows.length, 2);
});

test('existing posted IDs take priority over pending matches', async () => {
  const actual = budget([
    { id: 'pending', ...transaction(0) },
    { id: 'posted', ...transaction(584) }
  ]);
  assert.equal(await sync(actual, [transaction(584), transaction(585)]), 1);
  assert.equal(actual.rows.length, 2);
  assert.equal(actual.rows.find(t => t.id === 'pending').imported_id, transaction(585).imported_id);
});

test('does not match different amounts, debit/credit signs, payees, dates or accounts', async () => {
  for (const overrides of [
    { amount: -12346 },
    { amount: 12345 },
    { imported_payee: 'ONLINE PAYMENT' }, // Same sanitized description, different payee.
    { imported_id: 'bank-account:2026-10-31:ONLINEPAYMENT:584' },
    { imported_id: 'other-account:2026-10-30:ONLINEPAYMENT:584' }
  ]) {
    const actual = budget([{ id: 'pending', ...transaction(0) }]);
    assert.equal(await sync(actual, [transaction(584, overrides)]), 0);
    assert.equal(actual.rows.length, 2);
  }
});

test('pending-only and empty batches do not read or modify Actual transactions', async () => {
  const actual = {};
  assert.equal(await reconcilePendingTransactions(actual, 'actual-account', []), 0);
  assert.equal(await reconcilePendingTransactions(actual, 'actual-account', [transaction(0)]), 0);
});

test('failed promotion aborts rather than proceeding to a duplicate import', async () => {
  const actual = budget([{ id: 'pending', ...transaction(0) }]);
  actual.updateTransaction = async () => { throw new Error('write failed'); };
  await assert.rejects(sync(actual, [transaction(584)]), /write failed/);
  assert.equal(actual.rows.length, 1);
  assert.equal(actual.rows[0].imported_id, transaction(0).imported_id);
});
