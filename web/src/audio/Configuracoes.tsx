/**
 * Configurações → Áudio (J106): a chave da ElevenLabs da pessoa, o teste da chave, a voz (vozes da
 * conta) e o modelo. A chave nunca volta do servidor: a tela só sabe se há uma e como ela termina.
 */
import { useCallback, useEffect, useState, type ReactNode } from 'react';
import { ErroDaApi } from '../biblioteca/api';
import { Icon } from '../ui/Icon';
import { Button, Input, Select } from '../ui/Primitives';
import {
  apagarChaveDeAudio, gravarChaveDeAudio, gravarPreferenciasDeAudio, lerConfiguracaoDeAudio, listarVozesDaConta, numero, testarChaveDeAudio,
  type ConfiguracaoDeAudio, type VozDaConta,
} from './api';
import './audio.css';

const mensagem = (erro: unknown, padrao: string): string => erro instanceof ErroDaApi ? erro.detalhe ?? padrao : padrao;

export function Configuracoes(): ReactNode {
  useEffect(() => { document.title = 'Configurações · Margem'; }, []);
  return <article className="configuracoes">
    <h1 className="page-title">Configurações</h1>
    <ConfiguracaoDoAudio />
  </article>;
}

type Aviso = { tipo: 'ok' | 'erro'; texto: string } | null;
type Vozes = { estado: 'carregando' } | { estado: 'erro'; texto: string } | { estado: 'pronto'; vozes: VozDaConta[] };

