/**
 * A janela que confirma um apagamento (V-T8): diz o que vai sair, com a contagem, e espera a pessoa.
 * Apagar não se desfaz; "Apagar tudo" pede ainda a frase digitada. Serve a um item (um grifo, uma
 * relação, um mapa…) e aos lotes do documento ou do capítulo.
 */
import { useRef, useState, type ReactNode } from 'react';
import { mensagemDeErro } from '../biblioteca/erros';
import { Button, Input, usarFoco } from '../ui/Primitives';
import { Icon } from '../ui/Icon';
import './apagar.css';

export interface PropsDaConfirmacao {
  titulo: string;
  /** O que será apagado, uma linha por tipo (ex.: "12 grifos"); vazio mostra `vazio`. */
  itens?: readonly string[];
  /** Frase de explicação curta acima da lista. */
  texto?: ReactNode;
  /** Quando não há nada a apagar. */
  vazio?: string;
  /** Enquanto a contagem chega. */
  carregando?: boolean;
  /** A frase que a pessoa precisa digitar para liberar o botão. */
  exigirFrase?: string;
  rotuloDoBotao?: string;
  aoConfirmar: () => Promise<void>;
  aoFechar: () => void;
}

export function ConfirmarApagar({
  titulo, itens, texto, vazio = 'Não há nada para apagar aqui.', carregando = false, exigirFrase, rotuloDoBotao = 'Apagar', aoConfirmar, aoFechar,
}: PropsDaConfirmacao): ReactNode {
  const raiz = useRef<HTMLDivElement>(null);
  usarFoco(raiz, aoFechar);
  const [frase, definirFrase] = useState('');
  const [ocupado, ocupar] = useState(false);
  const [falha, definirFalha] = useState<string | null>(null);
  const nada = itens !== undefined && itens.length === 0;
  const liberado = !carregando && !nada && !ocupado && (exigirFrase === undefined || frase.trim().toLocaleLowerCase('pt-BR') === exigirFrase);
  async function confirmar() {
    ocupar(true); definirFalha(null);
    try { await aoConfirmar(); aoFechar(); }
    catch (erro) { definirFalha(mensagemDeErro(erro, 'Não foi possível apagar.')); ocupar(false); }
  }
  return <div className="ui-veu veu-do-apagar">
    <div ref={raiz} role="alertdialog" aria-modal="true" aria-labelledby="titulo-do-apagar" aria-describedby="texto-do-apagar" tabIndex={-1} className="dialogo-de-apagar">
      <h2 id="titulo-do-apagar"><Icon name="lixeira" size={18} />{titulo}</h2>
      <div id="texto-do-apagar" className="texto-do-apagar">
        {texto && <p>{texto}</p>}
        {carregando ? <p className="dados">Contando…</p>
          : nada ? <p className="dados">{vazio}</p>
            : itens && <ul className="lista-do-apagar">{itens.map((item) => <li key={item}>{item}</li>)}</ul>}
        {!nada && <p className="aviso-do-apagar">Isto não pode ser desfeito.</p>}
      </div>
      {exigirFrase !== undefined && !nada && <label className="frase-do-apagar">
        <span>Para confirmar, digite <strong>{exigirFrase}</strong></span>
        <Input value={frase} onChange={(evento) => definirFrase(evento.target.value)} autoComplete="off" spellCheck={false} aria-label={`Digite ${exigirFrase}`} />
      </label>}
      {falha && <p className="aviso" role="alert">{falha}</p>}
      <div className="ui-rodape">
        <Button variante="ghost" tamanho="md" onClick={aoFechar}>Manter</Button>
        <Button variante="primario" tamanho="md" className="botao-de-apagar" disabled={!liberado} onClick={() => void confirmar()}>{ocupado ? 'Apagando…' : rotuloDoBotao}</Button>
      </div>
    </div>
  </div>;
}
