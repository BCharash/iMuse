#!/usr/bin/env python3
"""Regenerate offline lab asset hashes after changing lab code or bundled models."""
import hashlib
import json
from pathlib import Path
ROOT=Path(__file__).resolve().parents[1]
paths=[ROOT/'lab.html',ROOT/'lab-sw.js']
paths += [p for p in (ROOT/'js/lab').rglob('*') if p.is_file() and not p.name.startswith('.') and p.name not in ['manifest.json','silero-v5.js']]
paths += [ROOT/'js/heed'/name for name in ['wakeword.js','preprocessing.js','filter-coeffs.js','wake.json','wake.onnx']]
assets=[]
for path in sorted(paths):
    data=path.read_bytes()
    assets.append({'path':str(path.relative_to(ROOT)),'bytes':len(data),'sha256':hashlib.sha256(data).hexdigest()})
manifest={'version':1,'cache':'imuse-simple-lab-v2','bytes':sum(asset['bytes'] for asset in assets),'assets':assets}
(ROOT/'js/lab/manifest.json').write_text(json.dumps(manifest,indent=2)+'\n')
print(f"{len(assets)} lab assets, {manifest['bytes']/1048576:.1f} MiB")
