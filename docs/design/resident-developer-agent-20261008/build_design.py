"""Generate editable SVGs and an offline reader from the design snapshot.
Run with Python 3; no third-party dependency, no network or product mutation.
"""
from pathlib import Path
import html
import json
import re
import xml.etree.ElementTree as ET

HERE = Path(__file__).resolve().parent
ROOT = HERE.parents[2]
DATA = json.loads((HERE / 'modules.json').read_text(encoding='utf-8'))
MODS = DATA['modules']
COLORS = {'ui':'#2468ab','decision':'#7c4cad','foundation':'#276f61',
          'tools':'#a15e27','business':'#487238','dev':'#396b89',
          'release':'#726551','cloud':'#276caa'}

def esc(value):
    return html.escape(str(value), quote=True)

def units(text):
    return sum(1 if ord(c) > 255 else .55 for c in text)

def wrap(text, max_units):
    lines, line = [], ''
    for char in text:
        if units(line + char) > max_units and line:
            lines.append(line)
            line = ''
        line += char
    if line:
        lines.append(line)
    return lines

class SVG:
    def __init__(self, width, height, title, description):
        self.width, self.height = width, height
        self.items = [f'<svg xmlns="http://www.w3.org/2000/svg" width="{width}" height="{height}" viewBox="0 0 {width} {height}" role="img" aria-labelledby="title desc">',
                      f'<title id="title">{esc(title)}</title><desc id="desc">{esc(description)}</desc>',
                      '<defs><marker id="arrow" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="8" markerHeight="8" orient="auto-start-reverse"><path d="M 0 0 L 10 5 L 0 10 z" fill="#52687d"/></marker></defs>',
                      '<style>text{font-family:"Microsoft YaHei","Noto Sans CJK SC",sans-serif;fill:#183145} .muted{fill:#52697a} .white{fill:white} .strong{font-weight:700}</style>']
        self.rect(0, 0, width, height, '#f3f6fa', stroke='none', radius=0)

    def rect(self,x,y,w,h,fill='#fff',stroke='#d5dfe8',radius=14):
        self.items.append(f'<rect x="{x}" y="{y}" width="{w}" height="{h}" rx="{radius}" fill="{fill}" stroke="{stroke}"/>')

    def text(self,x,y,text,size=24,cls='',anchor='start'):
        self.items.append(f'<text x="{x}" y="{y}" font-size="{size}" class="{cls}" text-anchor="{anchor}">{esc(text)}</text>')

    def para(self,x,y,text,width,size=23,lineheight=None,cls='muted'):
        step = lineheight or size * 1.5
        lines = wrap(text, width / size)
        for i,line in enumerate(lines):
            self.text(x,y+i*step,line,size,cls)
        return y + len(lines)*step

    def line(self,x1,y1,x2,y2,color='#52687d',dash=False,both=False):
        style = 'stroke-dasharray="9 7"' if dash else ''
        start = 'marker-start="url(#arrow)"' if both else ''
        self.items.append(f'<path d="M{x1},{y1} L{x2},{y2}" fill="none" stroke="{color}" stroke-width="3" marker-end="url(#arrow)" {start} {style}/>')

    def path(self,d,dash=False):
        self.items.append(f'<path d="{d}" fill="none" stroke="#52687d" stroke-width="3" marker-end="url(#arrow)" '+('stroke-dasharray="9 7"' if dash else '')+'/>')

    def header(self,title,subtitle):
        self.text(50,72,title,40,'strong')
        self.text(50,119,subtitle,23,'muted')
        self.text(50,158,'2026-10-09 Wiki / WSS / 完整报告增量 · provisional 本地实现 · 完成度估算基线仍为 2026-10-08',21,'muted')

    def save(self,name):
        xml='\n'.join(self.items+['</svg>'])
        ET.fromstring(xml)
        (HERE/name).write_text(xml,encoding='utf-8')

def module_card(s,m,x,y,w,h=176):
    color=COLORS[m['zone']]
    s.items.append(f'<g data-module="{m["id"]}">')
    s.rect(x,y,w,h,'#fff',color)
    s.text(x+16,y+30,m['id'],21,'strong')
    s.text(x+w-16,y+30,f'{sum(m["points"])}%',25,'strong','end')
    for i,line in enumerate(wrap(m['name'],(w-30)/23)):
        s.text(x+16,y+64+i*27,line,23,'strong')
    s.text(x+16,y+111,m['owner'],18,'muted')
    # The full precise location and evidence remain in the module table.
    for i,line in enumerate(wrap(m['location'],(w-30)/17)[:3]):
        s.text(x+16,y+136+i*21,line,17,'muted')
    s.items.append('</g>')

def group(s,zone,title,note,y,h=270):
    s.rect(60,y,1740,h,'#edf3f8')
    s.text(80,y+35,title,27,'strong')
    mods=[m for m in MODS if m['zone']==zone]
    gap=12
    w=(1700-(len(mods)-1)*gap)/len(mods)
    for i,m in enumerate(mods):
        module_card(s,m,80+i*(w+gap),y+55,w)
    s.text(80,y+h-18,note,20,'muted')

