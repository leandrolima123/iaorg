// Teste da agenda das rotinas (sem custo): próxima execução no fuso da empresa.
// Uso: node scripts/test-routines.mjs
import { nextRun, describeSchedule, TZ } from '../server/routines.js';

let fail = 0;
const check = (label, ok, extra = '') => { console.log(`${ok ? 'OK    ' : 'FALHOU'} ${label}${extra ? ` → ${extra}` : ''}`); if (!ok) fail++; };
const local = (ts) => new Date(ts).toLocaleString('pt-BR', { timeZone: TZ, weekday: 'short', day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' });
const wd = (ts) => new Intl.DateTimeFormat('en-US', { timeZone: TZ, weekday: 'short' }).format(new Date(ts));
const hm = (ts) => new Intl.DateTimeFormat('pt-BR', { timeZone: TZ, hour: '2-digit', minute: '2-digit', hour12: false }).format(new Date(ts));

// Quinta 12/11/2026 às 11:00 em São Paulo (14:00 UTC)
const base = Date.UTC(2026, 10, 12, 14, 0);
const daily = nextRun({ freq: 'daily', time: '10:00' }, base);
check('Diária 10:00 depois das 11h → amanhã (sexta) 10:00', hm(daily) === '10:00' && wd(daily) === 'Fri', local(daily));
const daily2 = nextRun({ freq: 'daily', time: '15:30' }, base);
check('Diária 15:30 antes do horário → hoje 15:30', hm(daily2) === '15:30' && wd(daily2) === 'Thu', local(daily2));
const fri = Date.UTC(2026, 10, 13, 14, 0); // sexta 11:00
const wdays = nextRun({ freq: 'weekdays', time: '10:00' }, fri);
check('Dias úteis numa sexta depois das 10h → segunda 10:00', wd(wdays) === 'Mon' && hm(wdays) === '10:00', local(wdays));
const tue = nextRun({ freq: 'weekly', days: [2], time: '10:00' }, base);
check('Toda terça 10:00 → próxima terça', wd(tue) === 'Tue' && hm(tue) === '10:00', local(tue));
const mon = nextRun({ freq: 'weekly', days: [1, 4], time: '09:00' }, base);
check('Segunda e quinta 09:00 numa quinta depois das 9h → segunda', wd(mon) === 'Mon' && hm(mon) === '09:00', local(mon));
const thu = nextRun({ freq: 'weekly', days: [1, 4], time: '12:00' }, base);
check('Segunda e quinta 12:00 numa quinta às 11h → hoje', wd(thu) === 'Thu' && hm(thu) === '12:00', local(thu));
const month = nextRun({ freq: 'monthly', dayOfMonth: 31, time: '08:00' }, Date.UTC(2026, 10, 12));
check('Mensal dia 31 em novembro → último dia (30/11)', local(month).includes('30/11'), local(month));
check('UTC certo (10:00 em São Paulo = 13:00 UTC)', new Date(daily).getUTCHours() === 13);
check('Descrição legível', describeSchedule({ freq: 'weekly', days: [2], time: '10:00' }) === 'terça às 10:00', describeSchedule({ freq: 'weekly', days: [2], time: '10:00' }));
process.exit(fail ? 1 : 0);
