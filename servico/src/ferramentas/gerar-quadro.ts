/**
 * Gera a análise de um ou mais quadros do acervo com o algoritmo v2 (quatro chamadas ao Codex por obra,
 * mais um reparo do roteiro quando a conferência acha problema grave) e já avalia contra a referência.
 *
 *   node --import tsx servico/src/ferramentas/gerar-quadro.ts <slug> [mais…] [--rotulo v2-…] [--sem-reparo] [--esforco medium] [--dossie-auto]
 *
 * Saída em `<raiz da obra>/<slug>/geracoes/<rotulo>/` (`<dados>/quadros` ou, no acervo de desenvolvimento,
 * `<dados>/arte/obras`). O app faz o mesmo pela fila (`arte/preparo.ts`, J118). Rodar de novo com o mesmo rótulo
 * retoma: etapas com resposta em `brutos/` não chamam o Codex outra vez. Várias obras rodam em
 * sequência com o mesmo rótulo; cota esgotada para o lote (as seguintes ficam para a retomada).
 * `--dossie-auto` usa `dossie-auto.json` (buscar antes com buscar-dossie.ts) em vez da referência curada.
 * Saída 1: algum resultado fora do contrato ou das regras; 2: alguma chamada falhou (cota, prazo).
 */
import { gerarQuadroV2 } from '../arte/v2/pipeline.js';
import { executarCodex } from '../executor/codex.js';

function rotuloPadrao(agora = new Date()): string {
  const p = (n: number) => String(n).padStart(2, '0');
  return `v2-${String(agora.getFullYear())}${p(agora.getMonth() + 1)}${p(agora.getDate())}-${p(agora.getHours())}${p(agora.getMinutes())}`;
}

const args = process.argv.slice(2);
const comValor = ['--rotulo', '--esforco'];
const slugs = args.filter((a, i) => !a.startsWith('--') && !comValor.includes(args[i - 1] ?? ''));
const valor = (nome: string): string | undefined => { const i = args.indexOf(nome); return i >= 0 ? args[i + 1] : undefined; };
if (!slugs.length) {
  console.error('Uso: node --import tsx servico/src/ferramentas/gerar-quadro.ts <slug> [mais…] [--rotulo v2-…] [--sem-reparo] [--esforco medium] [--dossie-auto]');
  process.exit(64);
}
const rotulo = valor('--rotulo') ?? rotuloPadrao();
for (const slug of slugs) {
  const inicio = Date.now();
  try {
    const r = await gerarQuadroV2(slug, {
      executor: executarCodex, rotulo, esforco: valor('--esforco') ?? 'medium', reparo: !args.includes('--sem-reparo'), dossie: args.includes('--dossie-auto') ? 'auto' : 'curado',
      avisar: (m) => { console.error(`[${new Date().toLocaleTimeString('pt-BR')}] ${m}`); },
    });
    const falhas = [...r.registro.diagnosticos.modelo, ...r.registro.diagnosticos.curta];
    console.log(JSON.stringify({
      obra: slug, rotulo, pasta: r.pasta, chamadas: r.registro.chamadas, chamadas_agora: r.registro.chamadas_nesta_execucao, segundos: Math.round((Date.now() - inicio) / 1000),
      duracao_s: r.curta.batidas.at(-1)?.fim_s, batidas: r.curta.batidas.length, regioes: r.modelo.regioes.length, afirmacoes: r.modelo.afirmacoes.length,
      cortes: r.registro.diagnosticos.cortes.length, falhas,
    }));
    if (falhas.length && !process.exitCode) process.exitCode = 1;
  } catch (erro) {
    const mensagem = erro instanceof Error ? erro.message : String(erro);
    console.error(`✗ ${slug} (${rotulo}): ${mensagem}`);
    console.error(`  retomar com: node --import tsx servico/src/ferramentas/gerar-quadro.ts ${slug} --rotulo ${rotulo}`);
    process.exitCode = 2;
    if (mensagem.includes('_adiado')) { console.error('  cota esgotada: lote interrompido.'); break; }
  }
}
