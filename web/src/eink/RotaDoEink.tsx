/**
 * A tela do e-ink (Xteink X4 Pro) atrás do recurso `eink` (J102b). Ligado, a carcaça de sempre; desligado,
 * o endereço volta ao Início e a biblioteca aparece no lugar, como nas outras rotas de recurso desligado.
 * Enquanto a configuração não chega, nada.
 */
import { useEffect, useState, type ReactNode } from 'react';
import { Biblioteca } from '../biblioteca/Casca';
import { usarRecursos } from '../recursos';
import { Eink } from './Eink';

export function RotaDoEink({ documento_id, secao_id }: { documento_id: string; secao_id?: string }): ReactNode {
  const { carregado, ativos } = usarRecursos();
  const desligado = carregado && !ativos.has('eink');
  const [noInicio, definirNoInicio] = useState(false);
  useEffect(() => {
    if (!desligado) return;
    window.history.replaceState(null, '', '/');
    definirNoInicio(true);
  }, [desligado]);
  if (!carregado) return null;
  if (!desligado) return <Eink documento_id={documento_id} {...(secao_id ? { secao_id } : {})} />;
  return noInicio ? <Biblioteca /> : null;
}
