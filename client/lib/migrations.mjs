import { readFile } from 'node:fs/promises';
import { join } from 'node:path';

// Session locks must be acquired, used and released on the SAME connection.
export async function runMigrations(pool, dir, files, log = console.log) {
  const client = await pool.connect();
  let locked = false;
  let failure;
  try {
    await client.query('select pg_advisory_lock(87236401)');
    locked = true;
    for (const file of files) {
      try {
        const sql = await readFile(join(dir, file), 'utf8');
        if (!sql.trim()) throw new Error('empty migration');
        await client.query('begin');
        try {
          await client.query(sql);
          await client.query('commit');
        } catch (error) {
          await client.query('rollback').catch(() => {});
          throw error;
        }
        log('migration ok:', file);
      } catch (error) {
        throw new Error(`migration ${file}: ${error.message}`, { cause: error });
      }
    }
  } catch (error) {
    failure = error;
    throw error;
  } finally {
    let cleanupError;
    if (locked) {
      try { await client.query('select pg_advisory_unlock(87236401)'); }
      catch (error) { cleanupError = error; }
    }
    // Discard failed connections: no transaction or session lock can leak to a pool borrower.
    client.release(failure || cleanupError ? true : undefined);
    if (cleanupError && !failure) throw cleanupError;
  }
}
