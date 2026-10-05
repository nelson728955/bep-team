// Wipes the database so demo data reloads on the next start: npm run reset
// (Stop the server first; Windows cannot delete a database file that is open.)
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const dbPath = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'data', 'shifthub.db');
for (const suffix of ['', '-wal', '-shm']) fs.rmSync(dbPath + suffix, { force: true });
console.log('Database deleted. Run npm start to load fresh demo data.');
