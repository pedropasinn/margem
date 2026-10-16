/**
 * Configurações → "Chave para a extensão e o Obsidian" (S-01). Só no app de computador: a chave local que a
 * API exige, para colar no campo Token das opções da extensão do navegador e do plugin do Obsidian. A tela
 * mostra só o final; "Copiar" leva a chave inteira.
 */
import { useEffect, useState, type ReactNode } from 'react';
import { Icon } from '../ui/Icon';
import { Button } from '../ui/Primitives';
import { ponteDaChave, type PonteDaChave } from './chave-local';
import './seguranca.css';

export function ChaveParaIntegracoes({ ponte = ponteDaChave() }: { ponte?: PonteDaChave | null } = {}): ReactNode {
  const [chave, definirChave] = useState<string | null>(null);
  const [falhou, falhar] = useState(false);
  const [aviso, avisar] = useState<{ tipo: 'ok' | 'erro'; texto: string } | null>(null);
  useEffect(() => {
    if (ponte === null) return;
    ponte().then(definirChave, () => falhar(true));
  }, [ponte]);
  if (ponte === null) return null;
  const copiar = () => {
    if (chave === null) return;
    navigator.clipboard.writeText(chave).then(
      () => avisar({ tipo: 'ok', texto: 'Chave copiada.' }),
      () => avisar({ tipo: 'erro', texto: 'Não foi possível copiar a chave.' }),
    );
  };
  return <section className="card formulario chave-para-integracoes" id="chave" aria-labelledby="titulo-da-chave" aria-busy={chave === null && !falhou}>
    <div className="cabeca-da-secao">
      <h2 id="titulo-da-chave">Chave para a extensão e o Obsidian</h2>
      <p className="secundario">A extensão do navegador e o plugin do Obsidian precisam desta chave para falar com a sua biblioteca. Cole-a no campo Token das opções de cada um.</p>
    </div>
    {falhou
      ? <p className="aviso" role="alert">Não foi possível ler a chave deste computador.</p>
      : <div className="chave-guardada">
        <span><span className="rotulo-do-campo">Chave</span><span className="valor-da-chave">{chave === null ? '…' : <>Termina em <code>{chave.slice(-4)}</code></>}</span></span>
        <span className="button-row"><Button className="small" disabled={chave === null} onClick={copiar}>Copiar</Button></span>
      </div>}
    <p className="nota-da-chave"><Icon name="info" size={16} /><span>Ela fica só neste computador, fora da pasta da biblioteca. Não a compartilhe: com ela, qualquer programa lê e altera a biblioteca.</span></p>
    {aviso && <p className={aviso.tipo === 'erro' ? 'aviso' : 'situacao-da-chave'} role={aviso.tipo === 'erro' ? 'alert' : 'status'}>{aviso.texto}</p>}
  </section>;
}
