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

const TXN_CONTROL = /(^|;)\s*(commit|rollback|abort|start\s+transaction|prepare\s+transaction)\b/im;

class TxnEnded extends Error {}

async function xid(client) {
  return (await client.query('select pg_current_xact_id()::text as x')).rows[0].x;
}

async function runChecked(client, name, sql, id) {
  await client.query(sql);
  if ((await xid(client)) !== id) throw new TxnEnded('transaction ended inside file');
}

async function runSchema(client, id) {
  for (const f of SCHEMA_FILES) {
    const p = resolve(root, f);
    if (!existsSync(p)) continue;
    await runChecked(client, f, readFileSync(p, 'utf8'), id);
  }
}

async function test(pattern = '') {
  const dir = resolve(root, 'tests/sql');
  const files = existsSync(dir)
    ? readdirSync(dir).filter((f) => f.endsWith('.sql') && f.includes(pattern)).sort()
    : [];
  if (files.length === 0) {
    console.log(`FAIL no tests matched ${pattern}`);
    process.exit(1);
  }
  const client = connect();
  await client.connect();
  let failed = 0;
  try {
    for (const f of files) {
      const sql = readFileSync(resolve(dir, f), 'utf8');
      if (TXN_CONTROL.test(sql)) {
        failed++;
        console.log(`FAIL ${f}: transaction-control statement in test file (not sent)`);
        continue;
      }
      let stop = false;
      try {
        await client.query('begin');
        const id = await xid(client);
        await runSchema(client, id);
        await runChecked(client, f, sql, id);
        console.log(`PASS ${f}`);
      } catch (e) {
        failed++;
        console.log(`FAIL ${f}: ${e.message}`);
        if (e instanceof TxnEnded) stop = true;
      } finally {
        try {
          await client.query('rollback');
        } catch (e) {
          console.log(`FAIL ${f}: rollback failed: ${e.message}`);
          stop = true;
          failed++;
        }
      }
      if (stop) break;
    }
  } finally {
    await client.end().catch(() => {});
  }
  process.exit(failed ? 1 : 0);
}

async function apply() {
  const client = connect();
  await client.connect();
  try {
    await client.query('begin');
    await runSchema(client, await xid(client));
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
