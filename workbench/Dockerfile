# Ambiente de trabalho dos agentes (um container descartável por tarefa).
# Motor: Claude Agent SDK (o mesmo do Claude Code). Kits: Node, Python, git, navegador (Playwright).
FROM node:22-bookworm

ENV DEBIAN_FRONTEND=noninteractive \
    PLAYWRIGHT_BROWSERS_PATH=/opt/ms-playwright \
    PIP_BREAK_SYSTEM_PACKAGES=1 \
    LANG=C.UTF-8

RUN apt-get update && apt-get install -y --no-install-recommends \
      git ripgrep jq curl ca-certificates build-essential python3 python3-pip python3-venv \
      unzip tar procps less \
    && rm -rf /var/lib/apt/lists/* \
    && curl -LsSf https://astral.sh/uv/install.sh | env UV_INSTALL_DIR=/usr/local/bin sh \
    && corepack enable

# Pythons prontos (o uv escolheria a versão mais nova, que muitas libs nativas ainda não suportam).
ENV UV_PYTHON_INSTALL_DIR=/opt/uv-python
RUN uv python install 3.12 3.13 && chmod -R a+rx /opt/uv-python

WORKDIR /opt/iaorg
COPY package.json package-lock.json ./
RUN npm ci --omit=dev && npm cache clean --force \
    && npx --yes playwright install --with-deps chromium \
    && chmod -R a+rx /opt/ms-playwright

COPY worker.mjs mcp-iaorg.mjs ./
COPY git-hooks ./git-hooks
RUN chmod +x git-hooks/*

# Usuário sem privilégios; /work é o espaço da tarefa (entregas, repo, memória, saída).
RUN mkdir -p /work/entregas /work/in /work/out /work/home && chown -R 1000:1000 /work
USER 1000:1000
ENV HOME=/work/home
WORKDIR /work

ENTRYPOINT ["node", "/opt/iaorg/worker.mjs"]
