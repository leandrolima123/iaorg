// Teste: identificar o cliente em e-mails recebidos (normal, Reply-To e formulário noreply).
import { customerOf } from '../server/integrations.js';

const store = { state: { integrations: { resend: { connected: true, config: { from: 'Suporte Clínica Exemplo <suporte@clinicaexemplo.com.br>', inboxes: ['suporte@clinicaexemplo.com.br', 'contato@clinicaexemplo.com.br'] } } } } };
const form = `Clínica Exemplo
Nova mensagem de suporte
Você recebeu uma nova mensagem através da Central de Suporte do Clínica Exemplo.
MA
Marina
marina.souza@exemplo.com
DÚVIDA · ASSUNTO
Mudar de Plano
MENSAGEM
como passo alterar meu plano
Responder para Marina
Recebido em 11/11/2026 às 20:48 UTC
© 2025 Clínica Exemplo. Todos os direitos reservados.
Dúvidas? suporte@clinicaexemplo.com.br`;

let fail = 0;
const check = (label, got, want) => { const ok = JSON.stringify(got) === JSON.stringify(want); console.log(`${ok ? 'OK    ' : 'FALHOU'} ${label} → ${JSON.stringify(got)}`); if (!ok) fail++; };
const pick = (c) => [c.email, c.name, c.source];

check('formulário noreply: cliente vem do corpo', pick(customerOf(store, { from: 'Clínica Exemplo <noreply@clinicaexemplo.com.br>', to: ['suporte@clinicaexemplo.com.br'], text: form })), ['marina.souza@exemplo.com', 'Marina', 'corpo']);
check('formulário com Reply-To: usa o Reply-To', pick(customerOf(store, { from: 'noreply@clinicaexemplo.com.br', replyTo: ['Marina <marina.souza@exemplo.com>'], text: form })), ['marina.souza@exemplo.com', 'Marina', 'reply-to']);
check('Reply-To sem nome: nome vem do corpo', pick(customerOf(store, { from: 'noreply@clinicaexemplo.com.br', replyTo: ['marina.souza@exemplo.com'], text: form })), ['marina.souza@exemplo.com', 'Marina', 'reply-to']);
check('e-mail comum: usa o remetente', pick(customerOf(store, { from: 'Carla Mendes <carla@clinica.com>', text: 'Oi, fui cobrada duas vezes. Meu outro e-mail é carla2@gmail.com' })), ['carla@clinica.com', 'Carla Mendes', 'remetente']);
check('noreply sem e-mail no corpo: não identifica', pick(customerOf(store, { from: 'no-reply@clinicaexemplo.com.br', text: 'Teste sem endereço' })), [null, '', 'nenhum']);
process.exit(fail ? 1 : 0);
