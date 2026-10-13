import { resolve } from 'node:path';
import { lerCatalogoDeArte } from '../arte/catalogo.js';
import { gerarAnaliseDaObra } from '../arte/geracao.js';
import { executarCodex } from '../executor/codex.js';
const nome = process.argv[2];
if (nome !== 'educacao' && nome !== 'tolo') throw new Error('Uso: node --import tsx servico/src/ferramentas/avaliar-arte.ts educacao|tolo');
const base = (await lerCatalogoDeArte()).find(o => o.modelo.imagem.url === `/arte/${nome}.jpg`)!.modelo;
const resultado = await gerarAnaliseDaObra(base, {
  executor: executarCodex, imagem: resolve(`web/public/arte/${nome}.jpg`),
  diretorio: resolve(`.local/arte-benchmark/${nome}-${Date.now()}`),
});
console.log(JSON.stringify({ obra: nome, falhas: resultado.falhas, registros: resultado.registros }));
if (resultado.falhas.length) process.exitCode = 1;
