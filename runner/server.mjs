// IAORG runner: cria um container isolado por tarefa (imagem iaorg-workbench), repassa os eventos
// ao app, faz a ponte das ferramentas (MCP) e recolhe entregas, memória e sessão ao fim.
// É o único serviço com acesso ao Docker; o app só fala com ele por HTTP autenticado.
import http from 'node:http';
import crypto from 'node:crypto';
import { PassThrough } from 'node:stream';
import Docker from 'dockerode';
import tar from 'tar-stream';

const PORT = +process.env.PORT || 7070;
const TOKEN = process.env.RUNNER_TOKEN || '';
const APP = (process.env.APP_INTERNAL_URL || 'http://iaorg:3000').replace(/\/$/, '');
const IMAGE = process.env.WORKBENCH_IMAGE || 'iaorg-workbench:latest';
const MAX_JOBS = +process.env.MAX_JOBS || 4;
const SELF = process.env.HOSTNAME; // id do próprio container (para entrar na rede de cada job)
const MAX_OUT_FILE = 5 * 1024 * 1024;
const MAX_OUT_TOTAL = 25 * 1024 * 1024;

if (!TOKEN || TOKEN.length < 16) { console.error('[runner] RUNNER_TOKEN ausente ou curto demais'); process.exit(1); }
const docker = new Docker({ socketPath: '/var/run/docker.sock' });
const jobs = new Map(); // id -> job

