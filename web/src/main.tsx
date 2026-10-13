import { StrictMode, type ReactNode } from 'react';
import { createRoot } from 'react-dom/client';
import { ContextoDeAparencia } from './leitor/ContextoDeAparencia';
import { GaleriaDeUi } from './ui/GaleriaDeUi';
import { Galeria } from './ui/marcador/Galeria';
import { Biblioteca } from './biblioteca/Casca';
import { ReaderController } from './leitor/ReaderController';
import { ReaderViewport } from './leitor/ReaderViewport';
import { capituloExemplo } from './leitor/fixtures/capitulo-exemplo';
import { gravarIntencao, intencaoDaUrl } from './biblioteca/intencao';
import { AppDaSala, rotaDaSala } from './sala/AppDaSala';
import { ProvedorDosRecursos } from './recursos';
import { RotaDoEink } from './eink/RotaDoEink';
import './ui/componentes.css';
import './leitor/reader.css';
import './biblioteca/biblioteca.css';

const raiz = document.getElementById('raiz');
if (raiz === null) throw new Error('A página precisa de #raiz.');

// `/dev` é a página de desenvolvimento do texto (capturas do J08) e `/dev/margem` a da
// interação completa (capturas do J09): as duas sem API e sem roteador. O resto é a biblioteca.
const caminho = window.location.pathname;
// Link de volta da nota do Obsidian (`?bloco=`): vira a intenção de leitura, e a URL fica limpa.
const vindaDeFora = intencaoDaUrl(caminho, window.location.search);
if (vindaDeFora) {
  gravarIntencao(vindaDeFora.intencao);
  window.history.replaceState(null, '', vindaDeFora.caminho);
}
const DOCUMENTO_DE_EXEMPLO = '0'.repeat(22) + 'D001';

function pagina(): ReactNode {
  if (caminho === '/dev/ui') return <GaleriaDeUi />;
  if (caminho === '/dev/componentes') return <Galeria />;
  // A sala de teste do beta (servida pelo portão): nada da casca da biblioteca, nem onboarding, nem avisos do Codex.
  const sala = rotaDaSala(caminho);
  if (sala) return <AppDaSala slug={sala.slug} rotaInicial={sala.rota} />;
  if (caminho.startsWith('/dev/margem')) {
    return <ReaderController snapshot={capituloExemplo} documento_id={DOCUMENTO_DE_EXEMPLO} />;
  }
  if (caminho.startsWith('/dev')) return <ReaderViewport snapshot={capituloExemplo} estrategia="scroll" />;
  // A carcaça do e-ink (Xteink X4 Pro): `/eink/<documento>/<capítulo>`, sem a casca da biblioteca.
  const eink = /^\/eink\/([^/]+)(?:\/([^/]+))?/.exec(caminho);
  if (eink?.[1]) return <ProvedorDosRecursos><RotaDoEink documento_id={eink[1]} {...(eink[2] ? { secao_id: eink[2] } : {})} /></ProvedorDosRecursos>;
  // Recursos pessoais (J102): a biblioteca só mostra Notícias, Quadros e Salas quando a API diz que estão ligados.
  return <ProvedorDosRecursos><Biblioteca /></ProvedorDosRecursos>;
}

createRoot(raiz).render(<StrictMode><ContextoDeAparencia>{pagina()}</ContextoDeAparencia></StrictMode>);
