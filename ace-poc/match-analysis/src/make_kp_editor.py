"""코트 키포인트 수동 보정 도구 생성.

자동 라인 스냅이 실패(네트·벽·옆코트 라인에 끌림)해서, 카메라 고정이라는
조건을 쓴다. 사람이 한 번 찍으면 그 카메라의 모든 영상에 재사용.

  python make_kp_editor.py <영상경로> [시각초]
  -> output/kp_editor_<태그>.html  (저장하면 kp_<태그>.json)
"""
import base64, os, sys
import cv2
import numpy as np
import torch, torchvision
from torchvision import transforms

VIDEO = sys.argv[1] if len(sys.argv) > 1 else "input/match_b.mp4"
T = float(sys.argv[2]) if len(sys.argv) > 2 else 300.0
TAG = os.path.splitext(os.path.basename(VIDEO))[0]

LABELS = ["0 원거리 더블스 좌", "1 원거리 더블스 우", "2 근거리 더블스 좌", "3 근거리 더블스 우",
          "4 원거리 싱글스 좌", "5 근거리 싱글스 좌", "6 원거리 싱글스 우", "7 근거리 싱글스 우",
          "8 원거리 서비스 좌", "9 원거리 서비스 우", "10 근거리 서비스 좌", "11 근거리 서비스 우",
          "12 원거리 서비스 중앙", "13 근거리 서비스 중앙"]

cap = cv2.VideoCapture(VIDEO)
fps = cap.get(cv2.CAP_PROP_FPS)
cap.set(cv2.CAP_PROP_POS_FRAMES, int(T*fps))
ok, frame = cap.read()
cap.release()
H, W = frame.shape[:2]

m = torchvision.models.resnet50()
m.fc = torch.nn.Linear(m.fc.in_features, 28)
m.load_state_dict(torch.load("models/keypoints_model.pth", map_location="cpu"))
m.eval()
tf = transforms.Compose([transforms.ToPILImage(), transforms.Resize((224,224)),
                         transforms.ToTensor(),
                         transforms.Normalize([.485,.456,.406],[.229,.224,.225])])
with torch.no_grad():
    o = m(tf(cv2.cvtColor(frame, cv2.COLOR_BGR2RGB)).unsqueeze(0))[0].numpy()
KP = (o.reshape(14,2) * [W/224., H/224.])

b64 = base64.b64encode(cv2.imencode(".jpg", frame, [cv2.IMWRITE_JPEG_QUALITY, 92])[1]).decode()

