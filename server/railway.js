// Railway: API pública GraphQL (https://docs.railway.com/reference/public-api).
// - Token de conta ou de workspace: Authorization: Bearer <token>
// - Token de projeto (rlwy_proj_…, criado em Project Settings → Tokens): Project-Access-Token: <token>
const API = 'https://backboard.railway.com/graphql/v2';
const kinds = new Map(); // token -> 'bearer' | 'project' (descoberto na primeira chamada)

const headersFor = (token, kind) => (kind === 'project' ? { 'Project-Access-Token': token } : { Authorization: `Bearer ${token}` });

async function rawGql(token, kind, query, variables) {
  const res = await fetch(API, {
    method: 'POST',
    headers: { ...headersFor(token, kind), 'Content-Type': 'application/json' },
    body: JSON.stringify({ query, variables }),
  });
  const data = await res.json().catch(() => null);
  if (!res.ok || data?.errors?.length) throw new Error(`Railway: ${data?.errors?.[0]?.message || res.statusText}`);
  return data.data;
}

export const tokenKind = (token) => kinds.get(token) || (/^rlwy_proj_/.test(token) ? 'project' : 'bearer');

async function gql(token, query, variables = {}) {
  const kind = tokenKind(token);
  try {
    const d = await rawGql(token, kind, query, variables);
    kinds.set(token, kind);
    return d;
  } catch (e) {
    // Token sem prefixo conhecido: tenta o outro tipo antes de desistir.
    if (kinds.has(token) || !/Not Authorized/i.test(e.message)) throw e;
    const other = kind === 'project' ? 'bearer' : 'project';
    const d = await rawGql(token, other, query, variables);
    kinds.set(token, other);
    return d;
  }
}

const nodes = (conn) => (conn?.edges || []).map((e) => e.node);

// Token de projeto: descobre o projeto e o ambiente aos quais ele dá acesso.
async function projectFromToken(token) {
  const d = await gql(token, 'query { projectToken { projectId environmentId } }');
  const { projectId, environmentId } = d.projectToken;
  const p = await gql(token, 'query($id: String!) { project(id: $id) { id name description } }', { id: projectId });
  return { id: p.project.id, name: p.project.name, description: p.project.description || '', environmentId };
}

// Lista projetos (conta pessoal, de um workspace quando informado, ou o único projeto de um token de projeto).
export async function listProjects(token, workspaceId) {
  if (tokenKind(token) === 'project') return [await projectFromToken(token)];
  const d = workspaceId
    ? await gql(token, 'query($w: String!) { projects(workspaceId: $w) { edges { node { id name description } } } }', { w: workspaceId })
    : await gql(token, 'query { projects { edges { node { id name description } } } }');
  return nodes(d.projects).map((p) => ({ id: p.id, name: p.name, description: p.description || '' }));
}

export async function verify(token, workspaceId) {
  if (tokenKind(token) !== 'project') {
    try {
      const projects = await listProjects(token, workspaceId);
      return { kind: 'account', projects };
    } catch (e) {
      if (!/Not Authorized/i.test(e.message)) throw e; // pode ser um token de projeto sem prefixo
    }
  }
  kinds.set(token, 'project');
  return { kind: 'project', projects: [await projectFromToken(token)] };
}

export async function projectDetail(token, id) {
  const d = await gql(token, `query($id: String!) { project(id: $id) { id name
    services { edges { node { id name } } }
    environments { edges { node { id name } } } } }`, { id });
  return { id: d.project.id, name: d.project.name, services: nodes(d.project.services), environments: nodes(d.project.environments) };
}

export async function deployments(token, { projectId, serviceId, environmentId, first = 5 }) {
  const d = await gql(token, `query($input: DeploymentListInput!, $first: Int) { deployments(input: $input, first: $first) {
    edges { node { id status createdAt url staticUrl } } } }`, { input: { projectId, serviceId, environmentId }, first });
  return nodes(d.deployments);
}

export async function logs(token, { deploymentId, kind = 'runtime', limit = 100, filter }) {
  const field = kind === 'build' ? 'buildLogs' : 'deploymentLogs';
  const d = await gql(token, `query($id: String!, $limit: Int${kind === 'build' ? '' : ', $filter: String'}) { ${field}(deploymentId: $id, limit: $limit${kind === 'build' ? '' : ', filter: $filter'}) { timestamp message severity } }`,
    { id: deploymentId, limit, ...(kind === 'build' ? {} : { filter }) });
  return d[field] || [];
}

export async function redeploy(token, deploymentId) {
  const d = await gql(token, 'mutation($id: String!) { deploymentRedeploy(id: $id) { id status } }', { id: deploymentId });
  return d.deploymentRedeploy;
}

export async function restart(token, deploymentId) {
  await gql(token, 'mutation($id: String!) { deploymentRestart(id: $id) }', { id: deploymentId });
  return { ok: true };
}

export async function variables(token, { projectId, environmentId, serviceId }) {
  const d = await gql(token, 'query($p: String!, $e: String!, $s: String) { variables(projectId: $p, environmentId: $e, serviceId: $s) }', { p: projectId, e: environmentId, s: serviceId });
  return d.variables || {};
}

export async function upsertVariable(token, { projectId, environmentId, serviceId, name, value, skipDeploys }) {
  await gql(token, 'mutation($input: VariableUpsertInput!) { variableUpsert(input: $input) }', { input: { projectId, environmentId, serviceId, name, value, skipDeploys: !!skipDeploys } });
  return { ok: true };
}
