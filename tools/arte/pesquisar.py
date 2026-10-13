#!/usr/bin/env python3
"""Pesquisa local limitada. Nunca grava vídeo, transcrição ou frame no Git.

python tools/arte/pesquisar.py --coletar   # 8 vídeos por canal, máximo 16
python tools/arte/pesquisar.py           # ffprobe, candidatos a corte e frames locais
Requer yt-dlp/Node (coleta), ffmpeg/ffprobe. Sem treinamento ou serviço de produto.
"""
import argparse
import json
from pathlib import Path
import re
import subprocess

RAIZ = Path(__file__).resolve().parents[2]
LOCAL = RAIZ / '.local/art-research'
CANAIS = ('artesexplicadas', 'explicandoarte')


def executar(args):
    return subprocess.run(args, text=True, capture_output=True, check=True).stdout


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument('--coletar', action='store_true')
    args = parser.parse_args()
    for nome in ('videos', 'audio', 'frames', 'transcripts', 'manifests'):
        (LOCAL / nome).mkdir(parents=True, exist_ok=True)
    if args.coletar:
        urls = []
        for canal in CANAIS:
            texto = executar(['yt-dlp', '--flat-playlist', '--playlist-end', '8', '--dump-json', f'https://www.youtube.com/@{canal}/shorts'])
            (LOCAL / 'manifests' / f'{canal}.jsonl').write_text(texto)
            urls.extend(json.loads(l)['url'] for l in texto.splitlines())
        if len(urls) > 16:
            raise ValueError('A coleta não pode ultrapassar 16 vídeos.')
        lista = LOCAL / 'manifests/urls.txt'
        lista.write_text('\n'.join(urls))
        subprocess.run(['yt-dlp', '--js-runtimes', 'node', '--batch-file', str(lista), '--write-info-json', '--write-subs', '--write-auto-subs', '--sub-langs', 'pt.*,en', '--sub-format', 'vtt', '-f', 'bv[height<=960]+ba/b', '--merge-output-format', 'mp4', '--socket-timeout', '15', '--retries', '1', '--ignore-errors', '-o', str(LOCAL / 'videos/%(id)s.%(ext)s')], check=True)
    medidas = []
    for video in sorted((LOCAL / 'videos').glob('*.mp4')):
        if '.f' in video.stem:
            continue
        dados = json.loads(executar(['ffprobe', '-v', 'error', '-show_format', '-show_streams', '-of', 'json', str(video)]))
        duracao = float(dados['format']['duration'])
        # Detector mede mudanças visuais candidatas, NÃO decisões semânticas de montagem.
        cortes = subprocess.run(['ffmpeg', '-hide_banner', '-i', str(video), '-vf', "scale=160:-1,select='gt(scene,0.25)',showinfo", '-an', '-f', 'null', '-'], text=True, capture_output=True, check=True)
        tempos = [float(x) for x in re.findall(r'pts_time:([\d.]+)', cortes.stderr)]
        saida = LOCAL / 'frames' / video.stem
        saida.mkdir(exist_ok=True)
        subprocess.run(['ffmpeg', '-v', 'error', '-i', str(video), '-vf', f'fps=1/{duracao / 12},scale=240:-1', '-frames:v', '12', '-y', str(saida / '%02d.jpg')], check=True)
        medidas.append({'id': video.stem, 'duracao_ffprobe_s': duracao, 'audio_presente': any(s['codec_type'] == 'audio' for s in dados['streams']), 'cortes_candidatos_limiar_025_s': tempos, 'limite': 'Mudanças de legenda/escala podem causar falsos cortes; zoom gradual pode não ser detectado.'})
    (LOCAL / 'manifests/medidas.json').write_text(json.dumps(medidas, ensure_ascii=False, indent=2) + '\n')
    print(f'{len(medidas)} vídeos medidos; arquivos apenas em {LOCAL}')


if __name__ == '__main__':
    main()
