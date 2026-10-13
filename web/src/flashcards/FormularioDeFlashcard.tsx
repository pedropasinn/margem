/**
 * Criar um flashcard à mão a partir de uma seleção ou de um grifo: o trecho fica como âncora (o serviço
 * confere a citação no bloco), a frente é a pergunta do leitor e o verso começa com o próprio trecho.
 */
import { useState, type FormEvent, type ReactNode } from 'react';
import type { AncoraV1 } from '@margem/contratos';
import { Button, Textarea } from '../ui/Primitives';
import { criarFlashcard } from './api';
import './flashcards.css';

export function FormularioDeFlashcard({ ancora, aoFechar, criar = criarFlashcard }: {
  ancora: AncoraV1; aoFechar: () => void; criar?: typeof criarFlashcard;
}): ReactNode {
  const [frente, definirFrente] = useState('');
  const [verso, definirVerso] = useState(ancora.citacao.trim());
  const [estado, definirEstado] = useState<'editando' | 'salvando' | 'criado'>('editando');
  const [erro, definirErro] = useState<string | null>(null);
  const salvar = async (evento: FormEvent) => {
    evento.preventDefault();
    definirEstado('salvando'); definirErro(null);
    try { await criar(ancora, frente, verso); definirEstado('criado'); }
    catch (falha) { definirErro(falha instanceof Error ? falha.message : 'Não foi possível criar o flashcard.'); definirEstado('editando'); }
  };
  if (estado === 'criado') {
    return <div className="formulario-de-flashcard" role="status">
      <p>Flashcard criado. Ele entra na fila de hoje em Flashcards.</p>
      <div className="botoes"><Button variante="primario" onClick={aoFechar}>Fechar</Button></div>
    </div>;
  }
  return <form className="formulario-de-flashcard" onSubmit={(evento) => void salvar(evento)} aria-label="Novo flashcard">
    <blockquote>“{ancora.citacao}”</blockquote>
    <label>Frente (a pergunta)<Textarea value={frente} maxLength={1000} autoFocus placeholder="Por que…? O que é…?" onChange={(e) => definirFrente(e.target.value)} /></label>
    <label>Verso (a resposta)<Textarea value={verso} maxLength={4000} onChange={(e) => definirVerso(e.target.value)} /></label>
    {erro && <p className="aviso" role="alert">{erro}</p>}
    <div className="botoes">
      <Button variante="ghost" onClick={aoFechar}>Cancelar</Button>
      <Button type="submit" variante="primario" disabled={estado === 'salvando' || !frente.trim() || !verso.trim()}>Criar flashcard</Button>
    </div>
  </form>;
}