def overview():
    s=SVG(2800,2900,'常驻自主开发者助手：完整模块架构','全部39模块、负责人、位置与目标完成度；本地执行事实源、云端编排、WSS主通道与HTTPS备用。')
    s.header('PersonalAgent · 常驻自主开发者助手：完整模块架构','电脑运行时无人监管：观察变化 → 可信决策 → 局部修复 → 委派执行与监管 → 实际读回')
    s.rect(40,190,1780,2230,'#fff')
    s.rect(1870,190,890,2230,'#fff')
    s.text(60,237,'本地电脑：可信宿主 + Runtime + 受限工具',29,'strong')
    s.text(1890,237,'华为 AgentArts：自有镜像 + 编排',29,'strong')
    definitions=[
        ('ui','① 用户入口与控制','语音/文字、责任面板、审批、证据与暂停；Renderer 经 Preload/IPC 接入。',270,270),
        ('decision','② 本地任务、世界图与决策','唯一任务事实源；Wiki→Memory 投影由 goo122 接入；Laya 选择合法候选；复杂规划调用云。',580,270),
        ('foundation','③ 契约、权限与持久化','一次性授权/租约、工具统一入口、去重与 checkpoint；云提案返回后必须再次过闸。',890,270),
        ('tools','④ 受限工具与上下文','Wiki/知识正文↔版本化记忆；MCP/Skills/Windows/编码；受控写回与真实隔离分别验证。',1200,270),
        ('business','⑤ 外部世界与业务能力','可信采集→FactChangeFeed；账户动作通过 ToolGateway；撤销/过期/去重均受控制。',1510,270),
        ('dev','⑥ 开发者责任工作流','GitHub/CI/测试/评审/文档/Issue；不是独立任务库，复用图、Runtime 与工具端口。',1820,270),
        ('release','⑦ 交付与分发','源码、固定镜像 digest、配置契约和验收一起交付；安装器仍是后续工作。',2130,270)]
    for definition in definitions:
        group(s,*definition)
    # Target data/control arrows; imports remain constrained by public ports.
    for y in (540,850,1160,1470,1780,2090):
        s.line(930,y,930,y+35)
    cloud = {m['id']:m for m in MODS if m['zone']=='cloud'}
    for mid,y,h,note in [
        ('MOD-29',270,270,'容器 /ws 本地 provisional；restartRecovery=false，公开网关与新版镜像待验收。'),
        ('MOD-04A',890,270,'公开模型包可复用；统一 Provider、取消与用量；模型不能签发权限。'),
        ('MOD-32',1200,270,'deployment/API/trace/评估/费用/回滚；平台成功不等于本地工具成功。'),
        ('MOD-10',1510,270,'横向研究：领域标注集、校准与训练；不作为每次调用必经步骤。')]:
        s.rect(1890,y,850,h,'#edf3f8')
        module_card(s,cloud[mid],1910,y+18,810,176)
        s.para(1910,y+223,note,810,21,27)
    s.rect(1890,580,850,270,'#edf3f8')
    module_card(s,cloud['MOD-30'],1910,598,399)
    module_card(s,cloud['MOD-31'],2321,598,399)
    s.para(1910,803,'完整World/Plan→Review→候选；缺来源RECHECK；工具仍由本地执行。',810,21,27)
    s.line(1820,692,1870,692,both=True)
    s.rect(1410,830,1320,50,'#e0effa',stroke='#78a9cf')
    s.text(1430,863,'WSS 主通道 ⇄ HTTPS 备用 · 同部署/同任务/同去重 · 可见降级',24,'strong')
    s.rect(1890,1820,850,270,'#fff4e6',stroke='#d6aa6c')
    s.text(1910,1858,'横向新增目标：尚未通过真实目标验收',25,'strong')
    for i,text in enumerate([
        'WSS 公开网关 + 结果未知/重启协调消费',
        '持久无人监管授权 + 完整委派/监管闭环',
        'Laya 领域校准 + 任意命令强沙箱',
        '新版云镜像 Golden Path + 迁移缺口验收']):
        s.text(1910,1906+i*44,text,22)
    s.rect(1890,2130,850,270,'#edf3f8')
    s.text(1910,2170,'构建 → GHCR 协作 → AgentArts 部署 → 验收',26,'strong')
    s.para(1910,2210,'ARM64 / 8080；/ws 与 POST /invocations。华为拉取按平台配置，必要时 SWR；公开 Upgrade 与身份仍需实测。',810,22,33)
    s.para(1910,2321,'不打包用户数据/密钥；固定 tag + digest；新部署失败显式暂停或回滚。',810,22,33)
    s.rect(40,2460,2720,160,'#fff')
    s.text(60,2501,'贯穿设计：权限、信任、隐私、状态恢复与证据',28,'strong')
    s.para(60,2542,'用户指令 ≠ 外部内容；云/模型输出先校验。数据最小投影；未知副作用先核实。父子任务取消需停止确认。切换传输不切换权限，不静默回退另一 Agent Profile。',2660,24,36)
    s.rect(40,2650,2720,195,'#fff')
    s.text(60,2691,'阅读图例与完成度口径',27,'strong')
    s.para(60,2730,'39 个模块全部入图。百分比 = 契约20 + 实现30 + 接线20 + 目标真实验收20 + 恢复安全10 的工程判断。详细区间、来源与缺口见 modules.json 和完整设计正文；不是成功概率，不等于历史 done。',2660,23,35)
    s.text(60,2815,'箭头展示目标流向；新流程仍可能未实现。所有跨模块调用通过公开端口，不表示可以任意互相导入。',22,'muted')
    s.save('architecture-overview.svg')