const safeEq = (a, b) => { const x = Buffer.from(String(a)); const y = Buffer.from(String(b)); return x.length === y.length && crypto.timingSafeEqual(x, y); };
const send = (res, code, obj) => { res.writeHead(code, { 'Content-Type': 'application/json' }); res.end(JSON.stringify(obj)); };
async function body(req, limit = 60 * 1024 * 1024) {
  const chunks = []; let n = 0;
  for await (const c of req) { n += c.length; if (n > limit) throw new Error('corpo grande demais'); chunks.push(c); }
  return n ? JSON.parse(Buffer.concat(chunks).toString('utf8')) : {};
}
async function toApp(path, payload) {
  for (let i = 0; i < 4; i++) {
    try {
      const r = await fetch(APP + path, { method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${TOKEN}` }, body: JSON.stringify(payload), signal: AbortSignal.timeout(120000) });
      return await r.json().catch(() => ({}));
    } catch (e) { if (i === 3) { console.error('[runner] app inacessível', path, e.message); return { error: 'IAORG indisponível' }; } await new Promise((r) => setTimeout(r, 1500 * (i + 1))); }
  }
}

async function ensureImage(image) {
  try { await docker.getImage(image).inspect(); return; } catch { /* baixa */ }
  const stream = await docker.pull(image);
  await new Promise((ok, fail) => docker.modem.followProgress(stream, (e) => (e ? fail(e) : ok())));
}

function packInput(files = [], session, jobJson) {
  const pack = tar.pack();
  // A tarefa (prompt, ficha, base de conhecimento) vai como arquivo: em variável de ambiente ela passa
  // do limite do Linux (128 KB por variável) e o container nem inicia ("argument list too long").
  if (jobJson) pack.entry({ name: 'in/job.json', mode: 0o600, uid: 1000, gid: 1000 }, Buffer.from(jobJson));
  const dirs = new Set(['entregas', 'in']);
  for (const f of files) { const parts = `entregas/${f.path}`.split('/'); for (let i = 1; i < parts.length; i++) dirs.add(parts.slice(0, i).join('/')); }
  for (const d of [...dirs].sort()) pack.entry({ name: d, type: 'directory', mode: 0o755, uid: 1000, gid: 1000 });
  for (const f of files) pack.entry({ name: `entregas/${f.path}`, mode: 0o644, uid: 1000, gid: 1000 }, Buffer.from(f.b64, 'base64'));
  if (session) pack.entry({ name: 'in/session.tgz', mode: 0o644, uid: 1000, gid: 1000 }, Buffer.from(session, 'base64'));
  pack.finalize();
  return pack;
}

async function readTar(container, path) {
  const out = [];
  out.truncated = false;
  let total = 0;
  try {
    const stream = await container.getArchive({ path });
    const ex = tar.extract();
    await new Promise((ok, fail) => {
      ex.on('entry', (h, s, next) => {
        const parts = [];
        s.on('data', (c) => { if (h.size <= MAX_OUT_FILE) parts.push(c); });
        s.on('end', () => {
          if (h.type === 'file' && h.size <= MAX_OUT_FILE && total + h.size <= MAX_OUT_TOTAL) { total += h.size; out.push({ name: h.name, data: Buffer.concat(parts) }); }
          else if (h.type === 'file') out.truncated = true;
          next();
        });
        s.resume();
      });
      ex.on('finish', ok); ex.on('error', fail);
      stream.pipe(ex);
    });
  } catch (e) { console.error('[runner] getArchive', path, e.message); out.truncated = true; }
  return out;
}

async function startSidecar(job, name, image, env) {
  await ensureImage(image);
  const c = await docker.createContainer({
    Image: image, Env: env, Labels: { 'iaorg.job': job.id },
    HostConfig: { NetworkMode: job.net, Memory: 768 * 1024 * 1024, NanoCpus: 1e9, PidsLimit: 256, SecurityOpt: ['no-new-privileges'] },
    NetworkingConfig: { EndpointsConfig: { [job.net]: { Aliases: [name] } } },
  });
  await c.start();
  job.sidecars.push(c);
}

async function runJob(job) {
  const s = job.spec;
  const flush = () => { if (job.buffer.length) { const events = job.buffer.splice(0); toApp(`/api/workbench/event/${job.id}`, { events }); } };
  job.flushTimer = setInterval(flush, 700);
  let exitCode = -1;
  let logTail = '';
  try {
    await ensureImage(IMAGE);
    job.net = `iaorg-job-${job.id}`;
    await docker.createNetwork({ Name: job.net, Driver: 'bridge', Labels: { 'iaorg.job': job.id } });
    await docker.getNetwork(job.net).connect({ Container: SELF, EndpointConfig: { Aliases: ['runner'] } });
    if (s.services?.postgres) await startSidecar(job, 'postgres', 'postgres:16-alpine', ['POSTGRES_USER=iaorg', 'POSTGRES_PASSWORD=iaorg', 'POSTGRES_DB=app']);
    if (s.services?.redis) await startSidecar(job, 'redis', 'redis:7-alpine', []);

    const jobJson = JSON.stringify(s.worker);
    const env = [
      'IAORG_JOB_FILE=/work/in/job.json',
      `IAORG_CB_URL=http://runner:${PORT}/cb/${job.id}`,
      `IAORG_JOB_TOKEN=${job.token}`,
      `ANTHROPIC_API_KEY=${s.secrets.anthropicKey}`,
      ...(s.secrets.githubToken ? [`GITHUB_TOKEN=${s.secrets.githubToken}`] : []),
    ];
    const lim = s.limits || {};
    job.container = await docker.createContainer({
      Image: IMAGE, Env: env, User: '1000:1000', WorkingDir: '/work', Labels: { 'iaorg.job': job.id, 'iaorg.company': String(s.companyId || '') },
      HostConfig: {
        NetworkMode: job.net, Memory: (lim.memoryMb || 2048) * 1024 * 1024, NanoCpus: (lim.cpus || 2) * 1e9, PidsLimit: 1024,
        CapDrop: ['ALL'], SecurityOpt: ['no-new-privileges'], ShmSize: 512 * 1024 * 1024, Init: true,
      },
    });
    await job.container.putArchive(packInput(s.files, s.session, jobJson), { path: '/work' });

    const stdout = new PassThrough();
    const stderr = new PassThrough();
    let pending = '';
    stdout.on('data', (c) => {
      pending += c.toString('utf8');
      let i;
      while ((i = pending.indexOf('\n')) >= 0) {
        const line = pending.slice(0, i); pending = pending.slice(i + 1);
        if (line.startsWith('@@IAORG ')) { try { job.buffer.push(JSON.parse(line.slice(8))); } catch { /* linha quebrada */ } }
        else logTail = (logTail + line + '\n').slice(-6000);
      }
    });
    stderr.on('data', (c) => { logTail = (logTail + c.toString('utf8')).slice(-6000); });
    const logs = await job.container.attach({ stream: true, stdout: true, stderr: true });
    docker.modem.demuxStream(logs, stdout, stderr);
    await job.container.start();
    job.timer = setTimeout(() => { job.timedOut = true; job.container.stop({ t: 20 }).catch(() => {}); }, (lim.timeoutMin || 45) * 60_000);
    const w = await job.container.wait();
    exitCode = w.StatusCode;
  } catch (e) {
    console.error('[runner] job', job.id, e);
    job.buffer.push({ ts: Date.now(), type: 'error', text: `Runner: ${e.message}` });
  } finally {
    clearTimeout(job.timer);
    clearInterval(job.flushTimer);
    flush();
  }

  // Recolhe saída e entregas
  const outFiles = job.container ? await readTar(job.container, '/work/out') : [];
  const entregas = job.container ? await readTar(job.container, '/work/entregas') : [];
  const pick = (n) => outFiles.find((f) => f.name === `out/${n}`)?.data;
  let result = null;
  try { result = JSON.parse(pick('result.json')?.toString('utf8') || 'null'); } catch { /* sem resultado */ }
  await toApp(`/api/workbench/end/${job.id}`, {
    exitCode, timedOut: !!job.timedOut, cancelled: !!job.cancelled, logTail, filesTruncated: !!entregas.truncated,
    result, memory: pick('MEMORY.md')?.toString('utf8') ?? null, session: pick('session.tgz')?.toString('base64') ?? null,
    files: entregas.filter((f) => f.name.startsWith('entregas/') && f.name.length > 9).map((f) => ({ path: f.name.slice(9), b64: f.data.toString('base64') })),
  });
  await cleanup(job);
}

async function cleanup(job) {
  for (const c of [job.container, ...job.sidecars].filter(Boolean)) await c.remove({ force: true }).catch(() => {});
  if (job.net) {
    await docker.getNetwork(job.net).disconnect({ Container: SELF, Force: true }).catch(() => {});
    await docker.getNetwork(job.net).remove().catch(() => {});
  }
  jobs.delete(job.id);
}

// Remove sobras de jobs anteriores (runner reiniciado no meio de uma tarefa).
async function sweep() {
  const cs = await docker.listContainers({ all: true, filters: { label: ['iaorg.job'] } }).catch(() => []);
  for (const c of cs) if (!jobs.has(c.Labels['iaorg.job'])) await docker.getContainer(c.Id).remove({ force: true }).catch(() => {});
  const ns = await docker.listNetworks({ filters: { label: ['iaorg.job'] } }).catch(() => []);
  for (const n of ns) if (!jobs.has(n.Labels?.['iaorg.job'])) {
    await docker.getNetwork(n.Id).disconnect({ Container: SELF, Force: true }).catch(() => {});
    await docker.getNetwork(n.Id).remove().catch(() => {});
  }
}

http.createServer(async (req, res) => {
  try {
    const url = new URL(req.url, 'http://x');
    if (url.pathname === '/health') return send(res, 200, { ok: true, jobs: jobs.size });

    // Ferramentas chamadas de dentro do container (token do job)
    const cb = url.pathname.match(/^\/cb\/([\w-]+)$/);
    if (cb && req.method === 'POST') {
      const job = jobs.get(cb[1]);
      if (!job || !safeEq(req.headers['x-job-token'] || '', job.token)) return send(res, 403, { error: 'job inválido' });
      return send(res, 200, await toApp(`/api/workbench/tool/${job.id}`, await body(req, 40 * 1024 * 1024)));
    }

    if (!safeEq(String(req.headers.authorization || ''), `Bearer ${TOKEN}`)) return send(res, 401, { error: 'não autorizado' });

    if (url.pathname === '/jobs' && req.method === 'POST') {
      const spec = await body(req);
      if (!spec.id || !/^[\w-]{4,64}$/.test(spec.id)) return send(res, 400, { error: 'id inválido' });
      if (jobs.has(spec.id)) return send(res, 409, { error: 'job já existe' });
      const running = [...jobs.values()];
      if (running.length >= MAX_JOBS) return send(res, 429, { error: 'fila cheia', running: running.length });
      if (spec.perCompanyMax && running.filter((j) => j.spec.companyId === spec.companyId).length >= spec.perCompanyMax) return send(res, 429, { error: 'limite da empresa' });
      const job = { id: spec.id, spec, token: crypto.randomBytes(24).toString('hex'), buffer: [], sidecars: [] };
      jobs.set(job.id, job);
      runJob(job);
      return send(res, 202, { ok: true });
    }
    const cancel = url.pathname.match(/^\/jobs\/([\w-]+)\/cancel$/);
    if (cancel && req.method === 'POST') {
      const job = jobs.get(cancel[1]);
      if (!job) return send(res, 404, { error: 'job não encontrado' });
      job.cancelled = true;
      await job.container?.stop({ t: 15 }).catch(() => {});
      return send(res, 200, { ok: true });
    }
    if (url.pathname === '/jobs' && req.method === 'GET') return send(res, 200, [...jobs.values()].map((j) => ({ id: j.id, companyId: j.spec.companyId })));
    send(res, 404, { error: 'rota desconhecida' });
  } catch (e) { send(res, 500, { error: e.message }); }
}).listen(PORT, () => { console.log(`[runner] ouvindo em :${PORT} (imagem ${IMAGE}, máx. ${MAX_JOBS} jobs)`); sweep(); });
