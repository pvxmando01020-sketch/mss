import pg from 'pg';

let poolInstance: pg.Pool | undefined;

export function getPool(databaseUrl: string): pg.Pool {
  if (!poolInstance) {
    poolInstance = new pg.Pool({ connectionString: databaseUrl, max: 10 });
    poolInstance.on('error', (err) => {
      console.error('[pg] idle client error:', err.message);
    });
  }
  return poolInstance;
}

export async function closePool(): Promise<void> {
  if (poolInstance) {
    await poolInstance.end();
    poolInstance = undefined;
  }
}
