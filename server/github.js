// Integração com GitHub via REST (token pessoal fine-grained da empresa).
// Os agentes leem código e entregam abrindo branch + Pull Request; nunca escrevem na branch padrão.
const API = 'https://api.github.com';

async function gh(token, method, path, body) {
  const res = await fetch(API + path, {
    method,
    headers: {
      Authorization: `Bearer ${token}`,
      Accept: 'application/vnd.github+json',
      'X-GitHub-Api-Version': '2022-11-28',
      'User-Agent': 'iaorg',
      ...(body ? { 'Content-Type': 'application/json' } : {}),
    },
    body: body ? JSON.stringify(body) : undefined,
  });
  const data = res.status === 204 ? null : await res.json().catch(() => null);
  if (!res.ok) throw new Error(`GitHub ${res.status}: ${data?.message || res.statusText}`);
  return data;
}

const enc = (p) => String(p || '').split('/').filter(Boolean).map(encodeURIComponent).join('/');

export async function whoami(token) {
  const u = await gh(token, 'GET', '/user');
  return { login: u.login, name: u.name };
}

export async function listRepos(token) {
  const repos = await gh(token, 'GET', '/user/repos?per_page=100&sort=updated&affiliation=owner,collaborator,organization_member');
  return repos.map((r) => ({ fullName: r.full_name, private: r.private, defaultBranch: r.default_branch, description: r.description || '' }));
}

export async function listFiles(token, repo, path = '') {
  const items = await gh(token, 'GET', `/repos/${repo}/contents/${enc(path)}`);
  if (!Array.isArray(items)) return [{ path: items.path, type: items.type, size: items.size }];
  return items.map((i) => ({ path: i.path, type: i.type === 'dir' ? 'dir' : 'file', size: i.size }));
}

export async function readFile(token, repo, path) {
  const f = await gh(token, 'GET', `/repos/${repo}/contents/${enc(path)}`);
  if (Array.isArray(f) || f.type !== 'file') throw new Error('Não é um arquivo');
  if (f.size > 200000) throw new Error('Arquivo grande demais para ler (> 200 KB)');
  return Buffer.from(f.content, 'base64').toString('utf8');
}

/** Histórico: commits recentes (opcional: arquivo/pasta, texto na mensagem) e PRs recentes. Só leitura. */
export async function history(token, repo, { path = '', search = '', limit = 30 } = {}) {
  const q = new URLSearchParams({ per_page: String(Math.min(100, Math.max(5, limit * (search ? 3 : 1)))) });
  if (path) q.set('path', path);
  const commits = await gh(token, 'GET', `/repos/${repo}/commits?${q}`);
  const s = String(search || '').toLowerCase();
  const list = commits
    .map((c) => ({ sha: c.sha.slice(0, 7), data: c.commit.author?.date, autor: c.commit.author?.name, mensagem: c.commit.message.split('\n')[0].slice(0, 160), url: c.html_url }))
    .filter((c) => !s || c.mensagem.toLowerCase().includes(s))
    .slice(0, limit);
  let pulls = [];
  try {
    pulls = (await gh(token, 'GET', `/repos/${repo}/pulls?state=all&sort=updated&direction=desc&per_page=20`))
      .filter((p) => !s || `${p.title} ${p.body || ''}`.toLowerCase().includes(s))
      .slice(0, 10)
      .map((p) => ({ numero: p.number, titulo: p.title, estado: p.merged_at ? 'mergeado' : p.state, criado: p.created_at, mergeado_em: p.merged_at, branch: p.head?.ref, url: p.html_url }));
  } catch { /* PRs são opcionais */ }
  return { commits: list, pull_requests: pulls };
}

export async function defaultBranch(token, repo) {
  return (await gh(token, 'GET', `/repos/${repo}`)).default_branch;
}

// ---------- oficina: PR a partir de uma branch já enviada pelo agente, CI e merge ----------
export async function openOrFindPull(token, repo, { head, base, title, body }) {
  const [owner] = repo.split('/');
  const open = await gh(token, 'GET', `/repos/${repo}/pulls?state=open&head=${encodeURIComponent(`${owner}:${head}`)}&per_page=1`);
  if (open?.[0]) return { url: open[0].html_url, number: open[0].number, existed: true };
  const pr = await gh(token, 'POST', `/repos/${repo}/pulls`, { title, body, head, base });
  return { url: pr.html_url, number: pr.number, existed: false };
}

export async function pullState(token, repo, number) {
  const p = await gh(token, 'GET', `/repos/${repo}/pulls/${number}`);
  return { merged: p.merged, state: p.state, mergeable: p.mergeable, mergeableState: p.mergeable_state, headSha: p.head.sha, url: p.html_url };
}

// Situação do CI no commit: combina "statuses" e "check runs". none = nenhum CI configurado.
export async function ciState(token, repo, sha) {
  const [st, runs] = await Promise.all([
    gh(token, 'GET', `/repos/${repo}/commits/${sha}/status`).catch(() => null),
    gh(token, 'GET', `/repos/${repo}/commits/${sha}/check-runs?per_page=100`).catch(() => null),
  ]);
  const items = [
    ...(st?.statuses || []).map((s) => ({ name: s.context, state: s.state === 'success' ? 'success' : s.state === 'pending' ? 'pending' : 'failure' })),
    ...(runs?.check_runs || []).map((r) => ({ name: r.name, state: r.status !== 'completed' ? 'pending' : ['success', 'neutral', 'skipped'].includes(r.conclusion) ? 'success' : 'failure' })),
  ];
  if (!items.length) return { state: 'none', items };
  if (items.some((i) => i.state === 'failure')) return { state: 'failure', items };
  if (items.some((i) => i.state === 'pending')) return { state: 'pending', items };
  return { state: 'success', items };
}

export async function mergePull(token, repo, number, { title, sha }) {
  try {
    const r = await gh(token, 'PUT', `/repos/${repo}/pulls/${number}/merge`, { merge_method: 'squash', commit_title: title, sha });
    return { merged: !!r?.merged, sha: r?.sha };
  } catch (e) { return { merged: false, error: e.message }; }
}

// Cria branch iaorg/<slug>, um commit com os arquivos e abre o PR. Devolve { url, number, branch }.
export async function openPullRequest(token, repo, { title, body, files, branchHint }) {
  if (!files?.length) throw new Error('Nenhum arquivo para o PR');
  const info = await gh(token, 'GET', `/repos/${repo}`);
  const base = info.default_branch;
  const ref = await gh(token, 'GET', `/repos/${repo}/git/ref/heads/${enc(base)}`);
  const baseSha = ref.object.sha;
  const baseCommit = await gh(token, 'GET', `/repos/${repo}/git/commits/${baseSha}`);

  const tree = await gh(token, 'POST', `/repos/${repo}/git/trees`, {
    base_tree: baseCommit.tree.sha,
    tree: files.map((f) => ({ path: String(f.path).replace(/^\/+/, ''), mode: '100644', type: 'blob', content: String(f.content ?? '') })),
  });
  const commit = await gh(token, 'POST', `/repos/${repo}/git/commits`, { message: title, tree: tree.sha, parents: [baseSha] });

  const slug = String(branchHint || title).toLowerCase().normalize('NFD').replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 40);
  const branch = `iaorg/${slug}-${Date.now().toString(36)}`;
  await gh(token, 'POST', `/repos/${repo}/git/refs`, { ref: `refs/heads/${branch}`, sha: commit.sha });
  const pr = await gh(token, 'POST', `/repos/${repo}/pulls`, { title, body: body || '', head: branch, base });
  return { url: pr.html_url, number: pr.number, branch };
}
