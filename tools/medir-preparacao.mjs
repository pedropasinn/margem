#!/usr/bin/env node
// Preparar em segundo plano basta? Lê GET /api/compreensoes/:id/tempos e imprime, por capítulo, o tempo
// de leitura e o de preparação (medido ou estimado), e quanto se esperaria com 0 a 3 capítulos adiante.
//
//   node tools/medir-preparacao.mjs <compreensao_id> [http://127.0.0.1:8730] [segundos_por_mil] [trabalhadores]
//
// Sem capítulos medidos, passe a taxa (segundos de trabalho do Codex por mil caracteres) para simular.
const [id, base = 'http://127.0.0.1:8730', taxa, trabalhadores = '1'] = process.argv.slice(2);
if (!id) { console.error('uso: node tools/medir-preparacao.mjs <compreensao_id> [base] [segundos_por_mil]'); process.exit(2); }
const consulta = new URLSearchParams({ trabalhadores, ...(taxa && taxa !== '-' ? { segundos_por_mil: taxa } : {}) });
const resposta = await fetch(`${base}/api/compreensoes/${id}/tempos?${consulta.toString()}`);
if (!resposta.ok) { console.error(`HTTP ${resposta.status}: ${await resposta.text()}`); process.exit(1); }
const medida = await resposta.json();
const min = (s) => s === null || s === undefined ? '—' : `${(s / 60).toFixed(1)} min`;
console.log(`Taxa: ${medida.segundos_por_mil_caracteres ?? '—'} s de preparo por mil caracteres · prefetch atual: ${medida.profundidade_atual}\n`);
console.log(['capítulo', 'caracteres', 'leitura', 'preparo', 'pronto em', 'jobs'].join('\t'));
for (const c of medida.capitulos) {
  console.log([c.titulo.slice(0, 40), c.caracteres, min(c.leitura_s), `${min(c.preparo_s)}${c.estimado ? ' (est.)' : ''}`, min(c.pronto_em_s), c.jobs].join('\t'));
}
if (medida.simulacoes.length === 0) { console.log('\nSem taxa para estimar os capítulos não preparados: passe segundos_por_mil.'); process.exit(0); }
console.log(`\nEspera ao abrir cada capítulo, com ${trabalhadores} ${trabalhadores === '1' ? 'vaga' : 'vagas'} do Codex (a do primeiro é inevitável sem preparar antes):`);
for (const s of medida.simulacoes) {
  console.log(`  ${s.profundidade} adiante: ${s.esperas_s.map((e) => min(e)).join(' · ')}  → depois do primeiro: ${min(s.espera_depois_do_primeiro_s)}`);
}
const r = medida.recomendada;
console.log(`\nRecomendado: MARGEM_PREFETCH=${r.profundidade}${r.espera_depois_do_primeiro_s === 0 ? ' (sem espera depois do primeiro capítulo)' : ` (ainda ${min(r.espera_depois_do_primeiro_s)} de espera: o Codex prepara mais devagar do que se lê)`}`);