def lifecycle():
    s=SVG(2800,2540,'常驻自主闭环：从世界变化到委派监管','真实来源、Laya、双通道云编排、本地授权执行、读回、增量修复、停止与恢复。')
    s.header('自主闭环 · 每一步的输入、决策、权限与完成证据','事件驱动；仅修受影响节点；无变化时安静；任何不确定结果均保留待核实状态')
    lanes=[('世界与来源','09/17/20~26/33'),('本地状态与图','03/27/28'),('Laya 决策','28；不签发授权'),('双通道适配','02/04B/29'),('AgentArts 镜像','30/31/04A'),('Policy 与执行','05/06~08/16/18'),('读回与监管','03/23/27/28/32')]
    x0,w,gap=40,380,10
    for i,(name,mods) in enumerate(lanes):
        x=x0+i*(w+gap)
        s.rect(x,198,w,1810,'#fff')
        s.rect(x,198,w,85,'#ddeaf5')
        s.text(x+15,232,name,26,'strong')
        s.text(x+15,266,mods,19,'muted')
    def box(lane,y,title,body,h=128,fill='#eff5fa'):
        x=x0+lane*(w+gap)+12
        s.rect(x,y,w-24,h,fill)
        s.text(x+14,y+33,title,23,'strong')
        s.para(x+14,y+66,body,w-54,19,27)
    # Sequential rows leave space for clear arrows and feedback routes.
    box(0,310,'1. 可信采集','CI/文件/日历/订阅/状态；来源 revision + 时间 + 范围')
    box(1,465,'2. 事实入库、影响分析','去重与撤回；直接/传递依赖；仅限有效目标')
    s.path('M408,372 L435,372 L435,526 L442,526')
    box(2,620,'3. 合法候选选择','先滤过期/未授权；选择、弃权、升级；记录未校准')
    s.path('M798,528 L825,528 L825,680 L832,680')
    box(1,800,'简单/确定性处理','保留、核实或局部候选；无变化结束本轮；不忙等')
    s.path('M1020,748 L1020,775 L622,775 L622,800',True)
    box(3,800,'4. 需要语义编排','最小子图/版本/预算；WSS 主，未发送才 HTTPS 备用')
    s.path('M1020,748 L1020,775 L1410,775 L1410,800')
    box(4,955,'5. 云端角色协作','fast 或 World→Plan→Review；完整报告只形成候选')
    s.path('M1578,865 L1605,865 L1605,1016 L1612,1016')
    box(1,1120,'6. 本地重新核实','Schema/来源/工具/依赖；expectedRevision/CAS')
    s.path('M1800,1083 L1800,1102 L622,1102 L622,1120')
    box(2,1280,'必要时再选择/升级','最新合法候选；不能使用旧评分越过新权限')
    s.path('M798,1184 L825,1184 L825,1344 L832,1344',True)
    box(5,1440,'7. Policy → ToolGateway','参数/范围/期限再检查；审批或执行；保留 ToolRun')
    s.path('M1188,1344 L1210,1344 L1210,1414 L2190,1414 L2190,1440')
    box(4,1280,'多角色委派原则','子任务收窄授权；父子关系由 Runtime 管理',128,'#f3eef9')
    box(5,1600,'等待审批/协调分支','相关分支等待；独立任务继续；未知写入不重试',128,'#fff3e3')
    s.line(2190,1568,2190,1600)
    box(6,1760,'8. 外部读回与 Evidence','执行结果 + 来源版本；verified/conditional 分开')
    s.path('M2360,1505 L2390,1505 L2390,1824 L2398,1824')
    box(1,1760,'9. 状态提交与后继计划','Runtime 定终态；图更新；终结任务不重开')
    s.path('M2580,1888 L2580,1935 L622,1935 L622,1888')
    box(6,1440,'10. 监管与通知','到期/变化检查；重要变更通知；无变化保持安静',128,'#eef6ec')
    s.path('M2580,1760 L2580,1568')
    s.path('M2580,1440 L2580,1426 L2778,1426 L2778,2020 L18,2020 L18,373 L52,373',True)
    s.rect(40,2050,2720,180,'#fff3e3',stroke='#d6aa6c')
    s.text(60,2093,'停止与恢复：所有分支共同遵守',28,'strong')
    s.para(60,2135,'发送前持久意图；发送后未知进入 waiting_reconciliation，不改走备用重发。重启遇未清 checkpoint 阻止再发送。暂停/取消传递并确认停止；授权已消费不重用。当前防重发为本地 provisional，完整查询恢复与真实副作用核实另验收。',2660,25,37)
    s.rect(40,2260,2720,225,'#fff')
    s.text(60,2303,'一个完整示例：持续维护 PR 的 CI',28,'strong')
    s.para(60,2346,'真实 CI run 失败 → 影响对应 commit 的发布结论 → Laya 判断核实/定位 → AgentArts 编排测试定位与修复提案 → 本地 Policy 允许范围内补丁 → 运行相关测试并读回 diff → 记录证据 → 创建监管任务，等待新 CI 结果；出现新 commit 时旧评审自动失效。',2660,25,38)
    s.text(60,2450,'各泳道是职责，非必然独立进程；流程为目标设计，现有能力和缺口以模块快照为准。',22,'muted')
    s.save('autonomy-lifecycle.svg')

