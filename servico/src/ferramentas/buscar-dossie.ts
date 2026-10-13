/**
 * Busca o dossiê automático de uma obra do acervo (Commons → Wikidata → Wikipédia pt/en) e guarda o
 * instantâneo em `fontes/auto-*.txt` e `dossie-auto.json`. Única ferramenta do módulo que usa a rede.
 * Também compara com a referência curada: identidade e quanto da pesquisa curada aparece nos textos.
 *
 *   node --import tsx servico/src/ferramentas/buscar-dossie.ts <slug> [mais…]
 */
import { join } from 'node:path';
import { lerObra, montarDossie } from '../arte/v2/acervo.js';
import { buscarDossieAutomatico, dossieEBaseAutomaticos } from '../arte/v2/dossie-auto.js';
import { compararDossies } from '../arte/v2/dossie-comparacao.js';

for (const slug of process.argv.slice(2)) {
  try {
    const obra = await lerObra(slug);
    const auto = await buscarDossieAutomatico(obra.pasta);
    const { dossie } = await dossieEBaseAutomaticos(obra);
    console.log(JSON.stringify({ obra: slug, qid: auto.qid, fontes: auto.fontes.map((f) => f.arquivo), comparacao: obra.referencia ? compararDossies(montarDossie(obra), obra.referencia, dossie) : null, arquivo: join(obra.pasta, 'dossie-auto.json') }));
  } catch (erro) {
    console.error(`✗ ${slug}: ${erro instanceof Error ? erro.message : String(erro)}`);
    process.exitCode = 1;
  }
}
