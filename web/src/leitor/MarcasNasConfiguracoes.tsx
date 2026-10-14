/**
 * Configurações → Marcas (V-T3): no lugar dos níveis de atenção, uma opção só. Ligada (o padrão), o
 * leitor abre com todas as marcas à vista; desligada, abre com elas ocultas e o botão "Marcas" da barra
 * as mostra. Mora nas preferências do leitor, neste navegador, como a aparência.
 */
import type { ReactNode } from 'react';
import { Switch } from '../ui/Primitives';
import { usarAparencia } from './ContextoDeAparencia';

export function MarcasNasConfiguracoes(): ReactNode {
  const { preferencias, alterar } = usarAparencia();
  return <section className="card configuracao-das-marcas" aria-labelledby="configuracao-das-marcas">
    <h2 id="configuracao-das-marcas">Marcas</h2>
    <Switch checked={preferencias.marcasAoAbrir} onChange={(valor) => alterar({ tipo: 'alterar', valores: { marcasAoAbrir: valor } })}>
      Mostrar todas as marcas ao abrir
    </Switch>
  </section>;
}
