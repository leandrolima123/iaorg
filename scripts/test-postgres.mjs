// Teste da integração PostgreSQL (somente leitura) contra um banco descartável.
// Uso: PG_ADMIN_URL=postgresql://postgres:senha@host:5432/postgres node scripts/test-postgres.mjs
// Cria uma tabela de exemplo, um usuário só de leitura e um com escrita, e confere as proteções.
import pg from 'pg';
import * as pgdb from '../server/postgres.js';

const ADMIN = process.env.PG_ADMIN_URL;
if (!ADMIN) { console.error('Defina PG_ADMIN_URL (banco descartável, nunca o de produção).'); process.exit(2); }
const base = new URL(ADMIN);
const urlFor = (user, pass) => { const u = new URL(base); u.username = user; u.password = pass; return u.toString(); };

const admin = new pg.Client({ connectionString: ADMIN });
await admin.connect();
await admin.query(`DROP TABLE IF EXISTS public.pedidos; DROP ROLE IF EXISTS iaorg_leitor_t; DROP ROLE IF EXISTS iaorg_escritor_t;
  CREATE TABLE public.pedidos (id serial primary key, cliente text, total numeric(10,2), criado_em timestamptz default now());
  INSERT INTO public.pedidos (cliente, total) SELECT 'cliente ' || g, g * 1.5 FROM generate_series(1, 500) g;
  CREATE ROLE iaorg_leitor_t LOGIN PASSWORD 'leitor-teste'; GRANT pg_read_all_data TO iaorg_leitor_t;
  CREATE ROLE iaorg_escritor_t LOGIN PASSWORD 'escritor-teste'; GRANT SELECT, INSERT ON public.pedidos TO iaorg_escritor_t;`);
await admin.end();

const RO = urlFor('iaorg_leitor_t', 'leitor-teste');
let fail = 0;
const ok = (cond, msg) => { console.log(`${cond ? '✓' : '✗'} ${msg}`); if (!cond) fail++; };
const rejects = async (p, re, msg) => { try { await p; ok(false, `${msg} (não recusou)`); } catch (e) { ok(re.test(e.message), `${msg}: ${e.message}`); } };

const v = await pgdb.verify(RO, 'off');
ok(!v.superuser && v.writable.length === 0, `leitor: sem escrita (schemas: ${v.schemas.join(', ')})`);
const w = await pgdb.verify(urlFor('iaorg_escritor_t', 'escritor-teste'), 'off');
ok(w.writable.includes('public.pedidos'), 'escritor: detectado com escrita em public.pedidos');
const su = await pgdb.verify(ADMIN, 'off');
ok(su.superuser, 'admin: detectado como superusuário');

const s = await pgdb.schema(RO, 'off', {});
ok(s.tables.some((t) => t.table === 'public.pedidos'), 'db_schema lista public.pedidos');
const cols = await pgdb.schema(RO, 'off', { table: 'pedidos' });
ok(cols.columns?.length === 4, 'db_schema mostra as 4 colunas');

const q = await pgdb.query(RO, 'off', 'select count(*)::int as n, sum(total) as soma from pedidos');
ok(q.rows[0].n === 500, `agregação: ${JSON.stringify(q.rows[0])}`);
const big = await pgdb.query(RO, 'off', 'select * from pedidos order by id', 1000);
ok(big.rowCount === 200 && big.truncated, 'limite de 200 linhas com aviso de corte');
const cte = await pgdb.query(RO, 'off', 'with x as (select total from pedidos) select max(total) from x -- comentário no fim');
ok(cte.rowCount === 1, 'WITH com comentário no fim funciona');

await rejects(pgdb.query(RO, 'off', 'delete from pedidos'), /leitura/, 'DELETE recusado antes de ir ao banco');
await rejects(pgdb.query(RO, 'off', 'select 1; delete from pedidos'), /syntax|multiple commands/i, 'dois comandos recusados');
await rejects(pgdb.query(ADMIN, 'off', 'with d as (delete from pedidos returning *) select count(*) from d'), /data-modifying|read-only/i, 'DELETE dentro de WITH recusado (mesmo com superusuário)');
await rejects(pgdb.query(ADMIN, 'off', 'explain analyze delete from pedidos'), /read-only/i, 'EXPLAIN ANALYZE DELETE barrado pela transação read only (mesmo com superusuário)');
await rejects(pgdb.query(ADMIN, 'off', 'show x; drop table pedidos'), /multiple commands|syntax/i, 'comando extra depois de SHOW recusado');
await rejects(pgdb.query(RO, 'off', 'select pg_sleep(20)'), /timeout|cancel/i, 'consulta longa cancelada em 15 s');
await rejects(pgdb.verify('postgresql://x:y@10.255.255.1:5432/db', 'off'), /VPN|alcancei/i, 'host fora do alcance explica a VPN');

const after = await pgdb.query(RO, 'off', 'select count(*)::int as n from pedidos');
ok(after.rows[0].n === 500, 'nada foi apagado');
ok(!pgdb.describe(RO).label.includes('leitor-teste'), 'rótulo da conexão não mostra a senha');
console.log(fail ? `\n${fail} falha(s)` : '\nTudo certo.');
process.exit(fail ? 1 : 0);
