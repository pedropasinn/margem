// Replay offline das marcas legadas: o mesmo `importarMarcasLegado` da rota
// `importar-legado`, contra um Postgres de mentira em memória. Nenhum banco real,
// nenhuma rede. Uso: node --import tsx motor/tests/replay_legado.mjs canonico.json marcas...
// Imprime um JSON com a contagem somada e as não resolvidas por arquivo.
import { readFileSync } from 'node:fs';
import { basename } from 'node:path';
import { localizarCitacao } from '../../contratos/src/index.ts';
import { quadsDaAncora } from '../../core/src/geometria.ts';
import { importarMarcasLegado, dobrarLigaturas } from '../../servico/src/leitura/importar.ts';

const [caminhoCanonico, ...arquivos] = process.argv.slice(2);
const canonico = JSON.parse(readFileSync(caminhoCanonico, 'utf8'));
const geometria = process.env.GEOMETRIA_REPLAY ? JSON.parse(readFileSync(process.env.GEOMETRIA_REPLAY, 'utf8')) : null;
const acertos = { ancoradas: 0, na_pagina_esperada: 0, falhas: [] };
const VERSAO = '01J00000000000000000000000';
const execucoes = new Map();
const marcas = [];

// Só as consultas que a importação faz; qualquer outra devolve vazio.
const cliente = {
  async query(sql, p = []) {
    const texto = sql.replace(/\s+/g, ' ');
    if (texto.startsWith('SELECT * FROM versao_texto')) return { rows: [{ id: VERSAO, documento_id: VERSAO, canonico }] };
    if (texto.startsWith('INSERT INTO execucao_leitura')) {
      execucoes.set(p[0], {
        id: p[0], versao_id: p[1], metodo_versao: p[2], prompt_versao: p[3], schema_versao: p[4], modelo: p[5],
        esforco: p[6], tamanho_parte_tokens: p[7], concorrencia: p[8], plano_partes: JSON.parse(p[9]), criada_em: p[10],
      });
      return { rows: [] };
    }
    if (texto.includes('FROM execucao_leitura WHERE id=$1') && !texto.includes('FOR UPDATE')) {
      return { rows: execucoes.has(p[0]) ? [execucoes.get(p[0])] : [] };
    }
    if (texto.includes('FROM execucao_leitura WHERE versao_id=$1')) {
      return { rows: [...execucoes.values()].map((e) => ({ id: e.id, modo: { id: 'argumentativa', revisao: 1 } })) };
    }
    // O gatilho da migração 0004 cria uma camada para cada execução V1.
    if (texto.includes('FROM camada c WHERE c.versao_id=$1')) {
      return { rows: [...execucoes.values()].map((e) => ({ id: e.id, versao_id: e.versao_id,
        tipo: 'execucao', execucao_id: e.id, modo: { id: 'argumentativa', revisao: 1 }, criada_em: e.criada_em })) };
    }
    if (texto.includes('FROM marca WHERE versao_id=$1')) return { rows: marcas.map((marca) => ({ marca })) };
    if (texto.startsWith('INSERT INTO marca')) {
      marcas.push({
        id: p[0],
        ancora: { versao_id: p[1], bloco_id: p[2], inicio_utf16: p[3], fim_utf16: p[4], citacao: p[5], prefixo: p[6], sufixo: p[7] },
        funcao: p[8], subfaixas: JSON.parse(p[9]), comentario: p[10] === null ? null : JSON.parse(p[10]),
        saliencia: p[18], camada_id: p[19], modo: { id: p[20], revisao: p[21] },
        origem: p[11], validade: p[12], visivel: p[13], avaliacao: p[14], criada_em: p[17],
        ...(p[15] ? { execucao_id: p[15] } : {}), ...(p[16] ? { job_id: p[16] } : {}),
      });
      return { rows: [] };
    }
    return { rows: [] };
  },
  release() {},
};
const banco = { connect: async () => cliente };

const total = { total: 0, gravadas: 0, resolvidas: 0, reconciliadas: 0 };
const nao_resolvidas = [];
for (const arquivo of arquivos) {
  const bruto = JSON.parse(readFileSync(arquivo, 'utf8'));
  const antes = marcas.length;
  const relatorio = await importarMarcasLegado(banco, VERSAO, bruto, undefined, { reconciliarTipografia: true });
  if (geometria) for (const marca of marcas.slice(antes)) {
    acertos.ancoradas++;
    const a = marca.ancora;
    const bloco = canonico.blocos.find((b) => b.id === a.bloco_id);
    const local = localizarCitacao(bloco, a.citacao, a.prefixo, a.sufixo);
    const legadas = bruto.marcas.filter((m) => dobrarLigaturas(m.citacao).texto === dobrarLigaturas(a.citacao).texto);
    const quads = quadsDaAncora(a, { versao_id: VERSAO, palavras: geometria.palavras });
    if (local.tipo === 'unica' && local.inicio_utf16 === a.inicio_utf16 && legadas.length === 1 &&
      quads.some((q) => q.pagina === legadas[0].pagina_pdf && q.quads.length > 0)) acertos.na_pagina_esperada++;
    else acertos.falhas.push({ arquivo: basename(arquivo), citacao: a.citacao, esperadas: legadas.map((m) => m.pagina_pdf), paginas: quads.map((q) => q.pagina) });
  }
  for (const chave of Object.keys(total)) total[chave] += relatorio.contagem[chave];
  for (const item of relatorio.nao_resolvidas) nao_resolvidas.push({ arquivo: basename(arquivo), ...item });
}
console.log(JSON.stringify({ ...total, nao_resolvidas, ...(geometria ? { geometria: acertos } : {}) }));