def trust_transport():
    s=SVG(2800,2040,'信任、双通道恢复与发布架构','用户权限与沙箱独立；双通道同语义；本地执行事实源；发布验收与回滚。')
    s.header('信任与连接 · 双通道恢复 · 发布与验收','WSS 是主通道；HTTPS 是同一 AgentArts 的备用；切换传输不增加权限')
    panels=[(40,210,870,580,'A. 用户与本地可信边界'),(940,210,870,580,'B. AgentArts 与外部输入边界'),(1840,210,920,580,'C. 执行限制与证据边界')]
    for x,y,w,h,title in panels:
        s.rect(x,y,w,h,'#fff')
        s.text(x+20,y+43,title,28,'strong')
    texts=[
        ['用户指令 / 明确预授权','Renderer：输入与显示，不能持有密钥','Preload/IPC → Client → Runtime Application','可信宿主：配置、凭据适配与租约','Policy：目标/工具/范围/参数/期限/revision','TaskRuntime：任务终态与持久执行记录'],
        ['云/模型/网页/邮件/Issue：不可信数据','最小可导出子图；不发送原始凭据','云编排返回候选，经过 Schema 与新鲜度检查','无权更改本机权限或直接操作 OS','认证失败停止；协议不兼容明确拒绝','Trace 是云追踪，不替代本机读回'],
        ['工具统一经过 ToolGateway / Connector Host','固定能力、受限账户、目录和资源锁','沙箱：文件/网络/进程的实际隔离','路径检查与超时不是强 OS 沙箱','任意 Shell 自主执行：当前不开放','实际副作用读回 → Evidence → Runtime']]
    for (x,y,w,h,_),lines in zip(panels,texts):
        for i,line in enumerate(lines):
            s.para(x+20,y+103+i*72,line,w-40,23,29)
    s.rect(40,825,2720,595,'#fff')
    s.text(60,870,'双通道状态：只有确认业务受理与执行结果后，才能安全切换',29,'strong')
    nodes=[(80,940,420,'WSS_CONNECTING','握手/认证/能力协商'),(660,940,420,'WSS_READY','严格受理/结果与继续轮次'),(1250,940,480,'RECONCILING','已发送后未知；阻止重复发送'),(1920,940,700,'HTTPS_READY','同目标 POST；仅未发送连接失败可备用')]
    for x,y,w,title,body in nodes:
        s.rect(x,y,w,140,'#e7f0f8')
        s.text(x+20,y+42,title,26,'strong')
        s.para(x+20,y+88,body,w-40,23,31)
    s.line(500,1010,660,1010)
    s.line(1080,1010,1250,1010)
    s.text(1096,978,'断线',20)
    s.path('M290,940 L290,904 L2270,904 L2270,940',True)
    s.text(1320,925,'invoke 从未发送才可自动备用',21)
    s.path('M2270,1080 L2270,1140 L870,1140 L870,1080',True)
    s.text(1120,1175,'目标恢复：验证 WSS → 暂停新发送 → 核实 → 后续调用回主通道',24)
    s.para(80,1230,'本地 provisional：0.1.0严格信封；发送前持久意图，未知结果/重启标记阻止重发。容器仅有界内存回执，restartRecovery=false；status unknown不能解释为未执行。HTTPS当前为单轮JSON事件数组，持久查询/游标恢复消费者待验收。',2540,24,36)
    s.text(80,1378,'真实网关、凭据/Upgrade与恢复另验收；认证/协议失败不触发备用，也不切换产品 Profile。',25,'strong')
    s.rect(40,1460,2720,520,'#fff')
    s.text(60,1505,'发布链与各层验收：本地构建成功不能替代云端 Golden Path',29,'strong')
    labels=[('受限构建','ARM64 / 锁依赖 / 非 root'),('GHCR 协作 / 拉取','固定digest；云端按平台配置'),('AgentArts 部署','版本 / 身份 / /ws 与 HTTP'),('真实闭环','提案 → Policy → 工具 → 读回'),('评估与上线','领域评估 / 小范围 / 回滚')]
    for i,(title,body) in enumerate(labels):
        x=70+i*540
        s.rect(x,1550,510,155,'#eef4fa')
        s.text(x+18,1592,title,27,'strong')
        s.para(x+18,1635,body,474,23,31)
        if i<4:
            s.line(x+510,1625,x+540,1625)
    s.para(70,1760,'协作者共享：源码 + 契约 + 配置说明 + 固定镜像 + 验收记录；个人密钥与原始认证导出不共享。新版本兼容旧 checkpoint；不兼容时暂停/迁移，不能通过切换传输掩盖。',2650,24,36)
    s.para(70,1870,'每个真实验证分别记录 deployment/API/trace、工具参数摘要、实际读回与终态。Fake、隔离合成测试、控制台页面状态各自有价值，均不足以单独证明完整产品可用。',2650,24,36)
    s.save('trust-and-transport.svg')

