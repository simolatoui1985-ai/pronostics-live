import math, wave, struct, random, json
d=json.load(open('data_run.json')); dur=d['total']
hits=[s['start']+s['tR'] for s in d['segs'] if s['type']=='match']
qs=[s['start']+s['tQ'] for s in d['segs'] if s['type']=='match']
sr=44100; n=int(sr*dur)
chords=[[220,261.63,329.63],[174.61,220,261.63],[130.81,196,261.63],[196,246.94,293.66]]
beat=60/96; out=[]; random.seed(1)
for i in range(n):
    t=i/sr; c=chords[int(t/(beat*8))%4]
    pad=sum(math.sin(2*math.pi*f*t)+0.3*math.sin(2*math.pi*f*2*t) for f in c)/6
    pad*=0.55+0.45*math.sin(2*math.pi*t/(beat*8))**2
    bt=t%beat; kick=math.sin(2*math.pi*(55+90*math.exp(-bt*40))*bt)*math.exp(-bt*9)*0.9
    hb=(t+beat/2)%beat; hat=(random.random()*2-1)*math.exp(-hb*60)*0.12
    x=0
    for q,h in zip(qs,hits):
        if q<=t<h: x+=(random.random()*2-1)*((t-q)/max(.3,h-q))**2*0.22
        if h<=t<h+1.6: dd=t-h; x+=math.sin(2*math.pi*65*dd)*math.exp(-dd*3)*0.9
    s=pad*0.5+kick*0.45+hat+x; fade=min(1,t/1.5,(dur-t)/2)
    out.append(int(max(-1,min(1,s*0.5*fade))*32767))
w=wave.open('music_full.wav','wb'); w.setnchannels(1); w.setsampwidth(2); w.setframerate(sr)
w.writeframes(struct.pack('<%dh'%len(out),*out)); w.close(); print('music ok')
