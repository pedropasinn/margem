import { execFileSync } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, test } from 'vitest';
import type pg from 'pg';
import { validarCanonico, validarMarcasLegado, type CanonicoV1 } from '@margem/contratos';
import { canonicoDeTeste, comBanco, contadorDeIds, idTeste, material } from '../../testes/apoio.js';
import { comTransacao } from '../db/transacao.js';
import * as documentos from '../repos/documentos.js';
import * as marcasRepo from '../repos/marcas.js';
import {
  canonicoDaSessao, dobrarLigaturas, importarMarcasLegado, importarSessaoHorarium, limparRevisaoDoLegado,
  METODO_LEGADO, type SessaoHorarium,
} from './importar.js';

const PAGINAS_DO_CAPITULO_UM = '13-27';

const mixtape = material('corpus_principal');
const marcasLegadas = material('marcas_legadas', '01-introduction.json');
const sessao = material('sessao_horarium', 'mixtape-cap01-introduction_sessao.json');

test('a dobra de ligaturas mapeia cada unidade de volta ao texto original', () => {
  const dobra = dobrarLigaturas('ﬁm');
  expect(dobra.texto).toBe('fim');
  expect(dobra.posicoes).toEqual([0, 0, 1, 2]);
  expect(dobrarLigaturas('sem ligatura').texto).toBe('sem ligatura');
});

test('o arquivo revisado do Mixtape só valida como MarcasLegadoV1 depois de tirar a chave revisao', () => {
  if (!marcasLegadas) return;
  const bruto: unknown = JSON.parse(readFileSync(marcasLegadas, 'utf8'));
  expect(validarMarcasLegado(bruto)).toBe(false);
  expect(validarMarcasLegado(limparRevisaoDoLegado(bruto))).toBe(true);
});

test('marca legada não localizada não é gravada e aparece no relatório', async () => comBanco('import_orfa', async (banco) => {
  const canonico = canonicoDeTeste({ blocos: [{ tipo: 'paragrafo', texto: 'Texto presente no canônico.' }] });
  const versao = await comTransacao(banco, async (cliente) => {
    const documento = await documentos.criar(cliente, { ...canonico.documento, origem_caminho: 'teste' });
    return documentos.criarVersao(cliente, documento.id, canonico);
  });
  const relatorio = await importarMarcasLegado(banco, versao.id, {
    capitulo: '1. Teste', leitura_integral: true, limites: [],
    marcas: [
      { id: 'm01', pagina_pdf: 1, funcao: 'tese', citacao: 'Texto presente no canônico.', sublinhar: [], comentario: null },
      { id: 'm02', pagina_pdf: 1, funcao: 'conceito', citacao: 'Frase que não está no texto.', sublinhar: [], comentario: null },
    ],
    recuperacao: [{ pagina_pdf: 1, secao: 'Única', perguntas: ['Qual é a tese?'] }],
  }, undefined, { novoId: contadorDeIds('M'), agora: () => new Date('2026-09-20T12:00:00.000Z') });
  expect(relatorio.contagem).toMatchObject({ total: 2, resolvidas: 1, orfas: 1, gravadas: 1 });
  expect(relatorio.nao_resolvidas).toEqual([{ id: 'm02', motivo: 'ausente' }]);
  expect(relatorio.execucao.metodo_versao).toBe(METODO_LEGADO);
  expect(relatorio.recuperacao).toHaveLength(1);
  expect(relatorio.perdas.length).toBeGreaterThan(0);
  const marcas = await comTransacao(banco, (cliente) => marcasRepo.listarPorVersao(cliente, versao.id));
  expect(marcas).toHaveLength(1);
  expect(marcas[0]).toMatchObject({ origem: 'importacao', validade: 'resolvida', execucao_id: relatorio.execucao.id });
}));

