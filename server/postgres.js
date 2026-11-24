// PostgreSQL somente leitura: os agentes consultam o banco da empresa (pela VPN ou rede local),
// com credencial só de leitura. Mesmo assim, o IAORG se protege sozinho:
// - toda consulta roda numa transação READ ONLY, desfeita no fim (rollback);
// - um comando por vez (protocolo estendido: "select 1; delete …" é recusado pelo próprio Postgres);
// - tempo máximo por consulta e número máximo de linhas;
// - na conexão, recusa superusuário e usuário com permissão de gravar em alguma tabela.
import pg from 'pg';

const TIMEOUT_MS = 15000;
const MAX_ROWS = 200;
const MAX_CELL = 500;

/** Rótulo seguro da conexão (sem senha): usuario@host:porta/banco. */
export function describe(url) {
  let u;
  try { u = new URL(url); } catch { throw new Error('URL de conexão inválida. Formato: postgresql://usuario:senha@host:5432/banco'); }
  if (!/^postgres(ql)?:$/.test(u.protocol)) throw new Error('A URL precisa começar com postgresql://');
  if (!u.hostname) throw new Error('Informe o host do banco na URL.');
  const db = decodeURIComponent(u.pathname.replace(/^\//, '')) || 'postgres';
  return { user: decodeURIComponent(u.username), host: u.hostname, port: +u.port || 5432, database: db, label: `${decodeURIComponent(u.username) || '?'}@${u.hostname}:${+u.port || 5432}/${db}` };
}

const sslOf = (mode) => (mode === 'require' ? { rejectUnauthorized: false } : mode === 'verify' ? { rejectUnauthorized: true } : false);

async function withClient(url, ssl, fn) {
  describe(url);
  const c = new pg.Client({
    connectionString: url, ssl: sslOf(ssl), application_name: 'iaorg (somente leitura)',
    connectionTimeoutMillis: 10000, query_timeout: TIMEOUT_MS + 3000,
  });
  c.on('error', () => {});
  try { await c.connect(); }
  catch (e) {
    const m = e.code === 'ECONNREFUSED' || e.code === 'ETIMEDOUT' || e.code === 'EHOSTUNREACH' || /timeout/i.test(e.message)
      ? `não alcancei o banco (${e.code || e.message}). Confira se a VPN está ligada na máquina do IAORG e se o host/porta estão certos.`
      : e.code === 'ENOTFOUND' ? 'host não encontrado. Use o IP interno do banco na VPN (ou host.docker.internal para um banco na própria máquina).'
      : e.message;
    throw new Error(m);
  }
  try {
    await c.query('SET SESSION CHARACTERISTICS AS TRANSACTION READ ONLY');
    await c.query(`SET statement_timeout = ${TIMEOUT_MS}`);
    return await fn(c);
  } finally {
    c.end().catch(() => {});
  }
}

/** Valida a credencial: quem é, versão, schemas visíveis e se tem poder de gravar (o que é recusado). */
export async function verify(url, ssl) {
  return withClient(url, ssl, async (c) => {
    const who = (await c.query(`SELECT current_user AS u, current_database() AS d, current_setting('server_version') AS v,
      (SELECT rolsuper FROM pg_roles WHERE rolname = current_user) AS su`)).rows[0];
    const writable = (await c.query(`SELECT n.nspname || '.' || c.relname AS t FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
      WHERE c.relkind IN ('r', 'p', 'v', 'm', 'f') AND n.nspname NOT IN ('pg_catalog', 'information_schema') AND n.nspname NOT LIKE 'pg\\_%'
        AND (has_table_privilege(c.oid, 'INSERT') OR has_table_privilege(c.oid, 'UPDATE') OR has_table_privilege(c.oid, 'DELETE') OR has_table_privilege(c.oid, 'TRUNCATE'))
      LIMIT 5`)).rows.map((r) => r.t);
    const schemas = (await c.query(`SELECT nspname FROM pg_namespace WHERE nspname NOT IN ('information_schema') AND nspname NOT LIKE 'pg\\_%'
      AND has_schema_privilege(oid, 'USAGE') ORDER BY 1`)).rows.map((r) => r.nspname);
    return { user: who.u, database: who.d, version: who.v, superuser: !!who.su, writable, schemas };
  });
}

const cell = (v) => {
  if (v === null || v === undefined) return null;
  if (v instanceof Date) return v.toISOString();
  if (Buffer.isBuffer(v)) return `(binário, ${v.length} bytes)`;
  const s = typeof v === 'object' ? JSON.stringify(v) : v;
  return typeof s === 'string' && s.length > MAX_CELL ? `${s.slice(0, MAX_CELL)}… (${s.length} caracteres)` : s;
};

const READ = /^\s*(select|with|explain|show|table|values)\b/i;
const WRAP = /^\s*(select|with|table|values)\b/i;

/** Uma consulta de leitura, com no máximo `limit` linhas (até 200). */
export async function query(url, ssl, sql, limit = 100) {
  const q = String(sql || '').trim().replace(/;\s*$/, '');
  if (!q) throw new Error('Informe a consulta SQL.');
  if (!READ.test(q)) throw new Error('Só consultas de leitura: SELECT, WITH, EXPLAIN, SHOW, TABLE ou VALUES.');
  const n = Math.min(Math.max(Math.floor(+limit) || 100, 1), MAX_ROWS);
  // Embrulha para o banco parar em n+1 linhas (não traz a tabela inteira para a memória).
  const text = WRAP.test(q) ? `SELECT * FROM (\n${q}\n) AS _iaorg LIMIT ${n + 1}` : q;
  return withClient(url, ssl, async (c) => {
    await c.query('BEGIN READ ONLY');
    try {
      const started = Date.now();
      const r = await c.query({ text, rowMode: 'array', queryMode: 'extended' });
      const cols = r.fields.map((f) => f.name);
      const rows = r.rows.slice(0, n).map((row) => Object.fromEntries(cols.map((k, i) => [k, cell(row[i])])));
      return { columns: cols, rows, rowCount: rows.length, truncated: r.rows.length > n, ms: Date.now() - started };
    } finally {
      await c.query('ROLLBACK').catch(() => {});
    }
  });
}

/** Tabelas visíveis (com estimativa de linhas) ou as colunas de uma tabela. */
export async function schema(url, ssl, { schemas = [], table } = {}) {
  return withClient(url, ssl, async (c) => {
    if (table) {
      const [s, t] = String(table).includes('.') ? String(table).split('.', 2) : [null, String(table)];
      const cols = (await c.query(`SELECT table_schema, table_name, column_name, data_type, is_nullable = 'YES' AS nullable, column_default
        FROM information_schema.columns WHERE table_name = $1 AND ($2::text IS NULL OR table_schema = $2)
        ORDER BY table_schema, ordinal_position LIMIT 300`, [t, s])).rows;
      if (!cols.length) return { error: `Tabela ${table} não encontrada (ou sem permissão de leitura). Use db_schema sem table para ver as tabelas.` };
      return { table: `${cols[0].table_schema}.${cols[0].table_name}`, columns: cols.map(({ column_name, data_type, nullable, column_default }) => ({ column: column_name, type: data_type, nullable, default: column_default })) };
    }
    const rows = (await c.query(`SELECT t.table_schema AS schema, t.table_name AS name, t.table_type AS type, GREATEST(c.reltuples, 0)::bigint AS approx_rows
      FROM information_schema.tables t
      LEFT JOIN pg_namespace n ON n.nspname = t.table_schema
      LEFT JOIN pg_class c ON c.relnamespace = n.oid AND c.relname = t.table_name
      WHERE t.table_schema NOT IN ('pg_catalog', 'information_schema') AND t.table_schema NOT LIKE 'pg\\_%'
        AND (cardinality($1::text[]) = 0 OR t.table_schema = ANY($1))
      ORDER BY 1, 2 LIMIT 500`, [schemas])).rows;
    return { tables: rows.map((r) => ({ table: `${r.schema}.${r.name}`, type: r.type === 'VIEW' ? 'view' : 'tabela', approx_rows: +r.approx_rows })) };
  });
}
