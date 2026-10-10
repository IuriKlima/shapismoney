"""Local extraction only. Never approves sources or connects them to a provider."""
import argparse
import hashlib
import json
import re
import zipfile
from pathlib import Path
from xml.etree import ElementTree
from pypdf import PdfReader

parser = argparse.ArgumentParser()
parser.add_argument("source_directory")
parser.add_argument("output")
args = parser.parse_args()
root = Path(args.source_directory).resolve()
output = Path(args.output).resolve()
if ".qa" not in output.parts:
    raise ValueError("Private corpus must stay in a .qa directory")
names = ["SIM_Training_Intelligence_Spec_v1_0.docx", "Shape_Is_Money_PRD_Atendimento_Relacionamento_v1.pdf"]
names += [f"Shape_Is_Money_Codigo_Relacionamento_Capitulo_{i}.pdf" for i in range(1, 8)]
sources, chunks = [], []
for name in names:
    source = root / name
    raw = source.read_bytes()
    sha = hashlib.sha256(raw).hexdigest()
    if source.suffix == ".pdf":
        pages = [(f"page:{i+1}", page.extract_text() or "") for i, page in enumerate(PdfReader(source).pages)]
    else:
        with zipfile.ZipFile(source) as z:
            doc = ElementTree.fromstring(z.read("word/document.xml"))
        ns = {"w": "http://schemas.openxmlformats.org/wordprocessingml/2006/main"}
        pages = [(f"paragraph:{i+1}", "".join(p.itertext())) for i, p in enumerate(doc.findall(".//w:p", ns))]
    count = 0
    for locator, value in pages:
        text = re.sub(r"\s+", " ", value).strip()
        for start in range(0, len(text), 1500):
            part = text[start:start+1500]
            if not part:
                continue
            chunks.append({"id": hashlib.sha256(f"{sha}:{locator}:{start}".encode()).hexdigest(), "source": name, "sourceSha256": sha, "locator": locator, "offset": start, "text": part, "status": "pending-professional-review", "providerTransferApproved": False})
            count += 1
    sources.append({"filename": name, "sha256": sha, "units": len(pages), "chunks": count, "status": "pending-professional-review"})
output.parent.mkdir(parents=True, exist_ok=True)
output.write_text(json.dumps({"schemaVersion": "SIM_LOCAL_CORPUS_V1", "generationConnected": False, "sources": sources, "chunks": chunks}, ensure_ascii=False), encoding="utf-8")
print(json.dumps({"sources": len(sources), "chunks": len(chunks), "generationConnected": False}))
