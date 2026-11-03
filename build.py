import json, subprocess, re, math, array, sys
G=0.7
def dur(f): return float(subprocess.check_output(['ffprobe','-v','error','-show_entries','format=duration','-of','csv=p=0',f]))
def sil(f):
    o=subprocess.run(['ffmpeg','-i',f,'-af','silencedetect=noise=-32dB:d=0.3','-f','null','-'],capture_output=True,text=True).stderr
    return [(float(a),float(b)) for a,b in re.findall(r'silence_end: ([0-9.]+) \| silence_duration: ([0-9.]+)',o)]
data=json.load(open('data.json'))
segs=[];t=0.4;files=[]
n=len(data['matches'])
for i in range(n+2):
    f=f'full/s{i}.mp3'; d=dur(f); files.append((f,t))
    if i==0: segs.append({'type':'intro','start':0,'end':t+d+G})
    elif i==n+1: segs.append({'type':'outro','start':t-0.2,'end':t+d+1.8})
    else:
        S=sil(f)
        late=[x for x in S if x[0]>d*0.45]
        q=max(late,key=lambda x:x[1])[0] if late else d*0.72
        after=[x for x in S if x[0]>q+0.3]
        r=after[0][0] if after else q+1.4
        st=S[1][0] if len(S)>1 and S[1][0]<q-2 else min(d*0.3,q-3)
        segs.append({'type':'match','i':i-1,'start':t-0.2,'end':t+d+G,'tS':st+0.2,'tQ':q+0.2,'tR':r+0.2})
    t+=d+G
segs[-1]['end']=t+1.4
data['segs']=segs;data['total']=round(t+1.4,2)
json.dump(data,open('data_run.json','w'),ensure_ascii=False)
# voice track
inputs=[];flt=[]
for k,(f,st) in enumerate(files):
    inputs+=['-i',f];flt.append(f'[{k}:a]aformat=sample_rates=44100:channel_layouts=mono,adelay={int(st*1000)}[a{k}]')
flt.append(''.join(f'[a{k}]' for k in range(len(files)))+f'amix=inputs={len(files)}:normalize=0,apad,atrim=0:{data["total"]}[o]')
subprocess.run(['ffmpeg','-y','-v','error',*inputs,'-filter_complex',';'.join(flt),'-map','[o]','voice_full.wav'],check=True)
subprocess.run(['ffmpeg','-y','-v','error','-i','voice_full.wav','-ac','1','-ar','16000','-f','s16le','vf.raw'],check=True)
a=array.array('h',open('vf.raw','rb').read());nn=16000//30
rms=[math.sqrt(sum(x*x for x in a[i:i+nn])/max(1,len(a[i:i+nn])))/32768 for i in range(0,len(a),nn)]
m=max(rms);json.dump([round(min(1,r/m*1.6),3) for r in rms],open('rms_full.json','w'))
print(json.dumps(segs,indent=0)[:1500]);print('total',data['total'])
