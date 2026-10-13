import { describe, expect, test } from 'vitest';
import { ErroDaApi } from '../biblioteca/api';
import { armazemLocal, chaveDoOnboarding } from './armazem';
import { posicionarDica } from './DicaAncorada';
import {
  ONBOARDING_INICIAL, TELAS_DAS_BOAS_VINDAS, concluidas, etapas, mostrarBoasVindas, mostrarTour, proximaEtapa,
  reduzirOnboarding, validarOnboarding, type AcaoDoOnboarding, type EstadoDoOnboarding,
} from './estado';
import { formularioDoExemplo, garantirExemplo, type FontesDoExemplo } from './exemplo';
import { comoInstalar, ehIos } from './instalacao';
import { integracoes } from './integracoes';

const AGORA = '2026-10-01T12:00:00.000Z';
const aplicar = (estado: EstadoDoOnboarding, ...acoes: AcaoDoOnboarding[]) => acoes.reduce((e, a) => reduzirOnboarding(e, a, AGORA), estado);

describe('sequência das boas-vindas', () => {
  test('avança tela a tela e conclui ao passar da última', () => {
    let e = aplicar(ONBOARDING_INICIAL, { tipo: 'avancar_tela' });
    expect(e.tela).toBe(1);
    expect(e.atualizado_em).toBe(AGORA);
    e = aplicar(e, { tipo: 'avancar_tela' });
    expect(e.tela).toBe(TELAS_DAS_BOAS_VINDAS - 1);
    expect(e.boas_vindas).toBe('pendente');
    e = aplicar(e, { tipo: 'avancar_tela' });
    expect(e.boas_vindas).toBe('concluida');
  });

  test('voltar na primeira tela não muda nada (nem a data)', () => {
    expect(reduzirOnboarding(ONBOARDING_INICIAL, { tipo: 'voltar_tela' }, AGORA)).toBe(ONBOARDING_INICIAL);
  });

  test('pular lembra a tela e não rebaixa o que já foi concluído', () => {
    const pulado = aplicar(ONBOARDING_INICIAL, { tipo: 'avancar_tela' }, { tipo: 'pular_boas_vindas' });
    expect(pulado.boas_vindas).toBe('pulada');
    expect(mostrarBoasVindas(pulado, false)).toBe(false);
    const concluido = aplicar(ONBOARDING_INICIAL, { tipo: 'concluir_boas_vindas' }, { tipo: 'pular_boas_vindas' });
    expect(concluido.boas_vindas).toBe('concluida');
  });

  test('rever reabre do começo', () => {
    const e = aplicar(ONBOARDING_INICIAL, { tipo: 'avancar_tela' }, { tipo: 'pular_boas_vindas' }, { tipo: 'rever_boas_vindas' });
    expect(e).toMatchObject({ boas_vindas: 'pendente', tela: 0 });
    expect(mostrarBoasVindas(e, false)).toBe(true);
    expect(mostrarBoasVindas(e, true)).toBe(false);
  });
});

describe('primeiro documento', () => {
  test('conta o primeiro só uma vez e sempre lembra o exemplo', () => {
    let e = aplicar(ONBOARDING_INICIAL, { tipo: 'registrar_documento', origem: 'importado', documento_id: 'DOC1' });
    expect(e.primeiro_documento).toEqual({ estado: 'concluida', origem: 'importado', documento_id: 'DOC1' });
    e = aplicar(e, { tipo: 'registrar_documento', origem: 'exemplo', documento_id: 'EX1' });
    expect(e.primeiro_documento.documento_id).toBe('DOC1');
    expect(e.exemplo_id).toBe('EX1');
  });

  test('registrar não fecha as boas-vindas (o exemplo ainda está sendo preparado)', () => {
    const e = aplicar(ONBOARDING_INICIAL, { tipo: 'registrar_documento', origem: 'exemplo', documento_id: 'EX1' });
    expect(e.boas_vindas).toBe('pendente');
  });
});

describe('tour do leitor', () => {
  test('avança, volta, conclui ao passar da última dica e pode ser revisto', () => {
    let e = aplicar(ONBOARDING_INICIAL, { tipo: 'avancar_dica', total: 3 }, { tipo: 'avancar_dica', total: 3 });
    expect(e.dica).toBe(2);
    e = aplicar(e, { tipo: 'voltar_dica' });
    expect(e.dica).toBe(1);
    e = aplicar(e, { tipo: 'avancar_dica', total: 3 }, { tipo: 'avancar_dica', total: 3 });
    expect(e).toMatchObject({ tour: 'concluida', dica: 0 });
    expect(mostrarTour(e)).toBe(false);
    e = aplicar(e, { tipo: 'rever_tour' });
    expect(mostrarTour(e)).toBe(true);
  });

  test('pular encerra sem perder um tour já concluído', () => {
    expect(aplicar(ONBOARDING_INICIAL, { tipo: 'avancar_dica', total: 5 }, { tipo: 'pular_tour' })).toMatchObject({ tour: 'pulada', dica: 0 });
    expect(aplicar(ONBOARDING_INICIAL, { tipo: 'concluir_tour' }, { tipo: 'pular_tour' }).tour).toBe('concluida');
  });
});

