/**
 * Configurações → Cópia de segurança (U-03, W-01): os dois lugares (a pasta da biblioteca e o banco, que
 * numa pasta sincronizada fica fora dela), a última cópia e o "Fazer cópia de segurança…", o mesmo do menu
 * Arquivo. Só no app de computador.
 */
import { useEffect, useState, type ReactNode } from 'react';
import { Button } from '../ui/Primitives';
import { LINK_DA_RESTAURACAO, ponteDaCopia, quando, type LocaisDaBiblioteca, type PonteDaCopia } from './ponte';
import './copia.css';

export function CopiaDeSeguranca({ ponte = ponteDaCopia() }: { ponte?: PonteDaCopia | null } = {}): ReactNode {
  const [locais, definir] = useState<LocaisDaBiblioteca | null>(null);
  const [falhou, falhar] = useState(false);
  useEffect(() => {
    if (ponte === null) return undefined;
    let vivo = true;
    ponte.locais().then((l) => { if (vivo) definir(l); }, () => { if (vivo) falhar(true); });
    return () => { vivo = false; };
  }, [ponte]);
  if (ponte === null) return null;

  return <section className="card configuracao-da-copia" id="copia" aria-labelledby="titulo-da-copia" aria-busy={locais === null && !falhou}>
    <div className="cabeca-da-secao">
      <h2 id="titulo-da-copia">Cópia de segurança</h2>
      <p className="secundario">Copia a biblioteca e o banco (marcas, notas, conversas e leituras) para uma pasta que você escolher, como um disco externo. Durante a cópia a biblioteca fecha por alguns instantes e abre de novo sozinha.</p>
    </div>
    {falhou && <p className="aviso" role="alert">Não foi possível ler onde a biblioteca está. Feche e abra as Configurações de novo.</p>}
    {locais && <dl className="locais-da-biblioteca">
      <div>
        <dt>Biblioteca</dt>
        <dd><code>{locais.biblioteca}</code><Button variante="ghost" className="small" onClick={() => ponte.mostrar('biblioteca')}>Mostrar</Button></dd>
      </div>
      <div>
        <dt>Banco</dt>
        <dd><code>{locais.banco}</code><Button variante="ghost" className="small" onClick={() => ponte.mostrar('banco')}>Mostrar</Button></dd>
      </div>
    </dl>}
    {locais?.bancoSeparado && <p className="nota-dos-locais" role="note">
      {locais.sincronizada === null
        ? 'O banco fica neste computador, fora da pasta da biblioteca. Copiar só a pasta não leva as notas: use a cópia de segurança.'
        : `A biblioteca está no ${locais.sincronizada}, mas o banco fica neste computador, fora dela, para não se corromper. O ${locais.sincronizada} não leva as notas: use a cópia de segurança.`}
    </p>}
    {locais && <p className="ultima-copia">
      {locais.ultimaCopia === null
        ? 'Nenhuma cópia de segurança feita neste computador ainda.'
        : <>Última cópia em {quando(locais.ultimaCopia.criada_em)}. <button type="button" className="link" onClick={() => ponte.mostrar('ultima')}>Mostrar a pasta</button></>}
    </p>}
    <div className="button-row">
      <Button variante="primario" disabled={locais === null} onClick={() => ponte.fazer()}>Fazer cópia de segurança…</Button>
      <a className="link-da-restauracao" href={LINK_DA_RESTAURACAO} target="_blank" rel="noreferrer">Como restaurar</a>
    </div>
  </section>;
}
