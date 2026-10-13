import { useEffect, useState } from 'react';
import { Drawer } from '../ui/Primitives';
import { campoEmEdicao } from './Lista';
import { atalhoDeUmaTeclaDesligado } from '../leitor/teclado/comandos';

const grupos = [
  { titulo: 'Navegação', atalhos: [['Mover para baixo', 'j', '↓'], ['Mover para cima', 'k', '↑'], ['Ler', 'Enter'], ['Abrir documento', 'Shift', 'Enter'], ['Buscar', '/']] },
  { titulo: 'Interface', atalhos: [['Barra lateral', '['], ['Painel', ']'], ['Atalhos', '?'], ['Fechar', 'Esc']] },
];

export function AtalhosDaBiblioteca() {
  const [aberto, abrir] = useState(false);
  useEffect(() => {
    const teclado = (evento: KeyboardEvent) => {
      if (evento.key !== '?' || atalhoDeUmaTeclaDesligado(evento) || evento.ctrlKey || evento.metaKey || evento.altKey || campoEmEdicao(evento.target) || document.querySelector('[aria-modal=true]')) return;
      evento.preventDefault(); abrir(true);
    };
    window.addEventListener('keydown', teclado);
    return () => window.removeEventListener('keydown', teclado);
  }, []);
  return aberto ? <div className="atalhos-biblioteca"><Drawer rotulo="Atalhos de teclado" aoFechar={() => abrir(false)}>{grupos.map((grupo) => <section key={grupo.titulo}><h3 className="eyebrow">{grupo.titulo}</h3><dl>{grupo.atalhos.map(([acao, ...teclas]) => <div key={acao}><dt>{acao}</dt><dd>{teclas.map((tecla) => <kbd key={tecla}>{tecla}</kbd>)}</dd></div>)}</dl></section>)}</Drawer></div> : null;
}