describe('etapas e retomada', () => {
  test('a próxima etapa é a primeira pendente; puladas não contam como feitas', () => {
    expect(proximaEtapa(ONBOARDING_INICIAL)).toBe('boas_vindas');
    const e = aplicar(ONBOARDING_INICIAL, { tipo: 'pular_boas_vindas' }, { tipo: 'registrar_documento', origem: 'exemplo', documento_id: 'EX1' });
    expect(proximaEtapa(e)).toBe('tour');
    expect(concluidas(e)).toBe(1);
    expect(etapas(e).map((x) => x.estado)).toEqual(['pulada', 'concluida', 'pendente', 'pendente']);
    const tudo = aplicar(e, { tipo: 'concluir_tour' }, { tipo: 'pular_levar' });
    expect(proximaEtapa(tudo)).toBeNull();
  });

  test('quem já usava o app não é recebido como estreante, mas só antes da primeira gravação', () => {
    const e = aplicar(ONBOARDING_INICIAL, { tipo: 'dispensar_por_uso_anterior' });
    expect(e).toMatchObject({ boas_vindas: 'pulada', tour: 'pulada', primeiro_documento: { estado: 'concluida', origem: 'uso_anterior' } });
    expect(e.levar).toBe('pendente');
    const jaComecou = aplicar(ONBOARDING_INICIAL, { tipo: 'avancar_tela' });
    expect(reduzirOnboarding(jaComecou, { tipo: 'dispensar_por_uso_anterior' }, AGORA)).toBe(jaComecou);
  });

  test('recomeçar volta ao início, mas não esquece o exemplo (para não duplicá-lo)', () => {
    const e = aplicar(ONBOARDING_INICIAL, { tipo: 'registrar_documento', origem: 'exemplo', documento_id: 'EX1' }, { tipo: 'concluir_tour' }, { tipo: 'recomecar' });
    expect(e).toMatchObject({ boas_vindas: 'pendente', tour: 'pendente', primeiro_documento: { estado: 'pendente' }, exemplo_id: 'EX1' });
  });
});

describe('validação e armazenamento', () => {
  test('valores desconhecidos voltam ao inicial campo a campo; outra versão volta ao inicial', () => {
    expect(validarOnboarding(null)).toEqual(ONBOARDING_INICIAL);
    expect(validarOnboarding({ ...ONBOARDING_INICIAL, versao: 2, tour: 'concluida' })).toEqual(ONBOARDING_INICIAL);
    const lido = validarOnboarding({ versao: 1, boas_vindas: 'talvez', tela: 99, tour: 'concluida', dica: -3, exemplo_id: '<script>', primeiro_documento: { estado: 'concluida', origem: 'hacker', documento_id: 'ABC' }, atualizado_em: 'ontem', extra: 1 });
    expect(lido).toEqual({ ...ONBOARDING_INICIAL, tela: TELAS_DAS_BOAS_VINDAS - 1, tour: 'concluida', primeiro_documento: { estado: 'concluida', origem: null, documento_id: 'ABC' } });
  });

  test('a chave é versionada e por usuário; o armazém sobrevive a JSON corrompido e a storage ausente', () => {
    expect(chaveDoOnboarding('local')).toBe('margem:onboarding:v1:local');
    const dados = new Map<string, string>();
    const storage = { getItem: (k: string) => dados.get(k) ?? null, setItem: (k: string, v: string) => { dados.set(k, v); } } as unknown as Storage;
    const leitor = armazemLocal('leitor', () => storage);
    const ana = armazemLocal('ana', () => storage);
    expect(leitor.ler()).toBeNull();
    const estado = aplicar(ONBOARDING_INICIAL, { tipo: 'concluir_boas_vindas' });
    leitor.gravar(estado);
    expect(leitor.ler()).toEqual(estado);
    expect(ana.ler()).toBeNull();
    dados.set(chaveDoOnboarding('ana'), '{quebrado');
    expect(ana.ler()).toBeNull();
    const semStorage = armazemLocal('x', () => { throw new Error('bloqueado'); });
    expect(semStorage.ler()).toBeNull();
    expect(() => semStorage.gravar(estado)).not.toThrow();
  });
});

