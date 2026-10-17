"""Build apply_patch input for repository-wide design-navigation synchronization.
Historical facts are preserved. No file mutation occurs in this generator.
"""
from pathlib import Path
import json
import os
import re
import subprocess
import sys

ROOT = Path(__file__).resolve().parents[2]
DESIGN = ROOT / 'docs/design/resident-developer-agent-20261008'
sys.stdout.reconfigure(encoding='utf-8')
tracked = subprocess.check_output(['git','ls-files','-z','--','*.md'],cwd=ROOT).decode('utf-8').split('\0')
new = ['apps/agentarts-runtime/README.md','packages/agentarts/README.md',
       'docs/adr/0012-owned-agentarts-image.md','docs/adr/0013-resident-agent-wiki-wss.md',
       'docs/modules/AGENTARTS-OWNED-IMAGE-MIGRATION.md','docs/reviews/DESIGN_READING_GATE.md']
files = sorted({p for p in tracked+new if p
                and not p.startswith('docs/design/resident-developer-agent-20261008/')
                and '/fixtures/' not in p and '/demo-vault/' not in p
                and not p.startswith('docs/demo/knowledge/vault/')
                and not p.endswith('/SKILL.md')})
batch = int(sys.argv[1]) if len(sys.argv)>1 else 0
size = 24
chosen = files[batch*size:(batch+1)*size]
patches=[]
changed=[]
for relative in chosen:
    file=ROOT/relative
    if not file.exists():continue
    text=file.read_text(encoding='utf-8')
    title=next((line for line in text.splitlines()[:12] if line.startswith('# ')),None)
    if not title:continue
    link=lambda target:os.path.relpath(target,file.parent).replace('\\','/')
    design=link(DESIGN/'DESIGN.md')
    reader=link(DESIGN/'index.html')
    gate=link(ROOT/'docs/reviews/DESIGN_READING_GATE.md')
    note=f'<!-- current-design-20261009 -->\n> 当前目标与协作规则（2026-10-17）：[完整设计]({design}) · [离线阅读/全部 SVG]({reader}) · [当前 PR 审查规则]({gate})。WSS 主通道、HTTPS 备用；Wiki 记忆由 goo122 接入。常规 PR 须有四位协作者中任意一位非作者对当前 head 的有效 Approve；Owner 可对具体 PR 作有记录的审核例外。拥有合并权限者（包括作者）可在最新必需技术 CI、主线更新、无冲突和阻断性缺陷解决后合并；禁止强推、直接推 main 或绕过技术检查。设计不等于已实现；本文历史验收与作者记录保留，旧合并规则以当前门槛为准。'
    marker='<!-- current-design-20261009 -->'
    if marker in text:
        obsolete=next((line for line in text.splitlines()
                       if line.startswith('> 当前目标与协作规则（')
                       and ('goo122 与 Potatos498 均确认后' in line
                            or '禁止强制合并/管理员绕过' in line)),None)
        if obsolete is not None:
            patches.append(f'*** Update File: {file.as_posix()}\n@@\n-{obsolete}\n+{note.splitlines()[1]}\n')
            changed.append(relative)
        continue
    patches.append(f'*** Update File: {file.as_posix()}\n@@\n {title}\n+\n+'+note.replace('\n','\n+')+'\n')
    changed.append(relative)
result={'total':len(files),'batch':batch,'changed':changed,'patch':'*** Begin Patch\n'+''.join(patches)+'*** End Patch' if patches else None}
print(json.dumps(result,ensure_ascii=False))