export function ConfiguracaoDoAudio(): ReactNode {
  const [config, definirConfig] = useState<ConfiguracaoDeAudio | null>(null);
  const [falhaAoCarregar, falharAoCarregar] = useState(false);
  const [chave, definirChave] = useState('');
  const [trocando, trocar] = useState(false);
  const [ocupado, ocupar] = useState(false);
  const [aviso, avisar] = useState<Aviso>(null);
  const [vozes, definirVozes] = useState<Vozes>({ estado: 'carregando' });

  useEffect(() => { lerConfiguracaoDeAudio().then(definirConfig, () => falharAoCarregar(true)); }, []);
  const configurada = config?.chave.configurada === true;
  const carregarVozes = useCallback(() => {
    definirVozes({ estado: 'carregando' });
    listarVozesDaConta().then((r) => definirVozes({ estado: 'pronto', vozes: r.vozes }), (e: unknown) => definirVozes({ estado: 'erro', texto: mensagem(e, 'Não foi possível listar as vozes.') }));
  }, []);
  useEffect(() => { if (configurada) carregarVozes(); }, [configurada, carregarVozes]);

  const acao = async (fazer: () => Promise<void>): Promise<void> => {
    ocupar(true); avisar(null);
    try { await fazer(); } finally { ocupar(false); }
  };
  const salvar = () => acao(async () => {
    try {
      definirConfig(await gravarChaveDeAudio(chave.trim()));
      definirChave(''); trocar(false);
      avisar({ tipo: 'ok', texto: 'Chave guardada neste computador.' });
    } catch (e) { avisar({ tipo: 'erro', texto: mensagem(e, 'Não foi possível guardar a chave.') }); }
  });
  const testar = () => acao(async () => {
    try {
      const r = await testarChaveDeAudio(chave.trim() || undefined);
      avisar({ tipo: 'ok', texto: r.creditos_restantes === undefined ? 'A chave funciona.' : `A chave funciona. Restam ${numero(r.creditos_restantes)} créditos na conta.` });
    } catch (e) { avisar({ tipo: 'erro', texto: mensagem(e, 'Não foi possível testar a chave.') }); }
  });
  const remover = () => acao(async () => {
    try { definirConfig(await apagarChaveDeAudio()); trocar(false); avisar({ tipo: 'ok', texto: 'Chave removida deste computador.' }); }
    catch (e) { avisar({ tipo: 'erro', texto: mensagem(e, 'Não foi possível remover a chave.') }); }
  });
  const preferir = (mudanca: { voz_id?: string | null; voz_nome?: string | null; modelo_id?: string }) => {
    if (!config) return;
    void acao(async () => {
      try {
        definirConfig(await gravarPreferenciasDeAudio({
          voz_id: mudanca.voz_id !== undefined ? mudanca.voz_id : config.voz?.id ?? null,
          voz_nome: mudanca.voz_nome !== undefined ? mudanca.voz_nome : config.voz?.nome ?? null,
          modelo_id: mudanca.modelo_id ?? config.modelo_id,
        }));
      } catch (e) { avisar({ tipo: 'erro', texto: mensagem(e, 'Não foi possível guardar a escolha.') }); }
    });
  };

  if (falhaAoCarregar) return <section className="card configuracao-do-audio"><h2>Áudio</h2><p className="aviso" role="alert">Não foi possível ler a configuração do áudio.</p></section>;
  if (!config) return <section className="card configuracao-do-audio" aria-busy="true"><h2>Áudio</h2></section>;
  const modelo = config.modelos.find((m) => m.id === config.modelo_id);
  const pedirChave = !configurada || trocando;

  return <section className="card formulario configuracao-do-audio" id="audio" aria-labelledby="titulo-do-audio">
    <div className="cabeca-da-secao">
      <h2 id="titulo-do-audio">Áudio</h2>
      <p className="secundario">Gere a narração de capítulos e trechos com a sua conta da ElevenLabs. É opcional, e o custo vai direto para a sua conta.</p>
    </div>
    {pedirChave
      ? <label>Chave da API da ElevenLabs
        <Input type="password" value={chave} autoComplete="off" spellCheck={false} placeholder="sk_…" disabled={ocupado}
          onChange={(e) => definirChave(e.target.value)} onKeyDown={(e) => { if (e.key === 'Enter' && chave.trim()) void salvar(); }} />
      </label>
      : <div className="chave-guardada">
        <span><span className="rotulo-do-campo">Chave da API da ElevenLabs</span><span className="valor-da-chave">Configurada · termina em <code>{config.chave.final}</code></span></span>
        <span className="button-row"><Button variante="ghost" className="small" disabled={ocupado} onClick={() => { trocar(true); avisar(null); }}>Trocar</Button><Button variante="ghost" className="small" disabled={ocupado} onClick={() => void remover()}>Remover</Button></span>
      </div>}
    <p className="nota-da-chave"><Icon name="info" size={16} /><span>{config.guardada}</span></p>
    <div className="button-row">
      {pedirChave && <Button variante="primario" disabled={ocupado || chave.trim() === ''} onClick={() => void salvar()}>Salvar chave</Button>}
      <Button disabled={ocupado || (pedirChave && chave.trim() === '' && !configurada)} onClick={() => void testar()}>Testar chave</Button>
      {trocando && <Button variante="ghost" disabled={ocupado} onClick={() => { trocar(false); definirChave(''); }}>Cancelar</Button>}
    </div>
    {aviso && <p className={aviso.tipo === 'erro' ? 'aviso' : 'situacao-da-narracao'} role={aviso.tipo === 'erro' ? 'alert' : 'status'}>{aviso.texto}</p>}
    {!configurada && <p className="secundario">Crie a chave em elevenlabs.io → Developers → API Keys, com permissão de <strong>Text to Speech</strong> e de leitura de <strong>Voices</strong>.</p>}
    {configurada && <div className="dupla">
      <label>Voz
        {vozes.estado === 'pronto'
          ? <Select aria-label="Voz" value={config.voz?.id ?? ''} disabled={ocupado} onChange={(e) => {
            const voz = vozes.vozes.find((v) => v.id === e.target.value);
            preferir(voz ? { voz_id: voz.id, voz_nome: voz.nome } : { voz_id: null, voz_nome: null });
          }}>
            <option value="">Escolha uma voz</option>
            {config.voz && !vozes.vozes.some((v) => v.id === config.voz?.id) && <option value={config.voz.id}>{config.voz.nome ?? config.voz.id}</option>}
            {vozes.vozes.map((v) => <option key={v.id} value={v.id}>{`${v.nome}${v.categoria === 'cloned' ? ' (clonada)' : ''}`}</option>)}
          </Select>
          : <Input aria-label="Voz" readOnly value={vozes.estado === 'carregando' ? 'Carregando as vozes da conta…' : config.voz?.nome ?? '—'} />}
      </label>
      <label>Modelo
        <Select aria-label="Modelo" value={config.modelo_id} disabled={ocupado} onChange={(e) => preferir({ modelo_id: e.target.value })}>
          {config.modelos.map((m) => <option key={m.id} value={m.id}>{m.nome}</option>)}
        </Select>
      </label>
    </div>}
    {configurada && vozes.estado === 'erro' && <p className="aviso" role="alert">{vozes.texto} <Button variante="ghost" className="small" onClick={carregarVozes}>Tentar de novo</Button></p>}
    {configurada && modelo && <p className="secundario">{modelo.creditos_por_caractere === 1 ? '1 crédito' : `${String(modelo.creditos_por_caractere).replace('.', ',')} crédito`} por caractere; no uso pago da API, cerca de US$ {modelo.usd_por_mil.toFixed(2).replace('.', ',')} por mil caracteres. Antes de cada narração o Margem mostra a estimativa e pede confirmação.</p>}
  </section>;
}
