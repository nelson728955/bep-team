import { parentPort, workerData } from 'node:worker_threads';
import { createClient } from '@libsql/client';

let client;
let initializationError;
try { client = createClient({ ...workerData, intMode: 'number' }); }
catch (error) { initializationError = error; }
let transaction;
parentPort.on('message', async ({ operation, sql, args, shared }) => {
  const state = new Int32Array(shared, 0, 2);
  let response;
  try {
    if (initializationError) throw initializationError;
    if (operation === 'exec') {
      const command = sql.trim().replace(/;$/, '').toUpperCase();
      if (command === 'BEGIN') {
        if (transaction) throw new Error('Nested transaction');
        transaction = await client.transaction('write');
      } else if (command === 'COMMIT' || command === 'ROLLBACK') {
        if (!transaction) throw new Error('No active transaction');
        const active = transaction;
        transaction = undefined;
        if (command === 'COMMIT') await active.commit();
        else await active.rollback();
      } else await (transaction || client).executeMultiple(sql);
      response = { value: null };
    } else {
      const r = await (transaction || client).execute({ sql, args });
      response = { value: {
        rows: r.rows.map(row => Object.fromEntries(r.columns.map((column, i) => [column, row[i]]))),
        changes: r.rowsAffected,
        lastInsertRowid: r.lastInsertRowid == null ? 0 : Number(r.lastInsertRowid),
      } };
    }
  } catch (error) {
    response = { error: `Database request failed (${error.code || 'DATABASE_ERROR'}).` };
  }
  let bytes = new TextEncoder().encode(JSON.stringify(response));
  if (bytes.length > shared.byteLength - 8) bytes = new TextEncoder().encode(JSON.stringify({ error: 'Database response is too large.' }));
  new Uint8Array(shared, 8, bytes.length).set(bytes);
  Atomics.store(state, 1, bytes.length);
  Atomics.store(state, 0, 1);
  Atomics.notify(state, 0);
});
