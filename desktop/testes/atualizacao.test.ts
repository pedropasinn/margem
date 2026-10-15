/**
 * Atualização automática silenciosa (V-W6, auditoria B-05). A mensagem é a que o electron-updater
 * deu no teste de 14/10, com a pilha e os cabeçalhos da resposta do GitHub.
 */
import { describe, expect, it, vi } from 'vitest';
import {
  INTERVALO_DEPOIS_DE_FALHA_MS, INTERVALO_NORMAL_MS, PRIMEIRA_PROCURA_MS, classificarErroDeAtualizacao, criarControleDaAtualizacao,
  criarMaquinaDaAtualizacao, deveNotificar, feedDoPacote, linhaDoRegistro, motivoCurto, notasDoRelease, proximoEstado,
  type EstadoDaAtualizacao,
} from '../src/nucleo/atualizacao.js';

const ERRO_DO_TESTE = [
  'HttpError: 404 ',
  '"method: GET url: https://github.com/pedropasinn/margem/releases.atom\\n\\nPlease double check that your authentication token is correct."',
  'Headers: {',
  '  "cache-control": "no-cache",',
  '  "set-cookie": ["_gh_sess=segredo; path=/; secure; HttpOnly"],',
  '}',
  '    at createHttpError (C:\\Users\\usuario\\AppData\\Local\\Programs\\margem\\resources\\app.asar\\node_modules\\builder-util-runtime\\out\\httpExecutor.js:20:12)',
].join('\n');

