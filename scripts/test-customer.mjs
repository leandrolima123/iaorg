// Teste: identificar o cliente em e-mails recebidos (normal, Reply-To e formulário noreply).
import { customerOf } from '../server/integrations.js';

const store = { state: { integrations: { resend: { connected: true, config: { from: 'Suporte Cuidado Mental <suporte@cuidadomental.co>', inboxes: ['suporte@cuidadomental.co', 'contato@cuidadomental.co'] } } } } };
const form = `Cuidado Mental
Nova mensagem de suporte
Você recebeu uma nova mensagem através da Central de Suporte do Cuidado Mental.
LE
Leandro
leolimasilva123@gmail.com
DÚVIDA · ASSUNTO
Mudar de Plano
MENSAGEM
como passo alterar meu plano
Responder para Leandro
Recebido em 11/11/2026 às 20:48 UTC
© 2025 Cuidado Mental. Todos os direitos reservados.
Dúvidas? suporte@cuidadomental.co`;

let fail = 0;
const check = (label, got, want) => { const ok = JSON.stringify(got) === JSON.stringify(want); console.log(`${ok ? 'OK    ' : 'FALHOU'} ${label} → ${JSON.stringify(got)}`); if (!ok) fail++; };
const pick = (c) => [c.email, c.name, c.source];

check('formulário noreply: cliente vem do corpo', pick(customerOf(store, { from: 'Cuidado Mental <noreply@cuidadomental.co>', to: ['suporte@cuidadomental.co'], text: form })), ['leolimasilva123@gmail.com', 'Leandro', 'corpo']);
check('formulário com Reply-To: usa o Reply-To', pick(customerOf(store, { from: 'noreply@cuidadomental.co', replyTo: ['Leandro <leolimasilva123@gmail.com>'], text: form })), ['leolimasilva123@gmail.com', 'Leandro', 'reply-to']);
check('Reply-To sem nome: nome vem do corpo', pick(customerOf(store, { from: 'noreply@cuidadomental.co', replyTo: ['leolimasilva123@gmail.com'], text: form })), ['leolimasilva123@gmail.com', 'Leandro', 'reply-to']);
check('e-mail comum: usa o remetente', pick(customerOf(store, { from: 'Carla Mendes <carla@clinica.com>', text: 'Oi, fui cobrada duas vezes. Meu outro e-mail é carla2@gmail.com' })), ['carla@clinica.com', 'Carla Mendes', 'remetente']);
check('noreply sem e-mail no corpo: não identifica', pick(customerOf(store, { from: 'no-reply@cuidadomental.co', text: 'Teste sem endereço' })), [null, '', 'nenhum']);
process.exit(fail ? 1 : 0);
