/**
 * Configurações → Modelos (V-T10): o modelo e o esforço de cada categoria de execução do Codex.
 *
 *   GET  /api/configuracoes/modelos             categorias (padrão explicado + escolha), modelos da conta
 *   PUT  /api/configuracoes/modelos             { categorias: { <id>: { modelo, esforco } } } (null = padrão)
 *   POST /api/configuracoes/modelos/atualizar   busca de novo a lista de modelos da conta no Codex
 *
 * A lista de modelos é buscada uma vez (`codex debug models`) e guardada; só "Atualizar a lista"
 * abre o Codex de novo. Sem lista, a tela oferece só o padrão e "Outro…".
 */
import type { Hono } from 'hono';
import type pg from 'pg';
import { comTransacao } from '../db/transacao.js';
import type { Recurso } from '../recursos.js';
import { CATEGORIAS, ESFORCOS, nomeDoEsforco, padraoDaCategoria } from '../modelos/categorias.js';
import { buscarCatalogo, catalogoGuardado, guardarCatalogo, type CatalogoDeModelos } from '../modelos/catalogo.js';
import { gravarEscolhas, lerEscolhas, PreferenciaInvalida, type EscolhasDeModelo } from '../modelos/preferencias.js';
import { ErroDaApi } from './erros.js';

type ContextoDeCorpo = { req: { raw: Request } };

export interface ApoioDosModelos {
  banco: pg.Pool;
  corpoJson: (c: ContextoDeCorpo) => Promise<unknown>;
  recursos: ReadonlySet<Recurso>;
  /** Os testes trocam a busca (nenhum teste abre o Codex). */
  buscar?: () => Promise<CatalogoDeModelos | null>;
  ambiente?: NodeJS.ProcessEnv;
}

export function registrarRotasDosModelos(api: Hono, apoio: ApoioDosModelos): void {
  const { banco, corpoJson, recursos } = apoio;
  const buscar = apoio.buscar ?? (() => buscarCatalogo());
  const ambiente = apoio.ambiente ?? process.env;
  // Uma busca por vez: dois cliques em "Atualizar" não abrem dois Codex.
  let emCurso: Promise<CatalogoDeModelos | null> | undefined;
  const atualizar = (): Promise<CatalogoDeModelos | null> => {
    emCurso ??= (async () => {
      try {
        const catalogo = await buscar();
        if (catalogo !== null) await guardarCatalogo(banco, catalogo);
        return catalogo;
      } finally {
        emCurso = undefined;
      }
    })();
    return emCurso;
  };

  const resposta = (escolhas: EscolhasDeModelo, catalogo: CatalogoDeModelos | null) => ({
    categorias: CATEGORIAS.filter((categoria) => categoria.recurso === undefined || recursos.has(categoria.recurso)).map((categoria) => {
      const padrao = padraoDaCategoria(categoria, ambiente);
      return {
        id: categoria.id, rotulo: categoria.rotulo, descricao: categoria.descricao,
        padrao: { modelo: padrao.modelo, esforco: padrao.esforco, texto: padrao.texto },
        escolha: escolhas[categoria.id] ?? { modelo: null, esforco: null },
      };
    }),
    esforcos: ESFORCOS.map((id) => ({ id, rotulo: nomeDoEsforco(id) })),
    catalogo,
  });

  api.get('/api/configuracoes/modelos', async (c) => {
    const escolhas = await lerEscolhas(banco);
    // A primeira visita busca a lista; depois, só a guardada.
    const catalogo = await catalogoGuardado(banco) ?? await atualizar().catch(() => null);
    return c.json(resposta(escolhas, catalogo));
  });

  api.put('/api/configuracoes/modelos', async (c) => {
    const corpo = await corpoJson(c);
    if (typeof corpo !== 'object' || corpo === null || Array.isArray(corpo) || Object.keys(corpo).some((chave) => chave !== 'categorias')) {
      throw new ErroDaApi(400, 'corpo_invalido', 'Use { "categorias": { … } }.');
    }
    try {
      const escolhas = await comTransacao(banco, (cliente) => gravarEscolhas(cliente, (corpo as { categorias?: unknown }).categorias));
      return c.json(resposta(escolhas, await catalogoGuardado(banco)));
    } catch (erro) {
      if (erro instanceof PreferenciaInvalida) throw new ErroDaApi(422, 'preferencia_invalida', erro.message);
      throw erro;
    }
  });

  api.post('/api/configuracoes/modelos/atualizar', async (c) => {
    const catalogo = await atualizar().catch(() => null);
    if (catalogo === null) throw new ErroDaApi(502, 'sem_lista_de_modelos', 'O Codex não devolveu a lista de modelos. Confira se ele está instalado e com login.');
    return c.json(resposta(await lerEscolhas(banco), catalogo));
  });
}
