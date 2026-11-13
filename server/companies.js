// Uma pasta por empresa (= Organization do Keycloak): estado, workspace e logo.
import fs from 'node:fs';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { DATA_DIR, encrypt, decrypt, mask } from './secrets.js';

const COMPANIES_DIR = path.join(DATA_DIR, 'companies');
fs.mkdirSync(COMPANIES_DIR, { recursive: true });

export const uid = (prefix = '') => prefix + randomUUID().slice(0, 8);
export const DEFAULT_MODEL = process.env.DEFAULT_CLAUDE_MODEL || 'claude-haiku-5-5';

const ROLE_RANK = { member: 1, admin: 2, owner: 3 };
export const hasRole = (member, role) => !!member && (ROLE_RANK[member.appRole] || 0) >= ROLE_RANK[role];

function freshState(id, name) {
  return {
    company: {
      id, name, segment: '', website: '', description: '', mission: '', context: '',
      logo: null, onboardingStep: 'company', createdAt: Date.now(),
      settings: { model: DEFAULT_MODEL, effort: 'medium', budgetUsd: 20 },
    },
    secrets: { claudeKey: null, githubToken: null },
    repos: [],
    agents: [],
    invites: [],
    tasks: [],
    messages: [],
    events: [],
    usage: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, calls: 0 },
    paused: false,
    seq: { task: 0 },
  };
}

export class CompanyStore {
  constructor(id, state) {
    this.id = id;
    this.dir = path.join(COMPANIES_DIR, id);
    this.workspace = path.join(this.dir, 'workspace');
    fs.mkdirSync(this.workspace, { recursive: true });
    this.file = path.join(this.dir, 'state.json');
    this.state = state;
    this.saveTimer = null;
  }

  static load(id) {
    const file = path.join(COMPANIES_DIR, id, 'state.json');
    const raw = JSON.parse(fs.readFileSync(file, 'utf8'));
    const base = freshState(id, raw.company?.name || 'Empresa');
    return new CompanyStore(id, { ...base, ...raw, company: { ...base.company, ...raw.company, settings: { ...base.company.settings, ...raw.company?.settings } } });
  }

  save() {
    clearTimeout(this.saveTimer);
    this.saveTimer = setTimeout(() => this.saveNow(), 250);
  }

  saveNow() {
    const tmp = this.file + '.tmp';
    fs.writeFileSync(tmp, JSON.stringify(this.state, null, 2));
    fs.renameSync(tmp, this.file);
  }

  get company() { return this.state.company; }
  getAgent(id) { return this.state.agents.find((a) => a.id === id); }
  memberBySub(sub) { return this.state.agents.find((a) => a.kind === 'human' && a.userSub === sub && a.active !== false); }
  owner() { return this.state.agents.find((a) => a.kind === 'human' && a.appRole === 'owner' && a.active !== false); }
  aiAgents() { return this.state.agents.filter((a) => a.kind !== 'human'); }

  nextTaskId() {
    this.state.seq.task = (this.state.seq.task || 0) + 1;
    return 'T' + this.state.seq.task;
  }

  // ---- segredos ----
  setSecret(name, value) { this.state.secrets[name] = encrypt(value); this.save(); }
  getSecret(name) { return decrypt(this.state.secrets[name]); }
  secretInfo() {
    return {
      claudeKey: mask(this.getSecret('claudeKey')),
      githubToken: mask(this.getSecret('githubToken')),
    };
  }

  // ---- workspace ----
  safePath(rel) {
    const clean = String(rel || '').replace(/^[/\\]+/, '');
    const full = path.resolve(this.workspace, clean);
    if (full !== this.workspace && !full.startsWith(this.workspace + path.sep)) throw new Error('Caminho fora do workspace');
    return full;
  }

  listFiles(dir = this.workspace, base = '') {
    const out = [];
    for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
      if (e.name.startsWith('.')) continue; // ocultos (ex.: .lixeira)
      const rel = base ? `${base}/${e.name}` : e.name;
      if (e.isDirectory()) out.push(...this.listFiles(path.join(dir, e.name), rel));
      else { const st = fs.statSync(path.join(dir, e.name)); out.push({ path: rel, size: st.size, mtime: st.mtimeMs }); }
    }
    return out;
  }

  // Pastas (inclusive vazias), para o gerenciador de arquivos.
  listFolders(dir = this.workspace, base = '') {
    const out = [];
    for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
      if (!e.isDirectory() || e.name.startsWith('.')) continue;
      const rel = base ? `${base}/${e.name}` : e.name;
      out.push(rel, ...this.listFolders(path.join(dir, e.name), rel));
    }
    return out;
  }

  // Zera trabalho (tarefas, conversas, arquivos), mantendo empresa, equipe e segredos.
  resetWork() {
    Object.assign(this.state, { tasks: [], messages: [], events: [], jobs: [], seq: { task: 0 }, paused: false });
    fs.rmSync(this.workspace, { recursive: true, force: true });
    fs.mkdirSync(this.workspace, { recursive: true });
    this.save();
  }

  logoFile() {
    return this.company.logo ? path.join(this.dir, this.company.logo) : null;
  }
}

// ---------------- registro de empresas ----------------
const registry = new Map();

for (const id of fs.readdirSync(COMPANIES_DIR)) {
  try { registry.set(id, CompanyStore.load(id)); } catch (e) { console.warn('[companies] ignorando', id, e.message); }
}

export const allCompanies = () => [...registry.values()];
export const getCompany = (id) => registry.get(id);

export function createCompany(id, name) {
  const store = new CompanyStore(id, freshState(id, name));
  store.saveNow();
  registry.set(id, store);
  return store;
}

// Empresa do usuário: a primeira organização dele que existe no app.
export function companyForOrgs(orgIds) {
  for (const id of orgIds) if (registry.has(id)) return registry.get(id);
  return null;
}
