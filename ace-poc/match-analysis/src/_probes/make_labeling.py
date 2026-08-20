"""5초 간격 썸네일 그리드 라벨링 도구 생성. SPEC §4-1."""
import base64, glob, json, subprocess

VIDEO = "input/match_amateur.mp4"
STEP = 5

dur = float(subprocess.run(
    ["ffprobe", "-v", "error", "-show_entries", "format=duration",
     "-of", "default=nw=1:nk=1", VIDEO],
    capture_output=True, text=True).stdout.strip())

thumbs = sorted(glob.glob("output/thumbs/t*.jpg"))
cells = []
for i, p in enumerate(thumbs):
    t = i * STEP
    b64 = base64.b64encode(open(p, "rb").read()).decode()
    cells.append(f'<div class="c" data-t="{t}"><img src="data:image/jpeg;base64,{b64}">'
                 f'<span>{t//60}:{t%60:02d}</span></div>')

html = """<!doctype html><meta charset="utf-8"><title>ACE exp1 라벨링</title>
<style>
body{font-family:-apple-system,sans-serif;margin:0;background:#1a1a1a;color:#eee}
header{position:sticky;top:0;background:#222;padding:12px 16px;border-bottom:1px solid #444;z-index:9}
h1{font-size:15px;margin:0 0 6px}
.hint{font-size:12px;color:#999;line-height:1.6}
kbd{background:#333;border:1px solid #555;border-radius:3px;padding:1px 5px;font-size:11px}
#stat{font-size:12px;color:#6c6;margin-top:6px}
#grid{display:grid;grid-template-columns:repeat(auto-fill,minmax(140px,1fr));gap:6px;padding:16px}
.c{position:relative;cursor:pointer;border:3px solid transparent;border-radius:4px;line-height:0}
.c img{width:100%;border-radius:2px;opacity:.45}
.c span{position:absolute;left:3px;bottom:3px;background:#000c;color:#fff;font-size:10px;
  padding:1px 4px;border-radius:2px;line-height:1.4}
.c.play{border-color:#3c3}
.c.play img{opacity:1}
.c.cur{outline:2px solid #fa0;outline-offset:1px}
footer{padding:16px;border-top:1px solid #444;background:#222}
button{background:#3a3a3a;color:#eee;border:1px solid #666;border-radius:4px;
  padding:7px 14px;font-size:13px;cursor:pointer;margin-right:8px}
button:hover{background:#4a4a4a}
textarea{width:100%;height:120px;background:#111;color:#7d7;border:1px solid #444;
  border-radius:4px;font-family:ui-monospace,monospace;font-size:11px;padding:8px;margin-top:10px}
video{position:fixed;right:16px;bottom:16px;width:300px;border:2px solid #666;border-radius:4px;z-index:10}
</style>
<header>
<h1>플레이 구간 라벨링 &mdash; 공을 치고 있는 구간을 표시</h1>
<div class="hint">
클릭 = 토글 &middot; <kbd>Shift</kbd>+클릭 = 범위 지정 &middot; 드래그 = 여러 개 칠하기 &middot;
썸네일 우클릭 = 그 지점부터 영상 재생<br>
각 칸은 <b>그 시각부터 5초</b>를 뜻합니다. 랠리가 진행 중이면 플레이, 서브 준비·공 줍기·휴식이면 비워두세요.
</div>
<div id="stat"></div>
</header>
<div id="grid">__CELLS__</div>
<video id="v" src="__VIDEO__" controls></video>
<footer>
<button onclick="gen()">ground_truth.json 생성</button>
<button onclick="dl()">파일로 저장</button>
<button onclick="if(confirm('전부 지웁니다'))reset()">초기화</button>
<textarea id="out" placeholder="생성 버튼을 누르면 여기에 JSON이 나옵니다"></textarea>
</footer>
<script>
const STEP=__STEP__, DUR=__DUR__;
const cells=[...document.querySelectorAll('.c')];
let last=null, painting=false, paintTo=true;

function stat(){
  const n=cells.filter(c=>c.classList.contains('play')).length;
  document.getElementById('stat').textContent=
    `플레이 ${n} / ${cells.length} 칸  (${(n*STEP/60).toFixed(1)}분 / ${(DUR/60).toFixed(1)}분, 비율 ${(n/cells.length*100).toFixed(0)}%)`;
}
cells.forEach((c,i)=>{
  c.onmousedown=e=>{
    if(e.button!==0)return;
    e.preventDefault();
    if(e.shiftKey&&last!==null){
      const [a,b]=[Math.min(last,i),Math.max(last,i)];
      for(let k=a;k<=b;k++)cells[k].classList.add('play');
    }else{
      paintTo=!c.classList.contains('play');
      c.classList.toggle('play',paintTo);
      painting=true;
    }
    last=i; stat();
  };
  c.onmouseenter=()=>{ if(painting){c.classList.toggle('play',paintTo); stat();} };
  c.oncontextmenu=e=>{
    e.preventDefault();
    const v=document.getElementById('v');
    v.currentTime=+c.dataset.t; v.play();
    cells.forEach(x=>x.classList.remove('cur')); c.classList.add('cur');
  };
});
document.onmouseup=()=>painting=false;

function segs(){
  const out=[]; let s=null;
  cells.forEach((c,i)=>{
    const on=c.classList.contains('play');
    if(on&&s===null)s=i*STEP;
    if(!on&&s!==null){out.push({start:s,end:i*STEP});s=null;}
  });
  if(s!==null)out.push({start:s,end:Math.min(cells.length*STEP,DUR)});
  return out;
}
function gen(){
  const s=segs();
  document.getElementById('out').value=JSON.stringify(s,null,2);
  return s;
}
function dl(){
  const b=new Blob([JSON.stringify(gen(),null,2)],{type:'application/json'});
  const a=document.createElement('a');
  a.href=URL.createObjectURL(b); a.download='ground_truth.json'; a.click();
}
function reset(){cells.forEach(c=>c.classList.remove('play'));stat();localStorage.removeItem('ace_gt');}

// 새로고침 대비 자동 저장
const save=()=>localStorage.setItem('ace_gt',JSON.stringify(cells.map(c=>c.classList.contains('play'))));
const load=()=>{
  try{
    const v=JSON.parse(localStorage.getItem('ace_gt')||'null');
    if(v&&v.length===cells.length)v.forEach((on,i)=>cells[i].classList.toggle('play',on));
  }catch(e){}
};
document.addEventListener('mouseup',save);
load(); stat();
</script>
"""

html = (html.replace("__CELLS__", "\n".join(cells))
            .replace("__VIDEO__", "../" + VIDEO)
            .replace("__STEP__", str(STEP))
            .replace("__DUR__", f"{dur:.1f}"))

open("output/labeling.html", "w").write(html)
print(f"output/labeling.html — {len(thumbs)} cells, {dur:.1f}s, {len(html)/1024:.0f} KB")