html = """<!doctype html><meta charset="utf-8"><title>코트 키포인트 보정 — __TAG__</title>
<style>
body{margin:0;background:#181818;color:#eee;font-family:-apple-system,sans-serif}
header{padding:10px 16px;background:#242424;border-bottom:1px solid #444;position:sticky;top:0;z-index:20}
h1{font-size:14px;margin:0 0 4px}
.hint{font-size:12px;color:#aaa;line-height:1.6}
kbd{background:#333;border:1px solid #555;border-radius:3px;padding:1px 5px;font-size:11px}
#wrap{position:relative;display:inline-block;margin:14px}
#img{display:block;max-width:100%}
.pt{position:absolute;width:16px;height:16px;margin:-8px 0 0 -8px;border-radius:50%;
  background:#0f0;border:2px solid #000;cursor:grab;box-shadow:0 0 0 1px #0f0}
.pt.sel{background:#ff0;width:20px;height:20px;margin:-10px 0 0 -10px;z-index:5}
.lbl{position:absolute;font-size:11px;color:#0f0;text-shadow:0 0 3px #000;
  margin:-26px 0 0 10px;pointer-events:none;white-space:nowrap}
#loupe{position:fixed;right:16px;top:90px;width:240px;height:240px;border:2px solid #666;
  border-radius:6px;background:#000 no-repeat;z-index:30;display:none}
#loupe::after{content:"";position:absolute;left:50%;top:50%;width:20px;height:20px;
  margin:-10px 0 0 -10px;border:1px solid #f00;border-radius:50%}
footer{padding:14px 16px;background:#242424;border-top:1px solid #444}
button{background:#3a3a3a;color:#eee;border:1px solid #666;border-radius:4px;
  padding:7px 14px;font-size:13px;cursor:pointer;margin-right:8px}
button:hover{background:#4a4a4a}
textarea{width:100%;height:90px;background:#111;color:#7d7;border:1px solid #444;
  border-radius:4px;font-family:ui-monospace,monospace;font-size:11px;padding:8px;margin-top:10px}
#cur{font-size:12px;color:#ff0;margin-top:4px}
</style>
<header>
<h1>코트 키포인트 보정 &mdash; __TAG__</h1>
<div class="hint">
점을 <b>드래그</b>해서 실제 라인 교차점에 맞추세요 &middot; 클릭하면 선택 &middot;
<kbd>방향키</kbd> 1px 미세조정, <kbd>Shift</kbd>+방향키 10px &middot;
<kbd>Tab</kbd> 다음 점<br>
드래그하는 동안 오른쪽에 확대경이 뜹니다. 프레임 밖으로 나가는 점은 그대로 두세요.
</div>
<div id="cur"></div>
</header>
<div id="wrap">
<img id="img" src="data:image/jpeg;base64,__B64__">
</div>
<div id="loupe"></div>
<footer>
<button onclick="dl()">kp___TAG__.json 저장</button>
<button onclick="reset()">모델 예측으로 되돌리기</button>
<textarea id="out" readonly></textarea>
</footer>
<script>
const W=__W__, H=__H__, TAG="__TAG__";
const INIT=__KP__, LABELS=__LABELS__;
let KP=INIT.map(p=>[...p]), sel=0;
const wrap=document.getElementById('wrap'), img=document.getElementById('img'),
      loupe=document.getElementById('loupe'), out=document.getElementById('out');
const els=[];
function scale(){ return img.clientWidth / W; }

INIT.forEach((p,i)=>{
  const d=document.createElement('div'); d.className='pt'; d.dataset.i=i;
  const l=document.createElement('div'); l.className='lbl'; l.textContent=i;
  wrap.appendChild(d); wrap.appendChild(l); els.push([d,l]);
});
function draw(){
  const s=scale();
  KP.forEach((p,i)=>{
    const [d,l]=els[i];
    d.style.left=(p[0]*s)+'px'; d.style.top=(p[1]*s)+'px';
    l.style.left=(p[0]*s)+'px'; l.style.top=(p[1]*s)+'px';
    d.classList.toggle('sel', i===sel);
  });
  document.getElementById('cur').textContent =
    `선택: ${LABELS[sel]}  (${KP[sel][0].toFixed(1)}, ${KP[sel][1].toFixed(1)})`;
  out.value=JSON.stringify(KP.map(p=>[+p[0].toFixed(1),+p[1].toFixed(1)]));
}
function showLoupe(px,py){
  const z=4, s=scale();
  loupe.style.display='block';
  loupe.style.backgroundImage=`url(${img.src})`;
  loupe.style.backgroundSize=(W*z)+'px '+(H*z)+'px';
  loupe.style.backgroundPosition=`${120-px*z}px ${120-py*z}px`;
}
let drag=null;
wrap.addEventListener('mousedown', e=>{
  if(!e.target.classList.contains('pt')) return;
  sel=+e.target.dataset.i; drag=sel; e.preventDefault(); draw();
});
window.addEventListener('mousemove', e=>{
  if(drag===null) return;
  const r=img.getBoundingClientRect(), s=scale();
  KP[drag]=[(e.clientX-r.left)/s, (e.clientY-r.top)/s];
  showLoupe(KP[drag][0], KP[drag][1]); draw();
});
window.addEventListener('mouseup', ()=>{ drag=null; loupe.style.display='none'; });
window.addEventListener('keydown', e=>{
  if(e.key==='Tab'){ sel=(sel+1)%14; e.preventDefault(); draw(); return; }
  const step=e.shiftKey?10:1, m={ArrowLeft:[-step,0],ArrowRight:[step,0],
                                 ArrowUp:[0,-step],ArrowDown:[0,step]}[e.key];
  if(!m) return;
  e.preventDefault();
  KP[sel]=[KP[sel][0]+m[0], KP[sel][1]+m[1]];
  showLoupe(KP[sel][0], KP[sel][1]);
  clearTimeout(window._lt); window._lt=setTimeout(()=>loupe.style.display='none',900);
  draw();
});
function dl(){
  const b=new Blob([JSON.stringify(KP.map(p=>[+p[0].toFixed(1),+p[1].toFixed(1)]))],
                   {type:'application/json'});
  const a=document.createElement('a');
  a.href=URL.createObjectURL(b); a.download='kp_'+TAG+'.json'; a.click();
}
function reset(){ KP=INIT.map(p=>[...p]); draw(); }
img.complete ? draw() : img.onload=draw;
window.addEventListener('resize', draw);
</script>
"""

html = (html.replace("__B64__", b64).replace("__W__", str(W)).replace("__H__", str(H))
            .replace("__KP__", str([[round(float(x),1), round(float(y),1)] for x, y in KP]))
            .replace("__LABELS__", str(LABELS).replace("'", '"'))
            .replace("__TAG__", TAG))
os.makedirs("output", exist_ok=True)
p = f"output/kp_editor_{TAG}.html"
open(p, "w").write(html)
print(f"{p}  ({W}x{H}, t={T}s, {len(html)/1024:.0f} KB)")
