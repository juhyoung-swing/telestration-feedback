#!/usr/bin/env python3
"""수업 전 / 수업 후 두 장을 파일 하나로 묶는다.

student_pages.py 는 이미지·영상을 옆에 두고 상대경로로 참조한다. 폴더째 주면
되지만 공유할 때는 파일 하나가 낫다 — 카톡으로 보내고 더블클릭하면 열린다.

이미지와 영상을 전부 data URI 로 넣고, 탭은 링크 대신 JS 토글로 바꾼다.
원본 두 장은 그대로 두고 이 파일만 따로 만든다.

output: docs/lesson/포핸드_수강생자료.html  (약 4.5MB)

usage: python bundle_page.py [출력경로]
"""
import base64
import mimetypes
import re
import sys
from pathlib import Path

OUT = Path(__file__).resolve().parents[2] / "docs/lesson"


def data_uri(name: str) -> str:
    f = OUT / name
    mime = mimetypes.guess_type(name)[0] or "application/octet-stream"
    return f"data:{mime};base64," + base64.b64encode(f.read_bytes()).decode()


def inline(html: str) -> str:
    """src="loop_gaze.mp4" 처럼 옆 파일을 가리키는 것만 바꾼다."""
    def sub(m):
        name = m.group(1)
        return f'src="{data_uri(name)}"' if (OUT / name).exists() else m.group(0)
    return re.sub(r'src="([^":]+)"', sub, html)


def body_of(page: str) -> str:
    """<nav> 뒤부터 </main> 앞까지. 헤더·탭은 새로 만든다."""
    return page.split("</nav>", 1)[1].split("</main>", 1)[0]


EXTRA = """
.tabs button{flex:1;padding:12px 0;font:inherit;font-size:.86rem;font-weight:700;
 color:var(--soft);background:none;border:0;cursor:pointer}
.tabs button.on{color:var(--navy);box-shadow:inset 0 -3px 0 var(--yellow)}
.panel[hidden]{display:none}
"""


def main(dest: Path) -> None:
    before = (OUT / "before.html").read_text()
    after = (OUT / "after.html").read_text()

    head = before.split("<body>", 1)[0]                 # doctype~</head>
    head = head.replace("</style>", EXTRA + "</style>")
    header = before.split("<body><main>", 1)[1].split('<nav', 1)[0]
    title = re.search(r"<title>(.*?)</title>", before).group(1)

    nav = ('<nav class="tabs">'
           '<button class="on" onclick="go(0)">수업 전</button>'
           '<button onclick="go(1)">수업 후</button></nav>')
    panels = (f'<div class="panel">{body_of(before)}</div>'
              f'<div class="panel" hidden>{body_of(after)}</div>')
    script = """<script>
function go(i){
  document.querySelectorAll('.tabs button').forEach((b,j)=>b.classList.toggle('on',i===j));
  document.querySelectorAll('.panel').forEach((p,j)=>p.hidden=(i!==j));
  document.querySelector('.kind').textContent=i?'수업 후':'수업 전';
  scrollTo(0,0);
}
</script>"""

    html = f"{head}<body><main>{header}{nav}{panels}</main>{script}</body></html>"
    dest.write_text(inline(html))
    mb = dest.stat().st_size / 1024 / 1024
    print(f"{dest}  {mb:.1f}MB  ·  {title}")


if __name__ == "__main__":
    main(Path(sys.argv[1]) if len(sys.argv) > 1 else OUT / "포핸드_수강생자료.html")