describe('documento de exemplo', () => {
  const fontes = (existe: 'sim' | '404' | 'falha'): FontesDoExemplo & { enviados: FormData[] } => {
    const enviados: FormData[] = [];
    return {
      enviados,
      texto: () => Promise.resolve('# Um apólogo\n\nEra uma vez uma agulha.'),
      enviar: (dados) => { enviados.push(dados); return Promise.resolve({ documento_id: 'NOVO' }); },
      documento: (id) => existe === 'sim' ? Promise.resolve({ id, texto_disponivel: true, estado: 'pronto' })
        : Promise.reject(existe === '404' ? new ErroDaApi(404, 'nao_encontrado') : new ErroDaApi(500, 'falha')),
    };
  };

  test('o formulário é o mesmo de um Markdown colado na tela Adicionar', () => {
    const dados = formularioDoExemplo('texto');
    expect(Object.fromEntries(dados.entries())).toEqual({ formato: 'md', titulo: 'Um apólogo', autor: 'Machado de Assis', texto: 'texto' });
  });

  test('reaproveita o exemplo que ainda existe e recria o apagado', async () => {
    const existente = fontes('sim');
    expect(await garantirExemplo('EX1', existente)).toEqual({ documento_id: 'EX1', criado: false });
    expect(existente.enviados).toHaveLength(0);
    const apagado = fontes('404');
    expect(await garantirExemplo('EX1', apagado)).toEqual({ documento_id: 'NOVO', criado: true });
    expect(apagado.enviados).toHaveLength(1);
  });

  test('uma falha que não é 404 não cria cópia', async () => {
    const falha = fontes('falha');
    await expect(garantirExemplo('EX1', falha)).rejects.toThrow();
    expect(falha.enviados).toHaveLength(0);
  });

  test('o texto do exemplo vem do repositório e é o conto inteiro', async () => {
    const { textoDoExemplo } = await import('./exemplo');
    const texto = await textoDoExemplo();
    expect(texto.startsWith('# Um apólogo\n\nEra uma vez uma agulha')).toBe(true);
    expect(texto.trim().endsWith('Também eu tenho servido de agulha a muita linha ordinária!')).toBe(true);
  });
});

describe('instalação e integrações', () => {
  const base = { standalone: false, userAgent: 'Mozilla/5.0 (X11; Linux x86_64) Chrome/140', plataforma: 'Linux x86_64', toques: 0, pedido: false };
  test('escolhe o caminho de instalação certo', () => {
    expect(comoInstalar({ ...base, standalone: true, pedido: true })).toBe('instalado');
    expect(comoInstalar({ ...base, pedido: true })).toBe('pedido');
    expect(comoInstalar({ ...base, userAgent: 'Mozilla/5.0 (iPhone; CPU iPhone OS 19_0 like Mac OS X) Safari' })).toBe('ios');
    expect(comoInstalar(base)).toBe('manual');
  });

  test('iPad com o agente de Mac é reconhecido pelos toques', () => {
    expect(ehIos('Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) Safari', 'MacIntel', 5)).toBe(true);
    expect(ehIos('Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) Safari', 'MacIntel', 0)).toBe(false);
  });

  test('extensão e Obsidian só ganham link externo com um endereço https configurado', () => {
    expect(integracoes({}).map((i) => i.link)).toEqual([null, null]);
    const configuradas = integracoes({ VITE_MARGEM_EXTENSAO_URL: 'https://exemplo.org/extensao', VITE_MARGEM_OBSIDIAN_URL: 'javascript:alert(1)' });
    expect(configuradas.map((i) => i.link)).toEqual(['https://exemplo.org/extensao', null]);
  });
});

describe('posição da dica ancorada', () => {
  const janela = { largura: 1680, altura: 1050 };
  test('prefere abaixo do alvo, com a seta apontando para o centro dele', () => {
    const p = posicionarDica({ x: 1500, y: 20, largura: 40, altura: 40 }, { largura: 360, altura: 200 }, janela);
    expect(p.lado).toBe('abaixo');
    expect(p.y).toBe(72);
    expect(p.x + 360).toBeLessThanOrEqual(janela.largura - 12);
    expect(p.x + (p.seta ?? 0)).toBe(1520);
  });

  test('sem espaço embaixo vai para cima; sem alvo ou em tela estreita vira folha', () => {
    expect(posicionarDica({ x: 100, y: 900, largura: 200, altura: 40 }, { largura: 360, altura: 200 }, janela).lado).toBe('acima');
    expect(posicionarDica(null, { largura: 360, altura: 200 }, janela).lado).toBe('folha');
    expect(posicionarDica({ x: 10, y: 10, largura: 10, altura: 10 }, { largura: 360, altura: 200 }, { largura: 390, altura: 844 }).lado).toBe('folha');
  });

  test('um alvo que ocupa a tela toda deixa a dica dentro da janela', () => {
    const p = posicionarDica({ x: 400, y: 0, largura: 850, altura: 1050 }, { largura: 360, altura: 200 }, janela);
    expect(p.y).toBeGreaterThanOrEqual(12);
    expect(p.y + 200).toBeLessThanOrEqual(janela.altura - 12);
  });
});

describe('rotas dos primeiros passos', () => {
  test('primeiros passos, ajuda e adicionar com texto colado vão e voltam pelo caminho', async () => {
    const { caminhoDaRota, rotaDoCaminho } = await import('../biblioteca/rotas');
    for (const rota of [{ nome: 'primeiros-passos' }, { nome: 'ajuda', pagina: 'obsidian' }, { nome: 'adicionar', entrada: 'colado' }, { nome: 'adicionar' }] as const) {
      expect(rotaDoCaminho(caminhoDaRota(rota))).toEqual(rota);
    }
    expect(rotaDoCaminho('/ajuda/inexistente')).toEqual({ nome: 'inicio' });
  });
});
