# Usage : python3 -I decode_audio.py <saved get_workflow_execution output file>
import json, base64, sys, os
d = json.load(open(sys.argv[1]))
os.makedirs('full', exist_ok=True)
for it in d['data']['resultData']['runData']['Télécharger'][0]['data']['main'][0]:
    j = it['json']
    if 'b64' not in j: raise SystemExit('segment %s: %s' % (j.get('i'), j.get('err')))
    open('full/s%d.mp3' % j['i'], 'wb').write(base64.b64decode(j['b64'])); print(j['i'], j['n'])