def wiki_memory():
    s=SVG(2800,1830,'Wiki 接入长期记忆：goo122 实施','Wiki 正文、Memory 事实投影、Runtime 受控写回、来源失效、隐私和跨存储恢复；新增目标未验收。')
    s.header('Wiki ↔ 长期记忆 · 来源、版本、写回与增量修复','实施负责人 goo122：MOD-08/09；zemeng 通过公开端口消费；不把执行状态或授权写成 Wiki 台账')
    def block(x,y,w,h,title,body,color='#eef4fa'):
        s.rect(x,y,w,h,color)
        s.text(x+22,y+43,title,28,'strong')
        s.para(x+22,y+92,body,w-44,25,39)
    block(50,230,720,430,'① 原始来源 / 用户编辑','项目资料、确认偏好、排障经验；保留原来源与观察时间。用户选择库和范围；读取、写入、发送云端分别授权。扫描失败不等于页面删除。')
    block(1000,230,760,430,'② MOD-08 Wiki / 知识适配','知识正文、稳定页面身份、revision、段落/块引用与链接。优先复用 Markdown/Obsidian 基础；具体 Wiki 适配由 goo122 选择。内容变化后旧引用失效。')
    block(1990,230,760,430,'③ MOD-09 Memory 投影','来源绑定的 Fact、检索索引、确认级别和 FactChangeFeed。投影可重建；不制造与 Wiki 脱离的第二份真相。相同来源 revision 去重；撤回传播。')
    s.line(770,445,1000,445)
    s.text(804,413,'受信读取',23)
    s.line(1760,445,1990,445)
    s.text(1786,413,'版本化引用',23)
    block(1990,840,760,440,'④ MOD-27/28 图与认知','消费公开 MemoryQueryPort / FactChangeFeed。Wiki 变化影响相关 Goal/Plan，触发局部核实和修复。链接关系不自动等于执行依赖；未经确认的模型摘要不是事实。','#f2edf8')
    s.line(2370,660,2370,840)
    s.text(2396,764,'变化/撤回/新鲜度',23)
    block(1000,840,760,440,'⑤ MOD-03/05 Runtime 受控写回','执行 Evidence 或用户输入 → 精确补丁提案 → Policy 审批/有效预授权 → ToolGateway。绑定 source/config、baseline 与 edits；写后备份和实际哈希读回。','#edf6ef')
    s.line(1990,1060,1760,1060)
    s.text(1776,1028,'候选，不是授权',22)
    s.line(1380,840,1380,660)
    s.text(1400,760,'受控更新正文',23)
    block(50,840,720,440,'⑥ 对话检索 / 云端最小投影','回答带来源与版本；变更返回 SOURCE_CHANGED 或重新核实。private 默认不出机；摘要/索引继承敏感级别。本地可检索不等于可送 AgentArts。')
    s.path('M2370,1280 L2370,1340 L410,1340 L410,1280')
    s.text(860,1384,'只提供当前有效、已授权、可核实的内容与引用；任务状态仍由 Runtime 管理',25)
    s.rect(50,1440,2700,325,'#fff4e6',stroke='#d6aa6c')
    s.text(72,1485,'一致性与恢复：目标设计，不提升已有完成度',28,'strong')
    s.para(72,1530,'Wiki 文件 + Memory SQLite 无天然跨存储原子事务。正文已核实、投影待更新 → 持久 pending/receipt → 重启读回后补投影；未知写入不盲重试。统一采集 + operation/revision 去重避免回写循环。',2655,25,40)
    s.para(72,1651,'来源切换/权限撤销取消旧租约；持久无人监管权限另行实现。修改、删除、移动、越界、私人出机、版本冲突与崩溃恢复必须验收。交付依据见 WIKI-MEMORY-HANDOFF.md。',2655,25,40)
    s.save('wiki-memory.svg')

