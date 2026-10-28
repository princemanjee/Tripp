import { readFileSync, existsSync, readdirSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import pg from 'pg';

export const SCHEMA_FILES = [
  'supabase/schema.sql',
  'supabase/audit.sql',
  'supabase/keys.sql',
  'supabase/media.sql',
  'supabase/retention.sql',
];

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');

function connect() {
  const password = process.env.TRIPP_DB_PASSWORD;
  if (!password) {
    console.error('TRIPP_DB_PASSWORD is not set. Set it in the environment and retry.');
    process.exit(2);
  }
  return new pg.Client({
    host: 'db.ohhkzjsdabdimlrgnagw.supabase.co',
    port: 5432,
    user: 'postgres',
    database: 'postgres',
    password,
    ssl: { rejectUnauthorized: false },
  });
}

async function runSchema(client) {
  for (const f of SCHEMA_FILES) {
    const p = resolve(root, f);
    if (!existsSync(p)) continue;
    await client.query(readFileSync(p, 'utf8'));
  }
}

async function test(pattern = '') {
  const dir = resolve(root, 'tests/sql');
  const files = existsSync(dir)
    ? readdirSync(dir).filter((f) => f.endsWith('.sql') && f.includes(pattern)).sort()
    : [];
  const client = connect();
  await client.connect();
  let failed = 0;
  try {
    for (const f of files) {
      try {
        await client.query('begin');
        await runSchema(client);
        await client.query(readFileSync(resolve(dir, f), 'utf8'));
        console.log(`PASS ${f}`);
      } catch (e) {
        failed++;
        console.log(`FAIL ${f}: ${e.message}`);
      } finally {
        await client.query('rollback');
      }
    }
  } finally {
    await client.end();
  }
  process.exit(failed ? 1 : 0);
}

async function apply() {
  const client = connect();
  await client.connect();
  try {
    await client.query('begin');
    await runSchema(client);
    await client.query('commit');
    console.log('APPLIED');
  } catch (e) {
    await client.query('rollback');
    console.error(`APPLY FAILED: ${e.message}`);
    process.exitCode = 1;
  } finally {
    await client.end();
  }
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const [mode, arg] = process.argv.slice(2);
  if (mode === 'test') await test(arg);
  else if (mode === 'apply') await apply();
  else {
    console.error('usage: node scripts/sql.mjs test [pattern] | apply');
    process.exit(2);
  }
}
