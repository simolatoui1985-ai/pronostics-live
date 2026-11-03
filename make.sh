#!/bin/bash
# Usage : ./make.sh OUT.mp4   (needs data.json + full/s0.mp3 ... full/s6.mp3 in this folder)
set -e
cd "$(dirname "$0")"
python3 build.py | tail -1
python3 music.py
rm -rf fr2 && node render2.js data_run.json rms_full.json fr2 > /dev/null
ffmpeg -y -v error -framerate 30 -i fr2/f%05d.jpg -i voice_full.wav -i music_full.wav -filter_complex "[1:a]volume=1.5,asplit=2[v1][v2];[2:a]volume=0.22[m];[m][v1]sidechaincompress=threshold=0.04:ratio=6:attack=20:release=350[md];[md][v2]amix=inputs=2:duration=longest:normalize=0[a]" -map 0:v -map "[a]" -c:v libx264 -preset veryfast -crf 21 -pix_fmt yuv420p -c:a aac -b:a 160k -movflags +faststart "$1"
ffprobe -v error -show_entries format=duration,size -of csv=p=0 "$1"