def module_table():
    rows=['| 模块 | 负责人 / 位置 | 估算与区间 | 五项得分 | 依据与主要剩余缺口 |',
          '| --- | --- | --- | --- | --- |']
    for m in MODS:
        rows.append(f'| {m["id"]} {m["name"]} | {m["owner"]}<br>{m["location"]} | **{sum(m["points"])}%**；{m["range"]} | {" / ".join(map(str,m["points"]))} | 依据：{m["evidence"]}<br>缺口：{m["gap"]} |')
    path=HERE/'DESIGN.md'
    original=path.read_text(encoding='utf-8')
    text=re.sub(r'<!-- MODULE_TABLE_START -->.*?<!-- MODULE_TABLE_END -->',
                '<!-- MODULE_TABLE_START -->\n'+ '\n'.join(rows)+'\n<!-- MODULE_TABLE_END -->',
                original, flags=re.S)
    path.write_text(text,encoding='utf-8')
    return text

def inline(text):
    text=esc(text)
    text=re.sub(r'`([^`]+)`',r'<code>\1</code>',text)
    text=re.sub(r'\*\*([^*]+)\*\*',r'<strong>\1</strong>',text)
    text=re.sub(r'\[([^\]]+)\]\(([^)]+)\)',r'<a href="\2">\1</a>',text)
    return text.replace('&lt;br&gt;','<br>')

def markdown(text, prefix='section'):
    lines=text.splitlines()
    out, nav=[],[]
    i=0
    while i<len(lines):
        line=lines[i]
        if not line.strip() or line.startswith('<!--'):
            i+=1
            continue
        if line.startswith('```'):
            i+=1
            block=[]
            while i<len(lines) and not lines[i].startswith('```'):
                block.append(lines[i]); i+=1
            out.append('<pre>'+esc('\n'.join(block))+'</pre>'); i+=1
            continue
        if line.startswith('#'):
            level=len(line)-len(line.lstrip('#'))
            title=line[level:].strip()
            anchor=prefix+'-'+str(len(nav)) if level==2 else prefix+'-heading-'+str(i)
            out.append(f'<h{level} id="{anchor}">{inline(title)}</h{level}>')
            if level==2:
                nav.append(f'<a href="#{anchor}">{esc(title)}</a>')
            i+=1
            continue
        if line.startswith('|'):
            rows=[]
            while i<len(lines) and lines[i].startswith('|'):
                cells=[c.strip() for c in lines[i].strip().strip('|').split('|')]
                if not all(re.fullmatch(r'[-: ]+',c) for c in cells):
                    tag='th' if not rows else 'td'
                    rows.append('<tr>'+''.join(f'<{tag}>{inline(c)}</{tag}>' for c in cells)+'</tr>')
                i+=1
            out.append('<div class="table-wrap"><table>'+''.join(rows)+'</table></div>')
            continue
        if re.match(r'^\d+\. ',line):
            entries=[]
            while i<len(lines) and re.match(r'^\d+\. ',lines[i]):
                entries.append('<li>'+inline(re.sub(r'^\d+\. ','',lines[i]))+'</li>'); i+=1
            out.append('<ol>'+''.join(entries)+'</ol>')
            continue
        out.append('<p>'+inline(line)+'</p>'); i+=1
    return ''.join(out),''.join(nav)