describe.skipIf(mixtape === undefined || marcasLegadas === undefined)('capítulo 1 do Mixtape', () => {
  function canonizar(): { canonico: CanonicoV1; limpar: () => void } {
    if (!mixtape) throw new Error('inalcançável');
    const raiz = new URL('../../../', import.meta.url).pathname;
    const base = mkdtempSync(join(tmpdir(), 'margem-j06-import-'));
    const destino = join(base, 'saida');
    execFileSync(join(raiz, 'motor/.venv/bin/python'),
      ['-m', 'margem_motor.ingest', '--entrada', mixtape, '--formato', 'pdf',
        '--paginas', PAGINAS_DO_CAPITULO_UM, '--idioma', 'en', '--saida', destino],
      { cwd: join(raiz, 'motor'), stdio: ['ignore', 'ignore', 'pipe'] });
    const canonico: unknown = JSON.parse(readFileSync(join(destino, 'canonico.json'), 'utf8'));
    if (!validarCanonico(canonico)) throw new Error('O motor produziu canônico inválido.');
    return { canonico, limpar: () => { rmSync(base, { recursive: true, force: true }); } };
  }

  async function importar(banco: pg.Pool, canonico: CanonicoV1, reconciliar: boolean) {
    if (!marcasLegadas) throw new Error('inalcançável');
    const versao = await comTransacao(banco, async (cliente) => {
      const documento = await documentos.criar(cliente, { ...canonico.documento, origem_caminho: mixtape ?? '' });
      return documentos.criarVersao(cliente, documento.id, canonico);
    });
    const relatorio = await importarMarcasLegado(
      banco, versao.id, JSON.parse(readFileSync(marcasLegadas, 'utf8')),
      // As páginas do canônico são as do PDF inteiro: o mapa é a identidade.
      new Map(Array.from({ length: 30 }, (_, i) => [i + 1, i + 1])),
      { reconciliarTipografia: reconciliar, agora: () => new Date('2026-09-20T12:00:00.000Z') },
    );
    return { versao, relatorio };
  }

  test('as 20 marcas revisadas do capítulo 1 são importadas com ao menos 90% resolvidas',
    async () => comBanco('import_mixtape', async (banco) => {
      const { canonico, limpar } = canonizar();
      try {
        const { versao, relatorio } = await importar(banco, canonico, true);
        expect(relatorio.contagem.total).toBe(20);
        // Registrado, não arredondado: desde o J15 o motor desfaz as ligaturas também no corpo,
        // e as 20 casam literalmente (antes eram 14 literais e 6 reconciliadas).
        expect(relatorio.contagem.resolvidas).toBe(20);
        expect(relatorio.contagem.reconciliadas).toBe(0);
        expect(relatorio.contagem.gravadas).toBe(20);
        expect(relatorio.contagem.gravadas / relatorio.contagem.total).toBeGreaterThanOrEqual(0.9);
        expect(relatorio.nao_resolvidas).toEqual([]);

        const marcas = await comTransacao(banco, (cliente) => marcasRepo.listarPorVersao(cliente, versao.id));
        expect(marcas).toHaveLength(20);
        const porBloco = new Map(canonico.blocos.map((bloco) => [bloco.id, bloco.texto]));
        for (const marca of marcas) {
          expect(marca.origem).toBe('importacao');
          // A âncora aponta para o texto literal do canônico, nunca para a grafia do legado.
          expect(porBloco.get(marca.ancora.bloco_id)?.slice(marca.ancora.inicio_utf16, marca.ancora.fim_utf16))
            .toBe(marca.ancora.citacao);
        }
        // O canônico já não tem glifo de ligatura, então nenhuma âncora o carrega.
        expect(marcas.some((marca) => /[\uFB00-\uFB06]/u.test(marca.ancora.citacao))).toBe(false);
      } finally {
        limpar();
      }
    }), 180_000);

  test('sem reconciliação tipográfica, nenhuma marca do legado fica órfã (J15: ligaturas desfeitas no corpo)',
    async () => comBanco('import_estrito', async (banco) => {
      const { canonico, limpar } = canonizar();
      try {
        const { relatorio } = await importar(banco, canonico, false);
        expect(relatorio.contagem).toMatchObject({ total: 20, resolvidas: 20, reconciliadas: 0, orfas: 0, gravadas: 20 });
        expect(relatorio.nao_resolvidas).toEqual([]);
      } finally {
        limpar();
      }
    }), 180_000);
});