describe('atualização automática', () => {
  it('feed: sem o campo é o GitHub de antes; "desligada" e URL https', () => {
    expect(feedDoPacote({ version: '0.1.0' })).toEqual({ tipo: 'github' });
    expect(feedDoPacote({ margem: { atualizacao: 'desligada' } })).toEqual({ tipo: 'desligada' });
    expect(feedDoPacote({ margem: { atualizacao: 'https://margem.dev/atualizacoes/' } })).toEqual({ tipo: 'generic', url: 'https://margem.dev/atualizacoes/' });
    expect(feedDoPacote({ margem: { atualizacao: 'http://inseguro/' } })).toEqual({ tipo: 'desligada' });
    expect(feedDoPacote({ margem: { atualizacao: 'github' } })).toEqual({ tipo: 'github' });
    expect(feedDoPacote(null)).toEqual({ tipo: 'github' });
  });

  it('classifica: sem versão publicada, sem rede, outro', () => {
    expect(classificarErroDeAtualizacao(ERRO_DO_TESTE)).toBe('sem_versao');
    expect(classificarErroDeAtualizacao('No published versions on GitHub')).toBe('sem_versao');
    expect(classificarErroDeAtualizacao('Cannot find latest.yml in the latest release artifacts')).toBe('sem_versao');
    expect(classificarErroDeAtualizacao('getaddrinfo ENOTFOUND github.com')).toBe('sem_rede');
    expect(classificarErroDeAtualizacao('net::ERR_INTERNET_DISCONNECTED')).toBe('sem_rede');
    expect(classificarErroDeAtualizacao('sha512 checksum mismatch')).toBe('outro');
  });

  it('o registro leva só a primeira linha, sem pilha, cabeçalho nem cookie', () => {
    expect(linhaDoRegistro(ERRO_DO_TESTE)).toBe('HttpError: 404');
    expect(linhaDoRegistro(new Error('falhou\n    at x (y.js:1:1)'))).toBe('falhou');
    expect(linhaDoRegistro('set-cookie: a=b')).toBe('set-cookie: [redigido]');
    expect(linhaDoRegistro('GET https://x/latest.yml?token=abc&v=1')).toBe('GET https://x/latest.yml?token=[redigido]&v=1');
    expect(linhaDoRegistro('x'.repeat(500))).toHaveLength(200);
  });

  it('sem versão: um evento info por execução, nenhum aviso automático, espera de 24 h', () => {
    const controle = criarControleDaAtualizacao();
    const primeira = controle.aoFalhar(ERRO_DO_TESTE, false);
    expect(primeira).toEqual({ evento: { nome: 'atualizacao_indisponivel', dados: { motivo: 'sem_versao' } }, aviso: null, proximaMs: INTERVALO_DEPOIS_DE_FALHA_MS });
    expect(JSON.stringify(primeira)).not.toContain('segredo');
    // A segunda procura da mesma execução não registra de novo.
    expect(controle.aoFalhar(ERRO_DO_TESTE, false).evento).toBeNull();
    // Pedida pela pessoa: a caixa diz o motivo em vez de "Não foi possível procurar".
    expect(controle.aoFalhar(ERRO_DO_TESTE, true).aviso).toBe('Ainda não há versões publicadas do Margem para atualizar.');
    expect(controle.aoFalhar('getaddrinfo ENOTFOUND github.com', true)).toMatchObject({
      evento: { nome: 'atualizacao_indisponivel', dados: { motivo: 'sem_rede' } }, aviso: expect.stringMatching(/^Sem conexão/) as unknown,
    });
    expect(controle.aoFalhar('sha512 checksum mismatch\n  at z', false).evento).toEqual({ nome: 'atualizacao_falhou', dados: { mensagem: 'sha512 checksum mismatch' } });
    expect(controle.aoTerminarBem()).toBe(INTERVALO_NORMAL_MS);
    expect(INTERVALO_DEPOIS_DE_FALHA_MS).toBeGreaterThan(INTERVALO_NORMAL_MS);
  });

  it('estado mostrado no app (J146): procurar, baixar, pronta, falha', () => {
    const agora = new Date('2026-10-14T15:00:00Z');
    let estado: EstadoDaAtualizacao = { estado: 'ociosa' };
    estado = proximoEstado(estado, { tipo: 'procurar' });
    expect(estado).toEqual({ estado: 'procurando' });
    expect(proximoEstado(estado, { tipo: 'sem_novidade' }, agora)).toEqual({ estado: 'atualizada', quando: agora.toISOString() });
    estado = proximoEstado(estado, { tipo: 'disponivel', versao: '0.2.0', baixa: true });
    expect(estado).toEqual({ estado: 'baixando', versao: '0.2.0', porcentagem: 0, notas: null, pedida: false });
    estado = proximoEstado(estado, { tipo: 'progresso', porcentagem: 41.7 });
    expect(estado).toEqual({ estado: 'baixando', versao: '0.2.0', porcentagem: 41, notas: null, pedida: false });
    // Uma procura no meio do download não zera a barra.
    expect(proximoEstado(estado, { tipo: 'procurar' })).toBe(estado);
    expect(proximoEstado(estado, { tipo: 'progresso', porcentagem: 250 })).toMatchObject({ porcentagem: 100 });
    estado = proximoEstado(estado, { tipo: 'baixada', versao: '0.2.0' });
    expect(estado).toEqual({ estado: 'pronta', versao: '0.2.0', notas: null });
    // Pronta só sai para outra versão pronta: a procura de 6 em 6 h não apaga o "Reiniciar e atualizar".
    for (const evento of [{ tipo: 'procurar' }, { tipo: 'sem_novidade' }, { tipo: 'falhou', mensagem: 'ENOTFOUND' }] as const) {
      expect(proximoEstado(estado, evento)).toBe(estado);
    }
    expect(proximoEstado(estado, { tipo: 'baixada', versao: '0.3.0' })).toEqual({ estado: 'pronta', versao: '0.3.0', notas: null });
    // macOS sem assinatura: só avisa que há versão nova.
    expect(proximoEstado({ estado: 'procurando' }, { tipo: 'disponivel', versao: '0.2.0', baixa: false })).toEqual({ estado: 'manual', versao: '0.2.0', notas: null });
    expect(proximoEstado({ estado: 'procurando' }, { tipo: 'falhou', mensagem: ERRO_DO_TESTE })).toEqual({ estado: 'indisponivel', motivo: 'Ainda não há versões publicadas.', versao: null, pedida: false });
    const desligada: EstadoDaAtualizacao = { estado: 'desligada', motivo: 'sem_feed' };
    expect(proximoEstado(desligada, { tipo: 'procurar' })).toBe(desligada);
    expect(motivoCurto('getaddrinfo EAI_AGAIN margem.dev')).toBe('Sem conexão com a internet.');
    expect(motivoCurto('sha512 checksum mismatch')).toBe('Não foi possível procurar agora.');
    expect(JSON.stringify(proximoEstado({ estado: 'ociosa' }, { tipo: 'falhou', mensagem: ERRO_DO_TESTE }))).not.toContain('segredo');
  });

  it('falha no download guarda a versão e diz que não deu para baixar', () => {
    const baixando: EstadoDaAtualizacao = { estado: 'baixando', versao: '0.2.0', porcentagem: 30, notas: null, pedida: false };
    expect(proximoEstado(baixando, { tipo: 'falhou', mensagem: 'sha512 checksum mismatch' }))
      .toEqual({ estado: 'indisponivel', motivo: 'Não foi possível baixar a versão nova.', versao: '0.2.0', pedida: false });
    expect(proximoEstado(baixando, { tipo: 'falhou', mensagem: 'net::ERR_INTERNET_DISCONNECTED' })).toMatchObject({ motivo: 'Sem conexão com a internet.' });
    // Sem download automático: fica "disponível" até a pessoa pedir.
    const disponivel = proximoEstado({ estado: 'procurando' }, { tipo: 'disponivel', versao: '0.2.0', baixa: true, sozinho: false, notas: 'Leitor mais rápido.' });
    expect(disponivel).toEqual({ estado: 'disponivel', versao: '0.2.0', notas: 'Leitor mais rápido.' });
    expect(proximoEstado(disponivel, { tipo: 'comecar_download' })).toEqual({ estado: 'baixando', versao: '0.2.0', porcentagem: 0, notas: 'Leitor mais rápido.', pedida: false });
  });

  it('notas do release: uma linha, sem HTML nem marcação', () => {
    expect(notasDoRelease(null)).toBeNull();
    expect(notasDoRelease('')).toBeNull();
    expect(notasDoRelease('<h2>Novidades</h2><ul><li>Leitor <b>mais rápido</b></li></ul>')).toBe('Novidades');
    expect(notasDoRelease('- Aviso de atualização ao abrir &amp; notificação\n- outra')).toBe('Aviso de atualização ao abrir & notificação');
    expect(notasDoRelease([{ version: '0.2.0', note: '## Marcações em PDF' }])).toBe('Marcações em PDF');
    expect(notasDoRelease('x'.repeat(300))).toHaveLength(140);
  });

  it('procura logo ao abrir e depois de 6 em 6 h', () => {
    expect(PRIMEIRA_PROCURA_MS).toBeLessThanOrEqual(5_000);
    expect(INTERVALO_NORMAL_MS).toBe(6 * 60 * 60 * 1000);
  });
});