def reader(text):
    content,nav=markdown(text)
    pictures=[]
    for filename,label in [('architecture-overview.svg','全部 39 模块与部署位置'),('autonomy-lifecycle.svg','自主闭环与委派监管'),('trust-and-transport.svg','信任边界、双通道与发布'),('wiki-memory.svg','Wiki 接入长期记忆 · goo122 实施')]:
        svg=(HERE/filename).read_text(encoding='utf-8')
        stem=filename.removesuffix('.svg')
        svg=svg.replace('aria-labelledby="title desc"',f'aria-labelledby="{stem}-title {stem}-desc"')
        for ident in ('title','desc','arrow'):
            svg=svg.replace(f'id="{ident}"',f'id="{stem}-{ident}"').replace(f'url(#{ident})',f'url(#{stem}-{ident})')
        pictures.append(f'<section class="diagram"><div class="diagram-title"><h2>{label}</h2><a href="{filename}">打开原尺寸 SVG</a></div><div class="svg-scroll">{svg}</div></section>')
    cards=[]
    for m in MODS:
        points=sum(m['points'])
        cards.append(f'<article class="module" data-search="{esc(m["id"]+m["name"]+m["owner"]+m["location"]+m["gap"])}"><div class="module-head"><strong>{esc(m["id"])} · {esc(m["name"])}</strong><b>{points}%</b></div><div class="progress"><span style="width:{points}%"></span></div><p>{esc(m["owner"])} · {esc(m["location"])}</p><p>估算区间：{esc(m["range"])}；得分：{" / ".join(map(str,m["points"]))}</p><p><strong>缺口：</strong>{esc(m["gap"])}</p><p class="evidence">依据：{esc(m["evidence"])}</p></article>')
    template='''<!doctype html><html lang="zh-CN"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>PersonalAgent · 常驻自主开发者助手完整方案</title><style>
    *{box-sizing:border-box}html{scroll-behavior:smooth}body{margin:0;background:#f1f5f8;color:#203345;font:16px/1.8 "Microsoft YaHei",sans-serif}a{color:#216ca8}header{padding:36px 4vw 24px;background:#142e46;color:#fff}header h1{font-size:30px;margin:0 0 12px}header p{max-width:1100px;margin:6px 0}header a{color:#b8ddfc}.chips{display:flex;gap:12px;flex-wrap:wrap;margin-top:18px}.chips span{background:#244760;border-radius:8px;padding:3px 12px}main{padding:28px 4vw}section{margin-bottom:28px;background:white;border:1px solid #d7e0e8;border-radius:14px;padding:24px}.diagram-title{display:flex;gap:20px;align-items:center;justify-content:space-between}h2{font-size:24px;line-height:1.5}.svg-scroll{overflow:auto;border:1px solid #dbe3eb;background:#f3f6fa}.svg-scroll svg{display:block;width:100%;height:auto;min-width:1200px}.toolbar{display:flex;gap:12px;flex-wrap:wrap;align-items:center;margin:12px 0}button,input{font:inherit;padding:6px 12px;border:1px solid #bdcedb;border-radius:7px;background:white}button{cursor:pointer}input{min-width:260px;max-width:100%}.module-grid{display:grid;grid-template-columns:repeat(auto-fit,minmax(330px,1fr));gap:16px}.module{border:1px solid #dae3ea;border-radius:10px;padding:16px}.module-head{display:flex;justify-content:space-between;gap:12px}.module-head b{color:#256a9c;font-size:23px}.module p{margin:8px 0;font-size:14px;overflow-wrap:anywhere}.progress{height:6px;background:#e4edf3;border-radius:6px;margin:12px 0}.progress span{display:block;height:100%;background:#4184b6;border-radius:6px}.evidence{color:#5c7080}.document-layout{display:grid;grid-template-columns:250px minmax(0,1fr);gap:28px}.toc{position:sticky;top:12px;align-self:start;max-height:90vh;overflow:auto;font-size:14px}.toc a{display:block;padding:4px 0}.document{max-width:1200px}.document h2{border-top:1px solid #dce5ed;padding-top:24px;margin-top:38px;scroll-margin-top:15px}.document h3{margin-top:24px}p{overflow-wrap:anywhere}table{border-collapse:collapse;width:100%;font-size:14px}th,td{border:1px solid #dbe3ea;padding:10px;vertical-align:top;text-align:left}th{background:#edf4fa}.table-wrap{overflow:auto;margin:20px 0}pre{overflow:auto;background:#edf4fa;padding:18px;font:14px/1.7 Consolas,"Microsoft YaHei",monospace}code{background:#edf3f8;padding:1px 4px;border-radius:4px}.note{color:#765322;background:#fff4e4;padding:12px 16px;border-radius:8px}footer{padding:20px 4vw;color:#5c7080}@media(max-width:900px){.document-layout{display:block}.toc{position:static;max-height:250px;margin-bottom:24px}main{padding:16px}section{padding:16px}header{padding:24px}.module-grid{grid-template-columns:1fr}}@media print{header{background:white;color:#203345}.toolbar,.toc{display:none}.document-layout{display:block}.svg-scroll svg{min-width:0}section{break-inside:auto}.module-grid{grid-template-columns:1fr 1fr}}
    </style></head><body><header><h1>PersonalAgent · 常驻自主开发者助手</h1><p>完整目标设计：电脑运行时，持续观察世界状态、增量修复计划、委派执行与监管。Laya 辅助结构化判断，权限与沙箱决定能否执行。</p><div class="chips"><span>WSS 主通道</span><span>HTTPS 备用</span><span>39 个模块</span><span>2026-10-08 快照</span><span>proposed · 设计交付</span></div><p><a href="DESIGN.md">完整 Markdown</a> · <a href="modules.json">模块估算数据</a> · <a href="build_design.py">可编辑生成器</a></p></header><main><section><p class="note">百分比是距离本目标的工程估算，包含区间与来源；不是线上成功率。横向新增能力仍待真实验收。这里只交付设计，没有修改产品代码或部署云端。</p><div class="toolbar"><span>图缩放：</span><button id="fit">适应阅读宽度</button><button id="actual">原尺寸</button><button id="larger">放大</button><span id="zoom-label">适应</span></div></section>__PICTURES__<section id="module-section"><h2>39 个模块 · 负责人、位置、估算与缺口</h2><div class="toolbar"><input id="search" type="search" placeholder="搜索模块、负责人、目录或缺口" aria-label="筛选模块"><span id="count">39 / 39</span></div><div class="module-grid">__CARDS__</div></section><section><div class="document-layout"><nav class="toc" aria-label="方案目录">__NAV__</nav><div class="document">__CONTENT__</div></div></section></main><footer>离线自包含阅读页；图为目标流向，真实实现以源码及验收为准。没有远程脚本、分析埋点或网络请求。</footer><script>
    const diagrams=[...document.querySelectorAll('.svg-scroll svg')]; let zoom=1;
    function setZoom(value){zoom=value;for(const s of diagrams){s.style.width=value===0?'100%':`${2800*value}px`;s.style.minWidth=value===0?'1200px':'0';}document.querySelector('#zoom-label').textContent=value===0?'适应':`${Math.round(value*100)}%`;}
    document.querySelector('#fit').onclick=()=>setZoom(0);document.querySelector('#actual').onclick=()=>setZoom(1);document.querySelector('#larger').onclick=()=>setZoom(zoom===0?.65:Math.min(2,zoom+.25));
    document.querySelector('#search').oninput=e=>{const q=e.target.value.trim().toLowerCase();let visible=0;for(const m of document.querySelectorAll('.module')){const match=m.dataset.search.toLowerCase().includes(q);m.hidden=!match;if(match)visible++;}document.querySelector('#count').textContent=`${visible} / 39`;};
    setZoom(0);
    </script></body></html>'''
    handoff,_=markdown((HERE/'WIKI-MEMORY-HANDOFF.md').read_text(encoding='utf-8'),prefix='wiki')
    pictures.append('<section id="wiki-handoff"><h2>Wiki 接入实施交接 · goo122</h2>'+handoff+'</section>')
    template=template.replace('这里是设计交付','此页面展示目标设计').replace('这里只有设计交付','此页面展示目标设计')
    template=template.replace('这里只交付设计，没有修改产品代码或部署云端。','此页面展示目标设计与10-09本地 provisional 增量：WSS、防重发和完整报告已有局部代码验证；新版镜像/父集成/真实云端待验收。百分比保留10-08基线，Wiki仍由goo122实施。')
    template=template.replace('<span>2026-10-08 快照</span>','<span>估算基线 2026-10-08</span><span>2026-10-09 本地增量</span>')
    template=template.replace('<a href="build_design.py">可编辑生成器</a>','<a href="build_design.py">可编辑生成器</a> · <a href="WIKI-MEMORY-HANDOFF.md">Wiki 交接</a>')
    page=template.replace('__PICTURES__',''.join(pictures)).replace('__CARDS__',''.join(cards)).replace('__NAV__',nav).replace('__CONTENT__',content)
    (HERE/'index.html').write_text(page,encoding='utf-8')