describe.skipIf(sessao === undefined)('sessão do Horarium', () => {
  function lerSessao(): SessaoHorarium {
    if (!sessao) throw new Error('inalcançável');
    return JSON.parse(readFileSync(sessao, 'utf8')) as SessaoHorarium;
  }

  test('o canônico derivado do rawText é válido e tem um bloco por parágrafo', () => {
    const conteudo = lerSessao();
    const canonico = canonicoDaSessao(conteudo, { novoId: contadorDeIds('B'), agora: () => new Date('2026-09-20T12:00:00.000Z') });
    expect(validarCanonico(canonico)).toBe(true);
    expect(canonico.documento.formato).toBe('colado');
    expect(canonico.blocos.length).toBeGreaterThan(50);
    expect(canonico.blocos.every((bloco) => bloco.tipo === 'paragrafo')).toBe(true);
    expect(canonico.limites[0]).toContain('sessão do Horarium');
  });

  test('a sessão vira documento, versão e marcas, com as perdas declaradas',
    async () => comBanco('import_horarium', async (banco) => {
      const relatorio = await importarSessaoHorarium(banco, lerSessao(), {
        agora: () => new Date('2026-09-20T12:00:00.000Z'),
      });
      expect(relatorio.contagem.total).toBe(20);
      expect(relatorio.contagem.gravadas).toBe(20);
      expect(relatorio.nao_resolvidas).toEqual([]);
      expect(relatorio.sha256_confere).toBe(true);
      expect(relatorio.perguntas.length).toBeGreaterThan(0);
      expect(relatorio.perdas.join(' ')).toContain('notaHipotetica');

      const marcas = await comTransacao(banco, (cliente) => marcasRepo.listarPorVersao(cliente, relatorio.versao_id));
      expect(marcas).toHaveLength(20);
      // TESE/CONCEITO/JUSTIFICATIVA viram função; NOTA vira `nenhuma`.
      expect(new Set(marcas.map((marca) => marca.funcao)).size).toBeGreaterThan(1);
      expect(marcas.every((marca) => marca.subfaixas.length === 0)).toBe(true);
      const comComentario = marcas.filter((marca) => marca.comentario !== null);
      expect(comComentario.length).toBeGreaterThan(0);
      expect(comComentario[0]?.comentario?.tipo).toBe('AUTOR');
    }), 120_000);
});

test('rótulo desconhecido da sessão é recusado sem derrubar a importação', async () => comBanco('import_rotulo', async (banco) => {
  const conteudo: SessaoHorarium = {
    versao: 1,
    documento: { id: 'teste', titulo: 'Sessão de teste', rawText: 'Primeiro parágrafo.\n\nSegundo parágrafo.' },
    conexoes: [
      { id: 'c1', citacao: 'Primeiro parágrafo.', rotulo: 'TESE', definicao: 'Abre o argumento.' },
      { id: 'c2', citacao: 'Segundo parágrafo.', rotulo: 'DESCONHECIDO' },
    ],
  };
  const relatorio = await importarSessaoHorarium(banco, conteudo, {
    novoId: contadorDeIds('M'), agora: () => new Date('2026-09-20T12:00:00.000Z'),
  });
  expect(relatorio.contagem).toMatchObject({ total: 2, gravadas: 1, invalidas: 1 });
  expect(relatorio.nao_resolvidas).toEqual([{ id: 'c2', motivo: 'rotulo_desconhecido' }]);
  expect(relatorio.sha256_confere).toBe(false);
  expect(idTeste('M', 1)).toMatch(/^[0-7][0-9A-HJKMNP-TV-Z]{25}$/);
}));

test('citação vazia da sessão é recusada em vez de travar o laço de busca (auditoria 02/10)', async () => comBanco('import_vazia', async (banco) => {
  const conteudo: SessaoHorarium = {
    versao: 1,
    documento: { id: 'teste', titulo: 'Sessão de teste', rawText: 'Primeiro parágrafo.' },
    conexoes: [{ id: 'c1', citacao: '', rotulo: 'TESE' }],
  };
  const relatorio = await importarSessaoHorarium(banco, conteudo, { novoId: contadorDeIds('V') });
  expect(relatorio.contagem).toMatchObject({ total: 1, gravadas: 0, invalidas: 1 });
  expect(relatorio.nao_resolvidas).toEqual([{ id: 'c1', motivo: 'citacao_vazia' }]);
}));
