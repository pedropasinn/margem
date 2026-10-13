import './estilos/docs.css';
import { montar } from './montar';
import { PaginaDeDocs } from './paginas/Docs';

// Cada /docs/<pagina>/index.html diz qual página é em data-pagina; o /docs/ não diz (visão geral).
const slug = document.getElementById('raiz')?.dataset['pagina'] ?? null;
montar(<PaginaDeDocs slug={slug} />);