describe('Atualizar agora (J151)', () => {
  function maquina(inicial?: EstadoDaAtualizacao) {
    const acoes = { procurar: vi.fn(), baixar: vi.fn(), instalar: vi.fn(), abrirSite: vi.fn() };
    const mudancas: EstadoDaAtualizacao[] = [];
    const m = criarMaquinaDaAtualizacao({ acoes, aoMudar: (e) => { mudancas.push(e); }, inicial, agora: () => new Date('2026-10-15T12:00:00Z') });
    return { m, acoes, mudancas };
  }

  it('já baixada: instala na hora', () => {
    const { m, acoes } = maquina({ estado: 'pronta', versao: '0.2.0', notas: null });
    m.atualizarAgora();
    expect(acoes.instalar).toHaveBeenCalledOnce();
  });

  it('durante o download: mostra o pedido, segue a porcentagem e instala ao terminar', () => {
    const { m, acoes, mudancas } = maquina();
    m.receber({ tipo: 'procurar' });
    m.receber({ tipo: 'disponivel', versao: '0.2.0', baixa: true });
    m.receber({ tipo: 'progresso', porcentagem: 12 });
    m.atualizarAgora();
    expect(acoes.instalar).not.toHaveBeenCalled();
    expect(m.estado()).toEqual({ estado: 'baixando', versao: '0.2.0', porcentagem: 12, notas: null, pedida: true });
    m.receber({ tipo: 'progresso', porcentagem: 87.5 });
    expect(m.estado()).toMatchObject({ porcentagem: 87, pedida: true });
    m.receber({ tipo: 'baixada', versao: '0.2.0' });
    expect(m.estado()).toEqual({ estado: 'pronta', versao: '0.2.0', notas: null });
    expect(acoes.instalar).toHaveBeenCalledOnce();
    expect(mudancas.at(-1)).toEqual({ estado: 'pronta', versao: '0.2.0', notas: null });
  });

  it('sem pedido, o download termina e só fica pronta (instala ao fechar)', () => {
    const { m, acoes } = maquina({ estado: 'baixando', versao: '0.2.0', porcentagem: 50, notas: null, pedida: false });
    m.receber({ tipo: 'baixada', versao: '0.2.0' });
    expect(m.estado().estado).toBe('pronta');
    expect(acoes.instalar).not.toHaveBeenCalled();
  });

  it('"Depois" durante o download desfaz o pedido', () => {
    const { m, acoes } = maquina({ estado: 'baixando', versao: '0.2.0', porcentagem: 50, notas: null, pedida: false });
    m.atualizarAgora();
    m.adiar();
    expect(m.estado()).toMatchObject({ pedida: false });
    m.receber({ tipo: 'baixada', versao: '0.2.0' });
    expect(acoes.instalar).not.toHaveBeenCalled();
  });

  it('download não começou: começa, com o pedido marcado', () => {
    const { m, acoes } = maquina({ estado: 'disponivel', versao: '0.2.0', notas: null });
    m.atualizarAgora();
    expect(acoes.baixar).toHaveBeenCalledOnce();
    expect(m.estado()).toEqual({ estado: 'baixando', versao: '0.2.0', porcentagem: 0, notas: null, pedida: true });
    m.receber({ tipo: 'baixada', versao: '0.2.0' });
    expect(acoes.instalar).toHaveBeenCalledOnce();
  });

  it('macOS sem assinatura e cópia sem atualização: abre o site', () => {
    const mac = maquina({ estado: 'manual', versao: '0.2.0', notas: null });
    mac.m.atualizarAgora();
    expect(mac.acoes.abrirSite).toHaveBeenCalledOnce();
    expect(mac.acoes.instalar).not.toHaveBeenCalled();
    const desligada = maquina({ estado: 'desligada', motivo: 'sem_feed' });
    desligada.m.atualizarAgora();
    expect(desligada.acoes.abrirSite).toHaveBeenCalledOnce();
  });

  it('falha: o aviso sabe que foi pedida; "Tentar de novo" procura e reinicia ao terminar; uma falha derruba o pedido', () => {
    const { m, acoes } = maquina({ estado: 'baixando', versao: '0.2.0', porcentagem: 50, notas: null, pedida: false });
    m.atualizarAgora();
    m.receber({ tipo: 'falhou', mensagem: 'getaddrinfo ENOTFOUND margem.dev' });
    expect(m.estado()).toEqual({ estado: 'indisponivel', motivo: 'Sem conexão com a internet.', versao: '0.2.0', pedida: true });
    // A procura automática de 24 h depois não reinicia o app sozinha.
    m.receber({ tipo: 'procurar' });
    m.receber({ tipo: 'disponivel', versao: '0.2.0', baixa: true });
    m.receber({ tipo: 'baixada', versao: '0.2.0' });
    expect(acoes.instalar).not.toHaveBeenCalled();
    // Tentar de novo a partir da falha.
    const outra = maquina({ estado: 'indisponivel', motivo: 'x', versao: '0.2.0', pedida: false });
    outra.m.atualizarAgora();
    expect(outra.acoes.procurar).toHaveBeenCalledOnce();
    outra.m.receber({ tipo: 'procurar' });
    outra.m.receber({ tipo: 'disponivel', versao: '0.2.0', baixa: true });
    expect(outra.m.estado()).toMatchObject({ estado: 'baixando', pedida: true });
    outra.m.receber({ tipo: 'baixada', versao: '0.2.0' });
    expect(outra.acoes.instalar).toHaveBeenCalledOnce();
  });

  it('pedida no macOS: a procura acha versão nova e manda para o site', () => {
    const { m, acoes } = maquina({ estado: 'atualizada', quando: '2026-10-15T10:00:00Z' });
    m.atualizarAgora();
    expect(acoes.procurar).toHaveBeenCalledOnce();
    m.receber({ tipo: 'disponivel', versao: '0.2.0', baixa: false });
    expect(acoes.abrirSite).toHaveBeenCalledOnce();
    expect(m.estado()).toEqual({ estado: 'manual', versao: '0.2.0', notas: null });
  });

  it('notificação do sistema: só pronta, fora de foco e uma vez por versão', () => {
    const pronta: EstadoDaAtualizacao = { estado: 'pronta', versao: '0.2.0', notas: null };
    expect(deveNotificar(pronta, null, false)).toBe(true);
    expect(deveNotificar(pronta, null, true)).toBe(false);
    expect(deveNotificar(pronta, '0.2.0', false)).toBe(false);
    expect(deveNotificar(pronta, '0.1.9', false)).toBe(true);
    expect(deveNotificar({ estado: 'baixando', versao: '0.2.0', porcentagem: 3, notas: null, pedida: false }, null, false)).toBe(false);
  });
});
