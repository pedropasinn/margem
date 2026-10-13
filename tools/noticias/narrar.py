"""TTS público recebe somente o roteiro editorial. Não lê documentos da biblioteca."""
import asyncio
import json
from pathlib import Path
import sys
import edge_tts


async def main():
    pedido = json.load(sys.stdin)
    saida = Path(pedido['saida'])
    texto = pedido['roteiro']
    if not texto.strip() or len(texto.split()) > 600:
        raise ValueError('Roteiro vazio ou acima de 600 palavras')
    await edge_tts.Communicate(texto, 'pt-BR-AntonioNeural', rate='+0%').save(str(saida))


if __name__ == '__main__':
    asyncio.run(asyncio.wait_for(main(), timeout=120))
