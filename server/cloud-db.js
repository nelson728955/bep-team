import { Worker } from 'node:worker_threads';

// Preserve the application's synchronous database interface. Network requests
// run in a worker; a timeout stops this connection to avoid retrying a write
// whose outcome is unknown.
export function cloudDatabase(url, authToken) {
  const worker = new Worker(new URL('./cloud-db-worker.js', import.meta.url), {
    workerData: { url, authToken },
    execArgv: process.execArgv.filter(arg => !arg.startsWith('--input-type')),
  });
  worker.unref();
  worker.on('error', error => { stopped = true; console.error('Database worker failed:', error.message); });
  let stopped = false;
  // Calls are synchronous and serialized, so one bounded response buffer can
  // serve every request instead of allocating 16 MB for every SQL statement.
  const shared = new SharedArrayBuffer(16 * 1024 * 1024);
  const state = new Int32Array(shared, 0, 2);
  function call(operation, sql, args = []) {
    if (stopped) throw new Error('Cloud database connection stopped. Restart the service.');
    Atomics.store(state, 0, 0);
    Atomics.store(state, 1, 0);
    worker.postMessage({ operation, sql, args, shared });
    if (Atomics.wait(state, 0, 0, 30000) === 'timed-out') {
      stopped = true;
      worker.terminate();
      throw new Error('Cloud database request timed out. Restart the service before retrying.');
    }
    const result = JSON.parse(new TextDecoder().decode(new Uint8Array(shared, 8, state[1])));
    if (result.error) throw new Error(result.error);
    return result.value;
  }
  return {
    exec(sql) { call('exec', sql); },
    prepare(sql) {
      return {
        all(...args) { return call('query', sql, args).rows; },
        get(...args) { return call('query', sql, args).rows[0]; },
        run(...args) { const r = call('query', sql, args); return { changes: r.changes, lastInsertRowid: r.lastInsertRowid }; },
      };
    },
    close() { stopped = true; worker.terminate(); },
  };
}
