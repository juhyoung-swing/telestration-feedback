#!/usr/bin/env python3
"""docx -> markdown. pandoc/markitdown 없이 zipfile + ElementTree 로 변환한다.

다루는 것: 제목 스타일 · bold · 번호/불릿 목록 · 표 · 한 칸짜리 강조 박스.
목록 번호는 두 경로에서 온다 — numPr(numbering.xml 의 numFmt) 과
pStyle(ListNumber / ListBullet). 둘 다 봐야 원본 순서가 살아남는다.
"""
import re
import sys
import zipfile
import xml.etree.ElementTree as ET

W = "{http://schemas.openxmlformats.org/wordprocessingml/2006/main}"
R = "{http://schemas.openxmlformats.org/officeDocument/2006/relationships}"


def rel_map(z):
    """r:id -> 외부 URL. 하이퍼링크를 살리려면 이게 필요하다."""
    import re as _re
    try:
        xml = z.read("word/_rels/document.xml.rels").decode()
    except KeyError:
        return {}
    return dict(_re.findall(r'Id="([^"]+)"[^>]*Target="(https?://[^"]+)"', xml))


def run_text(r):
    t = "".join(n.text or "" for n in r.iter(f"{W}t"))
    if not t:
        return "\n" if r.find(f"{W}br") is not None else ""
    rpr = r.find(f"{W}rPr")
    bold = rpr is not None and rpr.find(f"{W}b") is not None
    return f"**{t}**" if bold and t.strip() else t


def text_of(el, rels=None):
    """자식을 순서대로 훑어 bold 는 ** 로, w:hyperlink 는 [텍스트](url) 로 만든다."""
    rels = rels or {}
    out = []
    for child in el:
        if child.tag == f"{W}r":
            out.append(run_text(child))
        elif child.tag == f"{W}hyperlink":
            inner = "".join(run_text(r) for r in child.iter(f"{W}r"))
            tgt = rels.get(child.get(f"{R}id", ""))
            label = inner.strip().replace("**", "")
            out.append(f"[{label}]({tgt})" if tgt and label else inner)
        elif child.find(f".//{W}r") is not None:
            out.append(text_of(child, rels))      # smartTag · ins 등 래퍼
    s = "".join(out)
    s = re.sub(r"\*\*\*\*", "", s)                # 인접 bold run 병합
    s = re.sub(r"[ \t]+", " ", s)
    return s.strip()


def unbold(s):
    """칸 전체를 감싼 bold 만 벗긴다. 부분 강조는 남긴다."""
    s = s.strip()
    if s.startswith("**") and s.endswith("**") and "**" not in s[2:-2]:
        return s[2:-2].strip()
    return s


def numbering_map(z):
    """numId -> {level: numFmt}."""
    try:
        num = ET.fromstring(z.read("word/numbering.xml"))
    except KeyError:
        return {}
    abstract = {}
    for an in num.findall(f"{W}abstractNum"):
        fmts = {}
        for lvl in an.findall(f"{W}lvl"):
            nf = lvl.find(f"{W}numFmt")
            fmts[int(lvl.get(f"{W}ilvl", "0"))] = (
                nf.get(f"{W}val") if nf is not None else "bullet")
        abstract[an.get(f"{W}abstractNumId")] = fmts
    out = {}
    for n in num.findall(f"{W}num"):
        a = n.find(f"{W}abstractNumId")
        if a is not None:
            out[n.get(f"{W}numId")] = abstract.get(a.get(f"{W}val"), {})
    return out


def para_info(p):
    """(제목레벨, 목록레벨, numId, 스타일이름) 을 돌려준다."""
    ppr = p.find(f"{W}pPr")
    if ppr is None:
        return 0, None, None, ""
    st = ppr.find(f"{W}pStyle")
    style = st.get(f"{W}val") if st is not None else ""
    m = re.match(r"[Hh]eading(\d)", style)
    head = int(m.group(1)) if m else (1 if style == "Title" else 0)

    numpr = ppr.find(f"{W}numPr")
    lvl, numid = None, None
    if numpr is not None:
        il = numpr.find(f"{W}ilvl")
        ni = numpr.find(f"{W}numId")
        lvl = int(il.get(f"{W}val")) if il is not None else 0
        numid = ni.get(f"{W}val") if ni is not None else None
    elif style.startswith(("ListNumber", "ListBullet")):
        lvl = 0                                   # 스타일만으로 지정된 목록
    return head, lvl, numid, style


def render_table(tbl, rels=None):
    rows = []
    for tr in tbl.findall(f"{W}tr"):
        cells = []
        for tc in tr.findall(f"{W}tc"):
            parts = [text_of(p, rels) for p in tc.findall(f"{W}p")]
            cells.append("\n".join(x for x in parts if x).replace("|", "\\|"))
        rows.append(cells)
    rows = [r for r in rows if any(c.strip() for c in r)]
    if not rows:
        return []
    width = max(len(r) for r in rows)
    rows = [r + [""] * (width - len(r)) for r in rows]

    # 한 칸짜리 표는 원본에서 강조 박스다. 표가 아니라 인용으로 뽑는다.
    if width == 1:
        out = []
        for r in rows:
            body = r[0]
            # 굵은 제목표가 본문에 붙어 있으면 줄을 나눈다
            body = re.sub(r"^(\*\*[^*]+\*\*)(?=\S)", r"\1\n", body)
            for line in body.split("\n"):
                out.append(f"> {line.strip()}" if line.strip() else ">")
            out.append(">")
        while out and out[-1] == ">":
            out.pop()
        return out + [""]

    head, body = rows[0], rows[1:]
    out = ["| " + " | ".join(c.replace("\n", " ") for c in head) + " |",
           "|" + "|".join("---" for _ in range(width)) + "|"]
    for r in body:
        out.append("| " + " | ".join(
            unbold(c).replace("\n", "<br>") for c in r) + " |")
    return out + [""]


def convert(path):
    with zipfile.ZipFile(path) as z:
        root = ET.fromstring(z.read("word/document.xml"))
        numfmt = numbering_map(z)
        rels = rel_map(z)
    out, counters = [], {}
    for el in root.find(f"{W}body"):
        if el.tag == f"{W}tbl":
            out += render_table(el, rels)
            counters.clear()
            continue
        if el.tag != f"{W}p":
            continue
        txt = text_of(el, rels)
        head, lvl, numid, style = para_info(el)
        if not txt:
            if out and out[-1] != "":
                out.append("")
            continue
        if head:
            out += ["", "#" * min(head, 6) + " " + txt.replace("**", ""), ""]
            counters.clear()
        elif lvl is not None:
            if numid is not None:
                fmt = numfmt.get(numid, {}).get(lvl, "bullet")
            else:
                fmt = "bullet" if style.startswith("ListBullet") else "decimal"
            if fmt == "bullet":
                out.append("  " * lvl + "- " + txt)
            else:
                key = (numid or style, lvl)
                for k in [k for k in counters if k[0] == key[0] and k[1] > lvl]:
                    del counters[k]                # 하위 레벨 카운터 초기화
                counters[key] = counters.get(key, 0) + 1
                out.append("  " * lvl + f"{counters[key]}. " + txt)
        else:
            if out and re.match(r"\s*(?:-|\d+\.) ", out[-1]):
                out.append("")            # 목록 바로 뒤 문단은 줄을 띄운다
            out += [txt, ""]
            counters.clear()

    return re.sub(r"\n{3,}", "\n\n", "\n".join(out)).strip() + "\n"


if __name__ == "__main__":
    sys.stdout.write(convert(sys.argv[1]))
