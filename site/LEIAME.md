# Site público do IAORG

Serviço pequeno que publica **só** a landing, a Política de Privacidade, os Termos de Serviço e a **lista de interesse**. Não inclui o app, o login nem a oficina dos agentes. Usa as mesmas páginas de `public/` (`landing.html`, `privacidade.html`, `termos.html`), servidas em modo "lista de espera": os botões de login somem e o formulário aparece.

- Sem dependências no servidor (`site/server.mjs`, só Node 22).
- Consumo medido: cerca de 20 MB de memória parado.
- Os cadastros ficam em `DATA_DIR/interessados.json` (um volume).

## Rodar localmente

```bash
docker build -f site/Dockerfile -t iaorg-site .
docker run --rm -p 8090:8080 -e ADMIN_PASSWORD=troque-esta-senha -v iaorg-site-data:/data iaorg-site
```

Abra http://localhost:8090.

## Publicar no Railway

1. Crie um serviço a partir deste repositório.
2. Em **Settings → Build**, use o Dockerfile `site/Dockerfile`. A pasta raiz do build continua sendo a raiz do repositório, porque ele copia arquivos de `public/`. Uma forma é definir a variável `RAILWAY_DOCKERFILE_PATH=site/Dockerfile`.
3. Adicione um **volume** montado em `/data`.
4. Defina as variáveis:

| Variável | Para quê | Obrigatória |
|---|---|---|
| `ADMIN_PASSWORD` | Senha para baixar a lista. Sem ela, a exportação fica desligada. | Recomendada |
| `RAILWAY_RUN_UID=0` | O volume do Railway pertence ao root; sem isso, o site não consegue gravar a lista. | Sim, com volume |
| `RESEND_API_KEY`, `LEADS_FROM`, `LEADS_NOTIFY_TO` | Aviso por e-mail a cada novo cadastro. `LEADS_FROM` precisa ser de um domínio verificado no Resend; `LEADS_NOTIFY_TO` aceita vários e-mails separados por vírgula. | Não |

5. Em **Networking**, gere um domínio ou ligue o seu.

A porta é lida de `PORT`, que o Railway define sozinho.

## Baixar a lista

- Planilha: `https://SEU-DOMINIO/admin/interessados.csv` (abre no Excel, separada por ponto e vírgula).
- JSON: `https://SEU-DOMINIO/admin/interessados.json`.

O navegador pede usuário e senha. Use qualquer usuário e a senha de `ADMIN_PASSWORD`.

## Vídeos de demonstração

Os cartões do carrossel vêm de `public/videos/demos.json`. Para publicar um vídeo:

- **Arquivo próprio**: coloque o `.mp4` em `public/videos/` e preencha `src` (ex.: `/videos/ordem.mp4`). Opcionalmente, preencha `poster` (imagem de capa) e `legendas` (`.vtt`). Cada vídeo aumenta a imagem do site e o tráfego, que o Railway cobra a US$ 0,05 por GB.
- **YouTube**: preencha `youtube` com o código do vídeo. O vídeo só carrega quando a pessoa clica, e usa o domínio de privacidade aprimorada.

Sem `src` nem `youtube`, o cartão aparece como "Em breve".

## Proteções

- Campo-isca contra robôs e limite de 6 envios a cada 10 minutos por IP. O IP não é gravado.
- Reenvio com o mesmo e-mail atualiza o cadastro em vez de duplicar.
- Valores que começam com `=`, `+`, `-` ou `@` são neutralizados na planilha.
- Só os arquivos do site são servidos; o resto de `public/` (o app) responde 404.
- Cabeçalhos de segurança, incluindo política de conteúdo (CSP).