def validate():
    expected={'MOD-'+str(i).zfill(2) for i in range(1,39) if i!=4}|{'MOD-04A','MOD-04B'}
    assert len(MODS)==39 and {m['id'] for m in MODS}==expected
    limits=[20,30,20,20,10]
    for m in MODS:
        assert len(m['points'])==5
        assert all(0<=p<=limit for p,limit in zip(m['points'],limits)),m['id']
        for source in m['evidence'].split('；'):
            assert (ROOT/source.strip()).exists(),(m['id'],source)
    root=ET.parse(HERE/'architecture-overview.svg').getroot()
    ids=[e.attrib['data-module'] for e in root.iter() if 'data-module' in e.attrib]
    assert len(ids)==39 and set(ids)==expected
    for name in ['autonomy-lifecycle.svg','trust-and-transport.svg','wiki-memory.svg']:
        ET.parse(HERE/name)
    assert (HERE/'index.html').read_text(encoding='utf-8').count('class="module"')==39
    print('Validated: 39 unique modules; score bounds; all evidence paths; four SVG XML files; offline reader and Wiki handoff.')

def archive():
    import zipfile
    names=['DESIGN.md','VERIFICATION.md','WIKI-MEMORY-HANDOFF.md','index.html',
           'architecture-overview.svg','autonomy-lifecycle.svg','trust-and-transport.svg',
           'wiki-memory.svg','modules.json','review-manifest.json','build_design.py']
    with zipfile.ZipFile(HERE/'modules.zip','w',zipfile.ZIP_DEFLATED) as output:
        for name in names:
            output.write(HERE/name,arcname=name)
    print('Offline archive refreshed: 11 design files including Wiki and the review manifest.')

if __name__=='__main__':
    import sys
    if '--archive-only' in sys.argv:
        archive()
        raise SystemExit(0)
    overview()
    lifecycle()
    trust_transport()
    wiki_memory()
    reader(module_table())
    validate()
