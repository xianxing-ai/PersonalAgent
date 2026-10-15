// Generated from reviewed architecture.json by scripts/import-owned-workflows.mjs.
// Source projection sha256: 5519f9fd71790035a342830e78163530a1526ed220ee56969fb066bc90b5d360
export const OWNED_WORKFLOW_SOURCE: unknown = [
  {
    "id": "F01",
    "name": "主对话与责任理解",
    "nodes": [
      {
        "id": "F01_N01",
        "label": "保存可信用户原句、来源与指令版本",
        "kind": "input",
        "dependencies": [],
        "required": true,
        "resourceKeys": [],
        "effectType": "读取",
        "inputFields": [
          "文字或最终语音转写",
          "可信会话来源"
        ],
        "outputFields": [
          "完整指令引用",
          "条件与否定原文"
        ]
      },
      {
        "id": "F01_N02",
        "label": "并行召回有效责任、上下文与能力",
        "kind": "tool_exec",
        "dependencies": [
          "F01_N01"
        ],
        "required": true,
        "resourceKeys": [],
        "effectType": "读取",
        "inputFields": [
          "事件元数据或已知查询对象",
          "现有数据范围"
        ],
        "outputFields": [
          "责任版本",
          "事实片段",
          "模板/模型能力"
        ],
        "evidenceRequirement": "每个引用可回到原始来源；事实记录与动作授权分别标记。"
      },
      {
        "id": "F01_N03",
        "label": "唯一主模型联合判断责任、计划与分工",
        "kind": "semantic_decision",
        "dependencies": [
          "F01_N02"
        ],
        "required": true,
        "resourceKeys": [],
        "effectType": "读取",
        "inputFields": [
          "原句",
          "有效召回",
          "当前任务快照"
        ],
        "outputFields": [
          "责任候选",
          "任务图候选",
          "模型/思考配置候选",
          "就绪或需扩充建议"
        ]
      },
      {
        "id": "F01_N04",
        "label": "宿主检查引用、适用范围与现有授权",
        "kind": "deterministic_check",
        "dependencies": [
          "F01_N03"
        ],
        "required": true,
        "resourceKeys": [],
        "effectType": "读取",
        "inputFields": [
          "来源定位",
          "指令revision",
          "现有授权记录",
          "动作对象及参数"
        ],
        "outputFields": [
          "可采用候选或待澄清项"
        ],
        "evidenceRequirement": "字符串出现不证明自然语言等价；不能把“别发给张总”反转成发送授权。"
      },
      {
        "id": "F01_N05",
        "label": "F28适配执行模型与实际支持参数",
        "kind": "deterministic_check",
        "dependencies": [
          "F01_N04"
        ],
        "required": true,
        "resourceKeys": [],
        "effectType": "读取",
        "inputFields": [
          "已校验分工候选",
          "原生能力目录"
        ],
        "outputFields": [
          "子任务配置"
        ],
        "evidenceRequirement": "消费主模型已有分派建议；只有新问题才再调用同一主决策配置。"
      },
      {
        "id": "F01_N06",
        "label": "TaskRuntime建立责任关联任务图",
        "kind": "checkpoint",
        "dependencies": [
          "F01_N05"
        ],
        "required": true,
        "resourceKeys": [],
        "effectType": "本地状态 / 缓存",
        "inputFields": [],
        "outputFields": [
          "任务revision",
          "依赖边",
          "责任来源引用"
        ]
      },
      {
        "id": "F01_N07",
        "label": "缺信息：在既有数据范围扩充检索",
        "kind": "tool_exec",
        "dependencies": [
          "F01_N03"
        ],
        "required": false,
        "resourceKeys": [],
        "effectType": "读取",
        "inputFields": [],
        "outputFields": [
          "新片段与来源版本",
          "是否产生新信息"
        ],
        "condition": "需要新证据且数据范围已授权"
      },
      {
        "id": "F01_N08",
        "label": "真正歧义：主动语音或文字补问",
        "kind": "wait_user",
        "dependencies": [
          "F01_N04"
        ],
        "required": false,
        "resourceKeys": [],
        "effectType": "读取",
        "inputFields": [],
        "outputFields": [
          "绑定当前问题的回答"
        ],
        "condition": "缺少关键条件、授权或责任范围有实际变化"
      },
      {
        "id": "F01_N09",
        "label": "明确已授权责任直接激活并留来源",
        "kind": "checkpoint",
        "dependencies": [
          "F01_N04"
        ],
        "required": false,
        "resourceKeys": [],
        "effectType": "本地状态 / 缓存",
        "inputFields": [],
        "outputFields": [
          "有效责任版本",
          "适用范围",
          "撤销/变更关联"
        ],
        "condition": "持久责任含义明确且现有授权覆盖"
      }
    ],
    "edges": [
      {
        "source": "F01_N01",
        "target": "F01_N02",
        "required": true
      },
      {
        "source": "F01_N02",
        "target": "F01_N03",
        "required": true
      },
      {
        "source": "F01_N03",
        "target": "F01_N04",
        "required": true
      },
      {
        "source": "F01_N04",
        "target": "F01_N05",
        "required": true
      },
      {
        "source": "F01_N05",
        "target": "F01_N06",
        "required": true
      },
      {
        "source": "F01_N03",
        "target": "F01_N07",
        "required": false,
        "condition": "按需"
      },
      {
        "source": "F01_N07",
        "target": "F01_N03",
        "required": false,
        "condition": "有新信息"
      },
      {
        "source": "F01_N04",
        "target": "F01_N08",
        "required": false,
        "condition": "实际缺失"
      },
      {
        "source": "F01_N08",
        "target": "F01_N03",
        "required": false,
        "condition": "回答到达"
      },
      {
        "source": "F01_N04",
        "target": "F01_N09",
        "required": false,
        "condition": "持久责任"
      }
    ],
    "recovery": [
      "只重做来源或输入已失效的分支；保留仍有效结果、版本与操作记录。",
      "取消先传播到本地宿主；已发生副作用保留，未知写入先读回核实。",
      "截止时间、取消与实际配置贯穿模型及工具；不新增固定轮数、金额或预算限制。"
    ]
  },
  {
    "id": "F02",
    "name": "语音交互与确认",
    "nodes": [
      {
        "id": "F02_N01",
        "label": "可信操作摘要：对象、参数、问题ID与revision",
        "kind": "deterministic_check",
        "dependencies": [],
        "required": true,
        "resourceKeys": [],
        "effectType": "读取",
        "inputFields": [
          "可信任务及操作",
          "审批revision",
          "参数指纹"
        ],
        "outputFields": [],
        "condition": "已有Policy确实需要用户决定或关键含义仍不明确"
      },
      {
        "id": "F02_N02",
        "label": "主动询问：本地播报与文字同步",
        "kind": "tool_exec",
        "dependencies": [
          "F02_N01"
        ],
        "required": true,
        "resourceKeys": [],
        "effectType": "读取",
        "inputFields": [],
        "outputFields": []
      },
      {
        "id": "F02_N03",
        "label": "可信语音会话的最终转写；中途与回声不作确认",
        "kind": "input",
        "dependencies": [
          "F02_N02"
        ],
        "required": true,
        "resourceKeys": [],
        "effectType": "读取",
        "inputFields": [
          "ASR最终text",
          "宿主语音会话引用",
          "当前问题记录"
        ],
        "outputFields": []
      },
      {
        "id": "F02_N04",
        "label": "有歧义、修改或条件时解释语义",
        "kind": "semantic_decision",
        "dependencies": [
          "F02_N03"
        ],
        "required": false,
        "resourceKeys": [],
        "effectType": "读取",
        "inputFields": [],
        "outputFields": []
      },
      {
        "id": "F02_N05",
        "label": "检查当前问题、revision、参数指纹与一次消费",
        "kind": "deterministic_check",
        "dependencies": [
          "F02_N03"
        ],
        "required": true,
        "resourceKeys": [],
        "effectType": "读取",
        "inputFields": [],
        "outputFields": [],
        "condition": "明确回答或经过语义解释的回答；中途转写、回声、沉默不消费授权"
      },
      {
        "id": "F02_N06",
        "label": "明确同意：交回既有Policy，执行后核实",
        "kind": "tool_exec",
        "dependencies": [
          "F02_N05"
        ],
        "required": true,
        "resourceKeys": [],
        "effectType": "写入（以工具描述为准）",
        "inputFields": [],
        "outputFields": []
      },
      {
        "id": "F02_N07",
        "label": "修改或条件：旧确认失效，再核对已有授权",
        "kind": "checkpoint",
        "dependencies": [
          "F02_N04"
        ],
        "required": false,
        "resourceKeys": [],
        "effectType": "读取",
        "inputFields": [],
        "outputFields": [
          "新候选revision",
          "是否仍需要新决定"
        ]
      },
      {
        "id": "F02_N08",
        "label": "拒绝：本地停止当前动作，独立分支继续",
        "kind": "deterministic_check",
        "dependencies": [
          "F02_N03"
        ],
        "required": false,
        "resourceKeys": [],
        "effectType": "读取",
        "inputFields": [],
        "outputFields": []
      },
      {
        "id": "F02_N09",
        "label": "本地直接停止入口：不等待ASR或云模型",
        "kind": "deterministic_check",
        "dependencies": [],
        "required": false,
        "resourceKeys": [],
        "effectType": "读取",
        "inputFields": [],
        "outputFields": []
      },
      {
        "id": "F02_N10",
        "label": "ASR / 云端不可用：显示本地操作入口",
        "kind": "deterministic_check",
        "dependencies": [
          "F02_N03"
        ],
        "required": false,
        "resourceKeys": [],
        "effectType": "读取",
        "inputFields": [],
        "outputFields": []
      },
      {
        "id": "F02_N11",
        "label": "核实操作结果并反馈",
        "kind": "verification",
        "dependencies": [
          "F02_N06"
        ],
        "required": true,
        "resourceKeys": [],
        "effectType": "读取",
        "inputFields": [],
        "outputFields": []
      }
    ],
    "edges": [
      {
        "source": "F02_N01",
        "target": "F02_N02",
        "required": false
      },
      {
        "source": "F02_N02",
        "target": "F02_N03",
        "required": false
      },
      {
        "source": "F02_N03",
        "target": "F02_N04",
        "required": false
      },
      {
        "source": "F02_N03",
        "target": "F02_N05",
        "required": false
      },
      {
        "source": "F02_N04",
        "target": "F02_N05",
        "required": false
      },
      {
        "source": "F02_N04",
        "target": "F02_N07",
        "required": false
      },
      {
        "source": "F02_N07",
        "target": "F02_N01",
        "required": false
      },
      {
        "source": "F02_N03",
        "target": "F02_N08",
        "required": false
      },
      {
        "source": "F02_N04",
        "target": "F02_N08",
        "required": false
      },
      {
        "source": "F02_N05",
        "target": "F02_N06",
        "required": false
      },
      {
        "source": "F02_N05",
        "target": "F02_N01",
        "required": false
      },
      {
        "source": "F02_N06",
        "target": "F02_N11",
        "required": false
      },
      {
        "source": "F02_N03",
        "target": "F02_N10",
        "required": false
      },
      {
        "source": "F02_N10",
        "target": "F02_N09",
        "required": false
      }
    ],
    "recovery": [
      "本地停止先执行；语音同意需当前问题、revision与参数匹配。",
      "取消传播至未完成模型与工具请求；已经发生的副作用保留记录。",
      "需要新信息的语义判断进入下一轮，不与其前置判断盲目合批。"
    ]
  },
  {
    "id": "F03",
    "name": "世界状态、目标与局部重规划",
    "nodes": [
      {
        "id": "F03_N01",
        "label": "接收事件或用户变更并核对版本",
        "kind": "input",
        "dependencies": [],
        "required": true,
        "resourceKeys": [],
        "effectType": "读取",
        "inputFields": [
          "变更来源",
          "原任务revision"
        ],
        "outputFields": [
          "有效变更原因"
        ]
      },
      {
        "id": "F03_N05",
        "label": "并行宽松召回时间、地点、人物、资源",
        "kind": "tool_exec",
        "dependencies": [
          "F03_N01"
        ],
        "required": true,
        "resourceKeys": [],
        "effectType": "读取",
        "inputFields": [],
        "outputFields": [
          "重叠/邻近/出行候选",
          "未知属性项",
          "来源版本"
        ],
        "evidenceRequirement": "未知地点/时间不因优先级低被自动排除；能力和配置决定实际检索范围。"
      },
      {
        "id": "F03_N02",
        "label": "主模型判断依赖与受影响子图",
        "kind": "semantic_decision",
        "dependencies": [
          "F03_N05"
        ],
        "required": true,
        "resourceKeys": [],
        "effectType": "读取",
        "inputFields": [],
        "outputFields": [
          "保留项",
          "失效项",
          "依赖假设及依据",
          "可能补偿的原效果"
        ]
      },
      {
        "id": "F03_N03",
        "label": "保留有效成果；仅使过时计划节点失效",
        "kind": "checkpoint",
        "dependencies": [
          "F03_N02"
        ],
        "required": true,
        "resourceKeys": [],
        "effectType": "本地状态 / 缓存",
        "inputFields": [],
        "outputFields": [
          "保留检查点",
          "计划新revision"
        ],
        "evidenceRequirement": "不删除已发邮件或已发生写入的事实；依赖假设不是已验证因果关系。"
      },
      {
        "id": "F03_N06",
        "label": "宿主绑定原操作、效果与变更因果链",
        "kind": "deterministic_check",
        "dependencies": [
          "F03_N02"
        ],
        "required": true,
        "resourceKeys": [],
        "effectType": "读取",
        "inputFields": [
          "稳定operation/effect ID",
          "实际执行/读回记录",
          "候选的原效果引用"
        ],
        "outputFields": [
          "已绑定的正向/重试/补偿上下文"
        ],
        "evidenceRequirement": "REVISE加同一对象存在写入不够；必须关联具体原效果与修正原因，不能相信模型自报分类。"
      },
      {
        "id": "F03_N07",
        "label": "未知原写入：先读回核实",
        "kind": "verification",
        "dependencies": [
          "F03_N06"
        ],
        "required": false,
        "resourceKeys": [],
        "effectType": "读取",
        "inputFields": [],
        "outputFields": [
          "已发生/未发生/仍未知及证据"
        ],
        "condition": "原效果状态未知"
      },
      {
        "id": "F03_N08",
        "label": "现有Policy核对实际补偿授权",
        "kind": "deterministic_check",
        "dependencies": [
          "F03_N06"
        ],
        "required": false,
        "resourceKeys": [],
        "effectType": "读取",
        "inputFields": [
          "原效果因果链",
          "补偿对象/参数",
          "现有授权"
        ],
        "outputFields": [
          "已覆盖或需决定"
        ],
        "condition": "已核实原效果，且确有补偿候选",
        "evidenceRequirement": "正向授权不自动等于补偿授权；已有范围覆盖更正时直接执行。"
      },
      {
        "id": "F03_N09",
        "label": "覆盖授权：执行补偿并读回",
        "kind": "tool_exec",
        "dependencies": [
          "F03_N08"
        ],
        "required": false,
        "resourceKeys": [],
        "effectType": "写入（以工具描述为准）",
        "inputFields": [],
        "outputFields": [
          "独立补偿操作ID",
          "补偿结果与读回"
        ],
        "condition": "实际补偿授权有效"
      },
      {
        "id": "F03_N10",
        "label": "缺决定：保留补偿草稿并语音补问",
        "kind": "wait_user",
        "dependencies": [
          "F03_N08"
        ],
        "required": false,
        "resourceKeys": [],
        "effectType": "读取",
        "inputFields": [],
        "outputFields": [
          "草稿",
          "待决问题引用"
        ],
        "condition": "缺少补偿授权或关键条件"
      },
      {
        "id": "F03_N04",
        "label": "F24按新依赖调度；独立分支继续",
        "kind": "checkpoint",
        "dependencies": [
          "F03_N03"
        ],
        "required": true,
        "resourceKeys": [],
        "effectType": "本地状态 / 缓存",
        "inputFields": [],
        "outputFields": [
          "可继续节点",
          "等待核实/决定项"
        ]
      }
    ],
    "edges": [
      {
        "source": "F03_N01",
        "target": "F03_N05",
        "required": true
      },
      {
        "source": "F03_N05",
        "target": "F03_N02",
        "required": true
      },
      {
        "source": "F03_N02",
        "target": "F03_N03",
        "required": true
      },
      {
        "source": "F03_N02",
        "target": "F03_N06",
        "required": true
      },
      {
        "source": "F03_N03",
        "target": "F03_N04",
        "required": true
      },
      {
        "source": "F03_N06",
        "target": "F03_N07",
        "required": false,
        "condition": "结果未知"
      },
      {
        "source": "F03_N07",
        "target": "F03_N06",
        "required": false,
        "condition": "核实完成"
      },
      {
        "source": "F03_N06",
        "target": "F03_N08",
        "required": false,
        "condition": "确需补偿"
      },
      {
        "source": "F03_N08",
        "target": "F03_N09",
        "required": false,
        "condition": "通过"
      },
      {
        "source": "F03_N08",
        "target": "F03_N10",
        "required": false,
        "condition": "未覆盖"
      },
      {
        "source": "F03_N09",
        "target": "F03_N04",
        "required": false,
        "condition": "完成"
      },
      {
        "source": "F03_N10",
        "target": "F03_N08",
        "required": false,
        "condition": "回答到达"
      }
    ],
    "recovery": [
      "只重做来源或输入已失效的分支；保留仍有效结果、版本与操作记录。",
      "取消先传播到本地宿主；已发生副作用保留，未知写入先读回核实。",
      "截止时间、取消与实际配置贯穿模型及工具；不新增固定轮数、金额或预算限制。"
    ]
  },
  {
    "id": "F04",
    "name": "Wiki 与作用域记忆管理",
    "nodes": [
      {
        "id": "F04_N01",
        "label": "获取候选、来源与作用域",
        "kind": "input",
        "dependencies": [],
        "required": true,
        "resourceKeys": [],
        "effectType": "读取",
        "inputFields": [],
        "outputFields": [
          "来源引用",
          "事实/偏好/责任/推断类型候选"
        ]
      },
      {
        "id": "F04_N05",
        "label": "并行检索已有版本与有效授权引用",
        "kind": "tool_exec",
        "dependencies": [
          "F04_N01"
        ],
        "required": true,
        "resourceKeys": [],
        "effectType": "读取",
        "inputFields": [],
        "outputFields": [
          "事实版本链",
          "冲突候选",
          "授权引用（独立）"
        ]
      },
      {
        "id": "F04_N02",
        "label": "主模型判断相容、冲突或失效",
        "kind": "semantic_decision",
        "dependencies": [
          "F04_N05"
        ],
        "required": true,
        "resourceKeys": [],
        "effectType": "读取",
        "inputFields": [],
        "outputFields": [
          "版本关联候选",
          "适用范围",
          "冲突解释"
        ]
      },
      {
        "id": "F04_N06",
        "label": "宿主核对来源与公开写入能力",
        "kind": "deterministic_check",
        "dependencies": [
          "F04_N02"
        ],
        "required": true,
        "resourceKeys": [],
        "effectType": "读取",
        "inputFields": [],
        "outputFields": [
          "可写候选或Unavailable"
        ],
        "evidenceRequirement": "已确认事实不等于动作授权；来源不可读或能力未发布时明确不可用。"
      },
      {
        "id": "F04_N03",
        "label": "相容：写新版本并保留旧版来源",
        "kind": "tool_exec",
        "dependencies": [
          "F04_N06"
        ],
        "required": false,
        "resourceKeys": [],
        "effectType": "写入（以工具描述为准）",
        "inputFields": [],
        "outputFields": [
          "新事实版本",
          "旧版关联"
        ],
        "condition": "相容更新且现有写入授权有效"
      },
      {
        "id": "F04_N07",
        "label": "冲突：隔离候选，按需澄清",
        "kind": "checkpoint",
        "dependencies": [
          "F04_N06"
        ],
        "required": false,
        "resourceKeys": [],
        "effectType": "本地状态 / 缓存",
        "inputFields": [],
        "outputFields": [
          "隔离标记",
          "尚未解决事项"
        ],
        "condition": "证据矛盾未解决"
      },
      {
        "id": "F04_N04",
        "label": "通知受影响索引与上下文失效",
        "kind": "checkpoint",
        "dependencies": [
          "F04_N03",
          "F04_N07"
        ],
        "required": true,
        "resourceKeys": [],
        "effectType": "本地状态 / 缓存",
        "inputFields": [],
        "outputFields": [
          "失效传播事件",
          "可恢复来源引用"
        ]
      }
    ],
    "edges": [
      {
        "source": "F04_N01",
        "target": "F04_N05",
        "required": true
      },
      {
        "source": "F04_N05",
        "target": "F04_N02",
        "required": true
      },
      {
        "source": "F04_N02",
        "target": "F04_N06",
        "required": true
      },
      {
        "source": "F04_N06",
        "target": "F04_N03",
        "required": false,
        "condition": "有效写入授权"
      },
      {
        "source": "F04_N06",
        "target": "F04_N07",
        "required": false,
        "condition": "未解决"
      },
      {
        "source": "F04_N03",
        "target": "F04_N04",
        "required": true
      },
      {
        "source": "F04_N07",
        "target": "F04_N04",
        "required": true
      }
    ],
    "recovery": [
      "只重做来源或输入已失效的分支；保留仍有效结果、版本与操作记录。",
      "取消先传播到本地宿主；已发生副作用保留，未知写入先读回核实。",
      "截止时间、取消与实际配置贯穿模型及工具；不新增固定轮数、金额或预算限制。"
    ]
  },
  {
    "id": "F05",
    "name": "记忆搜索与来源回答",
    "nodes": [
      {
        "id": "F05_N01",
        "label": "输入查询、事件线索与证据要求",
        "kind": "input",
        "dependencies": [],
        "required": true,
        "resourceKeys": [],
        "effectType": "读取",
        "inputFields": [],
        "outputFields": [
          "可用检索线索",
          "未知属性"
        ]
      },
      {
        "id": "F05_N02",
        "label": "范围/版本初筛后并行多路召回",
        "kind": "tool_exec",
        "dependencies": [
          "F05_N01"
        ],
        "required": true,
        "resourceKeys": [],
        "effectType": "读取",
        "inputFields": [],
        "outputFields": [
          "文本/事实/语义候选",
          "来源与版本"
        ],
        "evidenceRequirement": "MemoryQueryPort事实查询与KnowledgePort.search分开；未提供向量能力不冒充已实现。"
      },
      {
        "id": "F05_N03",
        "label": "主模型重排证据并判断缺口",
        "kind": "semantic_decision",
        "dependencies": [
          "F05_N02"
        ],
        "required": true,
        "resourceKeys": [],
        "effectType": "读取",
        "inputFields": [],
        "outputFields": [
          "选用片段",
          "支持关系",
          "扩充建议或可回答建议"
        ]
      },
      {
        "id": "F05_N06",
        "label": "按需扩充已授权数据范围的检索",
        "kind": "tool_exec",
        "dependencies": [
          "F05_N03"
        ],
        "required": false,
        "resourceKeys": [],
        "effectType": "读取",
        "inputFields": [],
        "outputFields": [
          "新增证据",
          "检索条件与无新增标记"
        ],
        "condition": "存在可检索的新信息需求"
      },
      {
        "id": "F05_N04",
        "label": "执行模型生成带来源候选回答",
        "kind": "execution_model",
        "dependencies": [
          "F05_N03"
        ],
        "required": true,
        "resourceKeys": [],
        "effectType": "读取",
        "inputFields": [],
        "outputFields": [
          "回答候选",
          "引用映射"
        ],
        "condition": "已有依据足以回答或明确声明未知"
      },
      {
        "id": "F05_N05",
        "label": "主模型检查支持关系；代码核对引用版本",
        "kind": "verification",
        "dependencies": [
          "F05_N04"
        ],
        "required": true,
        "resourceKeys": [],
        "effectType": "读取",
        "inputFields": [],
        "outputFields": [
          "支持/未支持项",
          "需补查或未知"
        ],
        "evidenceRequirement": "引用可读且版本有效；模型判定不等于事实已独立验证。"
      },
      {
        "id": "F05_N07",
        "label": "发布有据回答并记录引用影响",
        "kind": "complete",
        "dependencies": [
          "F05_N05"
        ],
        "required": true,
        "resourceKeys": [],
        "effectType": "读取",
        "inputFields": [],
        "outputFields": [
          "答案",
          "来源清单",
          "未解决项"
        ]
      }
    ],
    "edges": [
      {
        "source": "F05_N01",
        "target": "F05_N02",
        "required": true
      },
      {
        "source": "F05_N02",
        "target": "F05_N03",
        "required": true
      },
      {
        "source": "F05_N03",
        "target": "F05_N06",
        "required": false,
        "condition": "需新信息"
      },
      {
        "source": "F05_N06",
        "target": "F05_N03",
        "required": false,
        "condition": "新增信息"
      },
      {
        "source": "F05_N03",
        "target": "F05_N04",
        "required": true
      },
      {
        "source": "F05_N04",
        "target": "F05_N05",
        "required": true
      },
      {
        "source": "F05_N05",
        "target": "F05_N06",
        "required": false,
        "condition": "可补查"
      },
      {
        "source": "F05_N05",
        "target": "F05_N07",
        "required": true
      }
    ],
    "recovery": [
      "只重做来源或输入已失效的分支；保留仍有效结果、版本与操作记录。",
      "取消先传播到本地宿主；已发生副作用保留，未知写入先读回核实。",
      "截止时间、取消与实际配置贯穿模型及工具；不新增固定轮数、金额或预算限制。"
    ]
  },
  {
    "id": "F06",
    "name": "待办、提醒与跟进",
    "nodes": [
      {
        "id": "F06_N01",
        "label": "解析任务与提醒要素",
        "kind": "input",
        "dependencies": [],
        "required": true,
        "resourceKeys": [
          "session_input_stream"
        ],
        "effectType": "读取",
        "inputFields": [
          "text"
        ],
        "outputFields": [
          "deadline",
          "reminderTime"
        ]
      },
      {
        "id": "F06_N02",
        "label": "决策模型 查重与意图确认",
        "kind": "semantic_decision",
        "dependencies": [
          "F06_N01"
        ],
        "required": true,
        "resourceKeys": [
          "domestic_decision_inference"
        ],
        "effectType": "读取",
        "inputFields": [
          "parsed"
        ],
        "outputFields": [
          "isDuplicate",
          "actionPlan"
        ]
      },
      {
        "id": "F06_N03",
        "label": "写入待办系统 (带幂等键)",
        "kind": "tool_exec",
        "dependencies": [
          "F06_N02"
        ],
        "required": true,
        "resourceKeys": [
          "todo_database"
        ],
        "effectType": "写入（以工具描述为准）",
        "inputFields": [
          "todoTitle",
          "due"
        ],
        "outputFields": [
          "todoId",
          "opKey"
        ]
      },
      {
        "id": "F06_N04",
        "label": "按实际时钟与当前提醒版本检查到期",
        "kind": "checkpoint",
        "dependencies": [
          "F06_N03"
        ],
        "required": true,
        "resourceKeys": [
          "virtual_clock_timer"
        ],
        "effectType": "读取",
        "inputFields": [
          "advanceTo"
        ],
        "outputFields": [
          "isTaskAlreadyFinished",
          "shouldFireAlarm"
        ]
      },
      {
        "id": "F06_N05",
        "label": "播发提醒通知",
        "kind": "complete",
        "dependencies": [
          "F06_N04"
        ],
        "required": true,
        "resourceKeys": [
          "notification_hub"
        ],
        "effectType": "读取",
        "inputFields": [
          "notification"
        ],
        "outputFields": [
          "delivered"
        ]
      }
    ],
    "edges": [
      {
        "source": "F06_N01",
        "target": "F06_N02",
        "required": true
      },
      {
        "source": "F06_N02",
        "target": "F06_N03",
        "required": true
      },
      {
        "source": "F06_N03",
        "target": "F06_N04",
        "required": true
      },
      {
        "source": "F06_N04",
        "target": "F06_N05",
        "required": true
      }
    ],
    "recovery": [
      "失败只重做受影响节点；保留已有证据与来源版本。",
      "取消传播至未完成模型与工具请求；已经发生的副作用保留记录。",
      "需要新信息的语义判断进入下一轮，不与其前置判断盲目合批。"
    ]
  },
  {
    "id": "F07",
    "name": "日历安排与冲突处理",
    "nodes": [
      {
        "id": "F07_N01",
        "label": "提取日历安排需求",
        "kind": "input",
        "dependencies": [],
        "required": true,
        "resourceKeys": [
          "session_input_stream"
        ],
        "effectType": "读取",
        "inputFields": [
          "attendee",
          "durationMinutes",
          "avoidLunch"
        ],
        "outputFields": [
          "parsedConstraint"
        ]
      },
      {
        "id": "F07_N02",
        "label": "读取日历并计算空闲、出行与重叠窗口",
        "kind": "tool_exec",
        "dependencies": [
          "F07_N01"
        ],
        "required": true,
        "resourceKeys": [
          "calendar_raw_events"
        ],
        "effectType": "读取",
        "inputFields": [
          "week",
          "blockList"
        ],
        "outputFields": [
          "availableSlots"
        ],
        "evidenceRequirement": "按用户实际工作/安静时段和最新日历计算；未知道路/地点保留不确定性。"
      },
      {
        "id": "F07_N03",
        "label": "决策模型 语义排序与推荐",
        "kind": "semantic_decision",
        "dependencies": [
          "F07_N02"
        ],
        "required": true,
        "resourceKeys": [
          "domestic_decision_inference"
        ],
        "effectType": "读取",
        "inputFields": [
          "slots"
        ],
        "outputFields": [
          "recommendedSlot",
          "rationale"
        ]
      },
      {
        "id": "F07_N04",
        "label": "写入前日历版本新鲜度校验",
        "kind": "deterministic_check",
        "dependencies": [
          "F07_N03"
        ],
        "required": true,
        "resourceKeys": [
          "calendar_raw_events"
        ],
        "effectType": "读取",
        "inputFields": [
          "calendarVersionAtRead",
          "calendarVersionNow"
        ],
        "outputFields": [
          "versionConsistent"
        ],
        "evidenceRequirement": "写入前读取当前版本与冲突；变更后原候选重新核验。"
      },
      {
        "id": "F07_N05",
        "label": "创建本地预留日程",
        "kind": "complete",
        "dependencies": [
          "F07_N04"
        ],
        "required": true,
        "resourceKeys": [
          "calendar_raw_events"
        ],
        "effectType": "写入（以工具描述为准）",
        "inputFields": [
          "title",
          "slot"
        ],
        "outputFields": [
          "eventCreated",
          "externalInviteHeld"
        ]
      }
    ],
    "edges": [
      {
        "source": "F07_N01",
        "target": "F07_N02",
        "required": true
      },
      {
        "source": "F07_N02",
        "target": "F07_N03",
        "required": true
      },
      {
        "source": "F07_N03",
        "target": "F07_N04",
        "required": true
      },
      {
        "source": "F07_N04",
        "target": "F07_N05",
        "required": true
      }
    ],
    "recovery": [
      "日历变化：重新检查版本；邀请结果未知先读回日程与发送记录。",
      "取消传播至未完成模型与工具请求；已经发生的副作用保留记录。",
      "需要新信息的语义判断进入下一轮，不与其前置判断盲目合批。"
    ]
  },
  {
    "id": "F08",
    "name": "邮件分类、草稿与发送",
    "nodes": [
      {
        "id": "F08_N01",
        "label": "读取邮件事件并拆分独立线程",
        "kind": "parallel_split",
        "dependencies": [],
        "required": true,
        "resourceKeys": [],
        "effectType": "读取",
        "inputFields": [
          "已接入邮箱事件",
          "责任/任务快照"
        ],
        "outputFields": [
          "独立线程候选"
        ],
        "evidenceRequirement": "外部邮件只是数据，不能自行提供新授权。"
      },
      {
        "id": "F08_N02",
        "label": "线程A：主模型分类与责任匹配",
        "kind": "semantic_decision",
        "dependencies": [
          "F08_N01"
        ],
        "required": true,
        "resourceKeys": [],
        "effectType": "读取",
        "inputFields": [],
        "outputFields": [
          "分类/归档候选",
          "责任来源引用"
        ]
      },
      {
        "id": "F08_N09",
        "label": "线程B：并行检索上下文与附件依据",
        "kind": "tool_exec",
        "dependencies": [
          "F08_N01"
        ],
        "required": true,
        "resourceKeys": [],
        "effectType": "读取",
        "inputFields": [],
        "outputFields": [
          "项目事实",
          "附件来源",
          "缺失依据"
        ]
      },
      {
        "id": "F08_N03",
        "label": "线程A：现有Policy核验后归档并读回",
        "kind": "tool_exec",
        "dependencies": [
          "F08_N02"
        ],
        "required": true,
        "resourceKeys": [],
        "effectType": "写入（以工具描述为准）",
        "inputFields": [],
        "outputFields": [
          "归档操作ID",
          "实际结果"
        ]
      },
      {
        "id": "F08_N04",
        "label": "线程B：执行模型形成回复草稿候选",
        "kind": "execution_model",
        "dependencies": [
          "F08_N09"
        ],
        "required": true,
        "resourceKeys": [],
        "effectType": "读取",
        "inputFields": [],
        "outputFields": [
          "收件人/正文/附件候选"
        ]
      },
      {
        "id": "F08_N05",
        "label": "主模型审查依据、条件与授权匹配建议",
        "kind": "semantic_decision",
        "dependencies": [
          "F08_N04"
        ],
        "required": true,
        "resourceKeys": [],
        "effectType": "读取",
        "inputFields": [],
        "outputFields": [
          "修改建议",
          "需澄清项",
          "责任来源关联"
        ]
      },
      {
        "id": "F08_N10",
        "label": "宿主核对具体参数、revision与现有授权",
        "kind": "deterministic_check",
        "dependencies": [
          "F08_N05"
        ],
        "required": true,
        "resourceKeys": [],
        "effectType": "读取",
        "inputFields": [],
        "outputFields": [
          "可直接执行或待决问题"
        ],
        "evidenceRequirement": "有金额或商业内容不自动新增审批；按现有授权范围决定。"
      },
      {
        "id": "F08_N06",
        "label": "仅缺决定：调用F02主动语音/文字补问",
        "kind": "wait_user",
        "dependencies": [
          "F08_N10"
        ],
        "required": false,
        "resourceKeys": [],
        "effectType": "读取",
        "inputFields": [],
        "outputFields": [
          "当前问题及revision的回答"
        ],
        "condition": "现有授权未覆盖或关键条件不明确"
      },
      {
        "id": "F08_N07",
        "label": "授权通过：稳定操作ID发送",
        "kind": "tool_exec",
        "dependencies": [
          "F08_N10",
          "F08_N06"
        ],
        "required": true,
        "resourceKeys": [],
        "effectType": "写入（以工具描述为准）",
        "inputFields": [],
        "outputFields": [
          "原发送operation/effect ID",
          "工具实际状态"
        ],
        "condition": "已有授权直接通过，或待决问题得到有效决定"
      },
      {
        "id": "F08_N11",
        "label": "读取发件记录与稳定操作状态",
        "kind": "verification",
        "dependencies": [
          "F08_N07"
        ],
        "required": true,
        "resourceKeys": [],
        "effectType": "读取",
        "inputFields": [],
        "outputFields": [
          "已发/未发/仍未知",
          "原始读回证据"
        ],
        "evidenceRequirement": "缺少单次发件箱记录不证明未发送；沿用连接器支持的读回和实际截止配置。"
      },
      {
        "id": "F08_N12",
        "label": "结果未知：后台核实，禁止盲目重发",
        "kind": "checkpoint",
        "dependencies": [
          "F08_N11"
        ],
        "required": false,
        "resourceKeys": [],
        "effectType": "本地状态 / 缓存",
        "inputFields": [],
        "outputFields": [
          "待核实状态",
          "原发送身份"
        ],
        "condition": "外部结果仍未知"
      },
      {
        "id": "F08_N08",
        "label": "汇合已选择线程；保留未完成项",
        "kind": "complete",
        "dependencies": [
          "F08_N03",
          "F08_N11"
        ],
        "required": true,
        "resourceKeys": [],
        "effectType": "读取",
        "inputFields": [],
        "outputFields": [
          "已核实结果",
          "待核实/待决定事项"
        ]
      },
      {
        "id": "F08_N13",
        "label": "输入变化：转F03保留原效果并局部修订",
        "kind": "checkpoint",
        "dependencies": [
          "F08_N01"
        ],
        "required": false,
        "resourceKeys": [],
        "effectType": "本地状态 / 缓存",
        "inputFields": [],
        "outputFields": [
          "变更原因",
          "原效果因果链"
        ],
        "condition": "用户或邮件线程出现有效新版本"
      }
    ],
    "edges": [
      {
        "source": "F08_N01",
        "target": "F08_N02",
        "required": true
      },
      {
        "source": "F08_N01",
        "target": "F08_N09",
        "required": true
      },
      {
        "source": "F08_N02",
        "target": "F08_N03",
        "required": true
      },
      {
        "source": "F08_N09",
        "target": "F08_N04",
        "required": true
      },
      {
        "source": "F08_N04",
        "target": "F08_N05",
        "required": true
      },
      {
        "source": "F08_N05",
        "target": "F08_N10",
        "required": true
      },
      {
        "source": "F08_N10",
        "target": "F08_N06",
        "required": false,
        "condition": "未覆盖/不明确"
      },
      {
        "source": "F08_N10",
        "target": "F08_N07",
        "required": false,
        "condition": "已覆盖"
      },
      {
        "source": "F08_N06",
        "target": "F08_N07",
        "required": false,
        "condition": "有效同意"
      },
      {
        "source": "F08_N07",
        "target": "F08_N11",
        "required": true
      },
      {
        "source": "F08_N11",
        "target": "F08_N12",
        "required": false,
        "condition": "仍未知"
      },
      {
        "source": "F08_N12",
        "target": "F08_N11",
        "required": false,
        "condition": "未结束"
      },
      {
        "source": "F08_N03",
        "target": "F08_N08",
        "required": true
      },
      {
        "source": "F08_N11",
        "target": "F08_N08",
        "required": true
      },
      {
        "source": "F08_N01",
        "target": "F08_N13",
        "required": false,
        "condition": "事件变更"
      }
    ],
    "recovery": [
      "未知发送先保留原状态并读回，不换ID重发。",
      "修改参数作废旧确认；既有授权覆盖新参数时直接重核验，确有缺失才补问。",
      "只重做来源或输入已失效的分支；保留仍有效结果、版本与操作记录。",
      "取消先传播到本地宿主；已发生副作用保留，未知写入先读回核实。",
      "截止时间、取消与实际配置贯穿模型及工具；不新增固定轮数、金额或预算限制。"
    ]
  },
  {
    "id": "F09",
    "name": "订阅、信号发现与筛选",
    "nodes": [
      {
        "id": "F09_N01",
        "label": "多源订阅流并行拉取",
        "kind": "tool_exec",
        "dependencies": [],
        "required": true,
        "resourceKeys": [
          "rss_subscription_stream"
        ],
        "effectType": "读取",
        "inputFields": [
          "sources"
        ],
        "outputFields": [
          "rawEvents"
        ]
      },
      {
        "id": "F09_N02",
        "label": "确定性哈希去重与格式校验",
        "kind": "deterministic_check",
        "dependencies": [
          "F09_N01"
        ],
        "required": true,
        "resourceKeys": [],
        "effectType": "读取",
        "inputFields": [
          "events"
        ],
        "outputFields": [
          "uniqueCount",
          "duplicateDiscarded"
        ]
      },
      {
        "id": "F09_N03",
        "label": "决策模型 语义相关性与价值判别",
        "kind": "semantic_decision",
        "dependencies": [
          "F09_N02"
        ],
        "required": true,
        "resourceKeys": [
          "domestic_decision_inference"
        ],
        "effectType": "读取",
        "inputFields": [
          "candidates"
        ],
        "outputFields": [
          "highValueSignal",
          "discardedJunk",
          "forwardToFeature"
        ]
      },
      {
        "id": "F09_N04",
        "label": "转入 F10 深度研究队列",
        "kind": "complete",
        "dependencies": [
          "F09_N03"
        ],
        "required": true,
        "resourceKeys": [
          "task_scheduler_queue"
        ],
        "effectType": "本地状态 / 缓存",
        "inputFields": [
          "signalPayload"
        ],
        "outputFields": [
          "researchTaskSpawned"
        ]
      }
    ],
    "edges": [
      {
        "source": "F09_N01",
        "target": "F09_N02",
        "required": true
      },
      {
        "source": "F09_N02",
        "target": "F09_N03",
        "required": true
      },
      {
        "source": "F09_N03",
        "target": "F09_N04",
        "required": true
      }
    ],
    "recovery": [
      "失败只重做受影响节点；保留已有证据与来源版本。",
      "取消传播至未完成模型与工具请求；已经发生的副作用保留记录。",
      "需要新信息的语义判断进入下一轮，不与其前置判断盲目合批。"
    ]
  },
  {
    "id": "F10",
    "name": "深度研究与证据汇总",
    "nodes": [
      {
        "id": "F10_N01",
        "label": "研究维度拆解与并行派发",
        "kind": "parallel_split",
        "dependencies": [],
        "required": true,
        "resourceKeys": [
          "domestic_decision_inference"
        ],
        "effectType": "读取",
        "inputFields": [
          "options"
        ],
        "outputFields": [
          "branchA",
          "branchB",
          "branchC"
        ]
      },
      {
        "id": "F10_N02",
        "label": "分支A：Qwen检索主题的一手资料",
        "kind": "execution_model",
        "dependencies": [
          "F10_N01"
        ],
        "required": true,
        "resourceKeys": [],
        "effectType": "读取",
        "inputFields": [
          "framework"
        ],
        "outputFields": [
          "pros",
          "cons"
        ]
      },
      {
        "id": "F10_N03",
        "label": "分支B：GLM寻找反例与替代路径",
        "kind": "execution_model",
        "dependencies": [
          "F10_N01"
        ],
        "required": true,
        "resourceKeys": [],
        "effectType": "读取",
        "inputFields": [
          "framework"
        ],
        "outputFields": [
          "pros",
          "cons"
        ]
      },
      {
        "id": "F10_N04",
        "label": "分支C：DeepSeek整理已有项目上下文",
        "kind": "execution_model",
        "dependencies": [
          "F10_N01"
        ],
        "required": true,
        "resourceKeys": [],
        "effectType": "读取",
        "inputFields": [
          "framework"
        ],
        "outputFields": [
          "pros",
          "cons"
        ]
      },
      {
        "id": "F10_N05",
        "label": "独立红蓝对抗审查 (寻找未支持主张与反例)",
        "kind": "verification",
        "dependencies": [
          "F10_N02",
          "F10_N03",
          "F10_N04"
        ],
        "required": true,
        "resourceKeys": [],
        "effectType": "读取",
        "inputFields": [
          "rawFindings"
        ],
        "outputFields": [
          "correctionsApplied"
        ],
        "evidenceRequirement": "未验证数据一律标为未知，不可把模型猜测当基准数据"
      },
      {
        "id": "F10_N06",
        "label": "主模型判断证据差异并汇总候选",
        "kind": "join",
        "dependencies": [
          "F10_N05"
        ],
        "required": true,
        "resourceKeys": [
          "domestic_decision_inference"
        ],
        "effectType": "读取",
        "inputFields": [
          "verifiedData"
        ],
        "outputFields": [
          "summaryTableReady",
          "recommendation"
        ]
      }
    ],
    "edges": [
      {
        "source": "F10_N01",
        "target": "F10_N02",
        "required": true
      },
      {
        "source": "F10_N01",
        "target": "F10_N03",
        "required": true
      },
      {
        "source": "F10_N01",
        "target": "F10_N04",
        "required": true
      },
      {
        "source": "F10_N02",
        "target": "F10_N05",
        "required": true
      },
      {
        "source": "F10_N03",
        "target": "F10_N05",
        "required": true
      },
      {
        "source": "F10_N04",
        "target": "F10_N05",
        "required": true
      },
      {
        "source": "F10_N05",
        "target": "F10_N06",
        "required": true
      }
    ],
    "recovery": [
      "失败只重做受影响节点；保留已有证据与来源版本。",
      "取消传播至未完成模型与工具请求；已经发生的副作用保留记录。",
      "需要新信息的语义判断进入下一轮，不与其前置判断盲目合批。"
    ]
  },
  {
    "id": "F11",
    "name": "天气、出行及计划影响",
    "nodes": [
      {
        "id": "F11_N01",
        "label": "接收气象与交通警报",
        "kind": "input",
        "dependencies": [],
        "required": true,
        "resourceKeys": [
          "weather_feed"
        ],
        "effectType": "读取",
        "inputFields": [
          "alertLevel",
          "timeRange"
        ],
        "outputFields": [
          "severeWeather"
        ]
      },
      {
        "id": "F11_N02",
        "label": "并行检索关联日程及未知地点项",
        "kind": "tool_exec",
        "dependencies": [
          "F11_N01"
        ],
        "required": true,
        "resourceKeys": [
          "calendar_raw_events"
        ],
        "effectType": "读取",
        "inputFields": [
          "date"
        ],
        "outputFields": [
          "targetEvent"
        ]
      },
      {
        "id": "F11_N03",
        "label": "决策模型 评估冲击并拟定改线方案",
        "kind": "semantic_decision",
        "dependencies": [
          "F11_N02"
        ],
        "required": true,
        "resourceKeys": [
          "domestic_decision_inference"
        ],
        "effectType": "读取",
        "inputFields": [
          "event",
          "weather"
        ],
        "outputFields": [
          "risk",
          "recommendedAlternative",
          "requiresVoiceConfirm"
        ]
      },
      {
        "id": "F11_N04",
        "label": "仅真正缺决定时主动语音补问",
        "kind": "wait_user",
        "dependencies": [
          "F11_N03"
        ],
        "required": false,
        "resourceKeys": [
          "audio_output_device"
        ],
        "effectType": "读取",
        "inputFields": [
          "question"
        ],
        "outputFields": [
          "userConfirmed"
        ],
        "condition": "现有授权未覆盖或关键条件不明确"
      },
      {
        "id": "F11_N05",
        "label": "更新日程属性并作废旧出行闹铃",
        "kind": "complete",
        "dependencies": [
          "F11_N03",
          "F11_N04"
        ],
        "required": true,
        "resourceKeys": [
          "calendar_raw_events"
        ],
        "effectType": "写入（以工具描述为准）",
        "inputFields": [
          "eventId",
          "newType"
        ],
        "outputFields": [
          "calendarUpdated",
          "oldTrafficAlarmVoided"
        ],
        "condition": "已授权直接执行或补问得到有效回答"
      }
    ],
    "edges": [
      {
        "source": "F11_N01",
        "target": "F11_N02",
        "required": true
      },
      {
        "source": "F11_N02",
        "target": "F11_N03",
        "required": true
      },
      {
        "source": "F11_N03",
        "target": "F11_N04",
        "required": true
      },
      {
        "source": "F11_N04",
        "target": "F11_N05",
        "required": true
      },
      {
        "source": "F11_N03",
        "target": "F11_N05",
        "required": false
      }
    ],
    "recovery": [
      "失败只重做受影响节点；保留已有证据与来源版本。",
      "取消传播至未完成模型与工具请求；已经发生的副作用保留记录。",
      "需要新信息的语义判断进入下一轮，不与其前置判断盲目合批。"
    ]
  },
  {
    "id": "F12",
    "name": "通知、安静时段与主动服务",
    "nodes": [
      {
        "id": "F12_N01",
        "label": "通知网关接收多项事件",
        "kind": "input",
        "dependencies": [],
        "required": true,
        "resourceKeys": [
          "notification_hub"
        ],
        "effectType": "读取",
        "inputFields": [
          "item1",
          "item2",
          "item3"
        ],
        "outputFields": [
          "count"
        ]
      },
      {
        "id": "F12_N02",
        "label": "读取用户安静时段 Policy",
        "kind": "deterministic_check",
        "dependencies": [
          "F12_N01"
        ],
        "required": true,
        "resourceKeys": [
          "responsibility_db"
        ],
        "effectType": "读取",
        "inputFields": [
          "checkTime",
          "quietRange"
        ],
        "outputFields": [
          "isQuietModeActive",
          "allowUrgentBypass"
        ],
        "evidenceRequirement": "使用当前用户安静时段、通知偏好和事件版本，不能套用固定午休样例。"
      },
      {
        "id": "F12_N03",
        "label": "决策模型 紧急度分流与摘要打包",
        "kind": "semantic_decision",
        "dependencies": [
          "F12_N02"
        ],
        "required": true,
        "resourceKeys": [
          "domestic_decision_inference"
        ],
        "effectType": "读取",
        "inputFields": [
          "items",
          "quiet"
        ],
        "outputFields": [
          "urgentBypass",
          "queuedForDigest",
          "digestReadyTime"
        ]
      },
      {
        "id": "F12_N04",
        "label": "立即推送单条紧急穿透提醒",
        "kind": "tool_exec",
        "dependencies": [
          "F12_N03"
        ],
        "required": true,
        "resourceKeys": [
          "notification_hub"
        ],
        "effectType": "读取",
        "inputFields": [
          "urgentTitle"
        ],
        "outputFields": [
          "popped"
        ]
      },
      {
        "id": "F12_N05",
        "label": "安静时段结束交付合并摘要",
        "kind": "complete",
        "dependencies": [
          "F12_N03"
        ],
        "required": true,
        "resourceKeys": [
          "notification_hub"
        ],
        "effectType": "读取",
        "inputFields": [
          "scheduledAt"
        ],
        "outputFields": [
          "digestDispatched"
        ]
      }
    ],
    "edges": [
      {
        "source": "F12_N01",
        "target": "F12_N02",
        "required": true
      },
      {
        "source": "F12_N02",
        "target": "F12_N03",
        "required": true
      },
      {
        "source": "F12_N03",
        "target": "F12_N04",
        "required": true
      },
      {
        "source": "F12_N03",
        "target": "F12_N05",
        "required": true
      }
    ],
    "recovery": [
      "失败只重做受影响节点；保留已有证据与来源版本。",
      "取消传播至未完成模型与工具请求；已经发生的副作用保留记录。",
      "需要新信息的语义判断进入下一轮，不与其前置判断盲目合批。"
    ]
  },
  {
    "id": "F13",
    "name": "系统检查与故障诊断",
    "nodes": [
      {
        "id": "F13_N01",
        "label": "读取卡滞任务状态与日志",
        "kind": "input",
        "dependencies": [],
        "required": true,
        "resourceKeys": [
          "task_scheduler_queue"
        ],
        "effectType": "读取",
        "inputFields": [
          "taskId",
          "waitTimeSeconds"
        ],
        "outputFields": [
          "currentNodeId",
          "blockReason"
        ]
      },
      {
        "id": "F13_N02",
        "label": "并行运行确定性探针诊断",
        "kind": "tool_exec",
        "dependencies": [
          "F13_N01"
        ],
        "required": true,
        "resourceKeys": [
          "system_diagnostics"
        ],
        "effectType": "读取",
        "inputFields": [
          "checks"
        ],
        "outputFields": [
          "cloudAlive",
          "quotaNormal",
          "staleLockFound"
        ],
        "evidenceRequirement": "探针结果、进程/锁身份与时间分别记录，不能从日志文字推定宿主已停止。"
      },
      {
        "id": "F13_N03",
        "label": "决策模型 归因分析与修复方案规划",
        "kind": "semantic_decision",
        "dependencies": [
          "F13_N02"
        ],
        "required": true,
        "resourceKeys": [
          "domestic_decision_inference"
        ],
        "effectType": "读取",
        "inputFields": [
          "diagnostics"
        ],
        "outputFields": [
          "rootCause",
          "remediation",
          "isSafeAndReversible"
        ]
      },
      {
        "id": "F13_N04",
        "label": "核实执行宿主与未知效果后恢复资源",
        "kind": "complete",
        "dependencies": [
          "F13_N03"
        ],
        "required": true,
        "resourceKeys": [
          "resource_lock_manager"
        ],
        "effectType": "写入（以工具描述为准）",
        "inputFields": [
          "targetLock"
        ],
        "outputFields": [
          "lockReleased",
          "taskResumed"
        ],
        "evidenceRequirement": "锁释放需要宿主生命周期与执行记录支持，不能凭模型说进程卡死强制解锁。"
      }
    ],
    "edges": [
      {
        "source": "F13_N01",
        "target": "F13_N02",
        "required": true
      },
      {
        "source": "F13_N02",
        "target": "F13_N03",
        "required": true
      },
      {
        "source": "F13_N03",
        "target": "F13_N04",
        "required": true
      }
    ],
    "recovery": [
      "失败只重做受影响节点；保留已有证据与来源版本。",
      "取消传播至未完成模型与工具请求；已经发生的副作用保留记录。",
      "需要新信息的语义判断进入下一轮，不与其前置判断盲目合批。"
    ]
  },
  {
    "id": "F14",
    "name": "浏览器与桌面操作",
    "nodes": [
      {
        "id": "F14_N01",
        "label": "加载浏览器页面并解析可操作 DOM",
        "kind": "input",
        "dependencies": [],
        "required": true,
        "resourceKeys": [
          "browser_page_context"
        ],
        "effectType": "读取",
        "inputFields": [
          "url"
        ],
        "outputFields": [
          "elementsFound"
        ]
      },
      {
        "id": "F14_N02",
        "label": "申请桌面/浏览器输入互斥锁",
        "kind": "deterministic_check",
        "dependencies": [
          "F14_N01"
        ],
        "required": true,
        "resourceKeys": [
          "desktop_input_lock"
        ],
        "effectType": "本地状态 / 缓存",
        "inputFields": [
          "lockKey"
        ],
        "outputFields": [
          "lockAcquired"
        ],
        "evidenceRequirement": "独占键盘与鼠标控制权，防止与其他并发任务按键打架"
      },
      {
        "id": "F14_N03",
        "label": "串行键盘填充字段",
        "kind": "tool_exec",
        "dependencies": [
          "F14_N02"
        ],
        "required": true,
        "resourceKeys": [
          "desktop_input_lock"
        ],
        "effectType": "写入（以工具描述为准）",
        "inputFields": [
          "values"
        ],
        "outputFields": [
          "fieldsPopulated"
        ]
      },
      {
        "id": "F14_N04",
        "label": "主模型评估下一动作与已授权范围",
        "kind": "semantic_decision",
        "dependencies": [
          "F14_N03"
        ],
        "required": true,
        "resourceKeys": [
          "domestic_decision_inference"
        ],
        "effectType": "读取",
        "inputFields": [
          "targetAction"
        ],
        "outputFields": [
          "summary",
          "mustHaltForVoice"
        ]
      },
      {
        "id": "F14_N05",
        "label": "缺少决定时主动语音/文字确认",
        "kind": "wait_user",
        "dependencies": [
          "F14_N04"
        ],
        "required": false,
        "resourceKeys": [
          "audio_output_device"
        ],
        "effectType": "读取",
        "inputFields": [
          "question"
        ],
        "outputFields": [
          "confirmed"
        ],
        "condition": "既有Policy确实需要用户决定"
      },
      {
        "id": "F14_N06",
        "label": "点击提交并释放输入锁",
        "kind": "complete",
        "dependencies": [
          "F14_N04",
          "F14_N05"
        ],
        "required": true,
        "resourceKeys": [
          "desktop_input_lock"
        ],
        "effectType": "外部写入（以工具描述为准）",
        "inputFields": [
          "clickTarget"
        ],
        "outputFields": [
          "receiptId",
          "lockReleased"
        ],
        "condition": "有效授权与参数通过宿主检查",
        "evidenceRequirement": "动作后核对页面/目标身份；结果未知先观察读回，不盲目重复点击。"
      }
    ],
    "edges": [
      {
        "source": "F14_N01",
        "target": "F14_N02",
        "required": true
      },
      {
        "source": "F14_N02",
        "target": "F14_N03",
        "required": true
      },
      {
        "source": "F14_N03",
        "target": "F14_N04",
        "required": true
      },
      {
        "source": "F14_N04",
        "target": "F14_N05",
        "required": true
      },
      {
        "source": "F14_N05",
        "target": "F14_N06",
        "required": true
      },
      {
        "source": "F14_N04",
        "target": "F14_N06",
        "required": false
      }
    ],
    "recovery": [
      "失败只重做受影响节点；保留已有证据与来源版本。",
      "取消传播至未完成模型与工具请求；已经发生的副作用保留记录。",
      "需要新信息的语义判断进入下一轮，不与其前置判断盲目合批。"
    ]
  },
  {
    "id": "F15",
    "name": "代码修改、补丁与命令执行",
    "nodes": [
      {
        "id": "F15_N01",
        "label": "定位报错文件与调用栈基线",
        "kind": "input",
        "dependencies": [],
        "required": true,
        "resourceKeys": [
          "code_repo_workspace"
        ],
        "effectType": "读取",
        "inputFields": [
          "errorStack"
        ],
        "outputFields": [
          "targetFile",
          "line"
        ]
      },
      {
        "id": "F15_N02",
        "label": "决策模型 圈定修改边界与指派编码模型",
        "kind": "semantic_decision",
        "dependencies": [
          "F15_N01"
        ],
        "required": true,
        "resourceKeys": [
          "domestic_decision_inference"
        ],
        "effectType": "读取",
        "inputFields": [
          "targetFile"
        ],
        "outputFields": [
          "scope",
          "forbiddenActions"
        ]
      },
      {
        "id": "F15_N03",
        "label": "编码模型生成候选补丁",
        "kind": "execution_model",
        "dependencies": [
          "F15_N02"
        ],
        "required": true,
        "resourceKeys": [],
        "effectType": "读取",
        "inputFields": [
          "patchGoal"
        ],
        "outputFields": [
          "patchDiff"
        ]
      },
      {
        "id": "F15_N04",
        "label": "独立红线审查 (防越界与隐蔽变更)",
        "kind": "verification",
        "dependencies": [
          "F15_N03"
        ],
        "required": true,
        "resourceKeys": [],
        "effectType": "读取",
        "inputFields": [
          "patch"
        ],
        "outputFields": [
          "noBreakingApi",
          "noUnrelatedFormatting",
          "approved"
        ],
        "evidenceRequirement": "审查实际补丁、目标范围与行为影响，不能按改动行数宣布无风险。"
      },
      {
        "id": "F15_N05",
        "label": "在支持的测试工作区应用补丁并运行必要检查",
        "kind": "tool_exec",
        "dependencies": [
          "F15_N04"
        ],
        "required": true,
        "resourceKeys": [
          "sandbox_runner"
        ],
        "effectType": "写入（以工具描述为准）",
        "inputFields": [
          "testCommand"
        ],
        "outputFields": [
          "passedTests",
          "failedTests",
          "testDurationMs"
        ],
        "evidenceRequirement": "记录实际测试命令、基线、结果与失败；隔离能力按宿主真实实现描述。"
      },
      {
        "id": "F15_N06",
        "label": "交付补丁及检查凭证，按既有发布条件处理",
        "kind": "complete",
        "dependencies": [
          "F15_N05"
        ],
        "required": true,
        "resourceKeys": [
          "git_staging_area"
        ],
        "effectType": "本地状态 / 缓存",
        "inputFields": [
          "diff"
        ],
        "outputFields": [
          "patchReadyForReview",
          "autoPushBlocked"
        ]
      }
    ],
    "edges": [
      {
        "source": "F15_N01",
        "target": "F15_N02",
        "required": true
      },
      {
        "source": "F15_N02",
        "target": "F15_N03",
        "required": true
      },
      {
        "source": "F15_N03",
        "target": "F15_N04",
        "required": true
      },
      {
        "source": "F15_N04",
        "target": "F15_N05",
        "required": true
      },
      {
        "source": "F15_N05",
        "target": "F15_N06",
        "required": true
      }
    ],
    "recovery": [
      "代码基线或他人修改冲突：只重做受影响候选，保留已验证结果。",
      "取消传播至未完成模型与工具请求；已经发生的副作用保留记录。",
      "需要新信息的语义判断进入下一轮，不与其前置判断盲目合批。"
    ]
  },
  {
    "id": "F16",
    "name": "CI 检查与修复",
    "nodes": [
      {
        "id": "F16_N01",
        "label": "绑定提交版本与失败日志",
        "kind": "input",
        "dependencies": [],
        "required": true,
        "resourceKeys": [
          "ci_pipeline_logs"
        ],
        "effectType": "读取",
        "inputFields": [
          "commitSha",
          "logSnippet"
        ],
        "outputFields": [
          "errorClass"
        ]
      },
      {
        "id": "F16_N02",
        "label": "决策模型 归因分析 (排除作弊嫌疑)",
        "kind": "semantic_decision",
        "dependencies": [
          "F16_N01"
        ],
        "required": true,
        "resourceKeys": [
          "domestic_decision_inference"
        ],
        "effectType": "读取",
        "inputFields": [
          "error"
        ],
        "outputFields": [
          "rootCause",
          "legitimateFix"
        ]
      },
      {
        "id": "F16_N03",
        "label": "执行修复补丁应用",
        "kind": "execution_model",
        "dependencies": [
          "F16_N02"
        ],
        "required": true,
        "resourceKeys": [
          "sandbox_runner"
        ],
        "effectType": "写入（以工具描述为准）",
        "inputFields": [
          "instruction"
        ],
        "outputFields": [
          "patchApplied"
        ]
      },
      {
        "id": "F16_N04",
        "label": "审查修复是否保留真实验收意图",
        "kind": "deterministic_check",
        "dependencies": [
          "F16_N03"
        ],
        "required": true,
        "resourceKeys": [],
        "effectType": "读取",
        "inputFields": [
          "testFileModified",
          "assertionCount"
        ],
        "outputFields": [
          "noCheatingDetected"
        ],
        "evidenceRequirement": "检查断言/测试行为与需求，不以文件未改或断言数量不变证明没有规避测试。"
      },
      {
        "id": "F16_N05",
        "label": "隔离环境重跑 CI 并确认绿灯",
        "kind": "complete",
        "dependencies": [
          "F16_N04"
        ],
        "required": true,
        "resourceKeys": [
          "ci_pipeline_logs"
        ],
        "effectType": "读取",
        "inputFields": [
          "job"
        ],
        "outputFields": [
          "ciStatus",
          "runtimeSeconds"
        ]
      }
    ],
    "edges": [
      {
        "source": "F16_N01",
        "target": "F16_N02",
        "required": true
      },
      {
        "source": "F16_N02",
        "target": "F16_N03",
        "required": true
      },
      {
        "source": "F16_N03",
        "target": "F16_N04",
        "required": true
      },
      {
        "source": "F16_N04",
        "target": "F16_N05",
        "required": true
      }
    ],
    "recovery": [
      "失败只重做受影响节点；保留已有证据与来源版本。",
      "取消传播至未完成模型与工具请求；已经发生的副作用保留记录。",
      "需要新信息的语义判断进入下一轮，不与其前置判断盲目合批。"
    ]
  },
  {
    "id": "F17",
    "name": "测试失败定位",
    "nodes": [
      {
        "id": "F17_N01",
        "label": "固定失败日志、版本与调用栈",
        "kind": "input",
        "dependencies": [],
        "required": true,
        "resourceKeys": [
          "test_report_storage"
        ],
        "effectType": "读取",
        "inputFields": [
          "count",
          "modules"
        ],
        "outputFields": [
          "tracesCaptured"
        ]
      },
      {
        "id": "F17_N02",
        "label": "决策模型 聚类分析与同源归因",
        "kind": "semantic_decision",
        "dependencies": [
          "F17_N01"
        ],
        "required": true,
        "resourceKeys": [
          "domestic_decision_inference"
        ],
        "effectType": "读取",
        "inputFields": [
          "traces"
        ],
        "outputFields": [
          "clusterCount",
          "sharedRootCause",
          "evidence"
        ]
      },
      {
        "id": "F17_N03",
        "label": "设计最小单一复现脚本",
        "kind": "tool_exec",
        "dependencies": [
          "F17_N02"
        ],
        "required": true,
        "resourceKeys": [
          "sandbox_runner"
        ],
        "effectType": "读取",
        "inputFields": [
          "reproFile"
        ],
        "outputFields": [
          "reproSuccess",
          "timeMs"
        ]
      },
      {
        "id": "F17_N04",
        "label": "交付根因证据清单与针对性修复",
        "kind": "complete",
        "dependencies": [
          "F17_N03"
        ],
        "required": true,
        "resourceKeys": [],
        "effectType": "本地状态 / 缓存",
        "inputFields": [
          "fix"
        ],
        "outputFields": [
          "all6PassResolved"
        ]
      }
    ],
    "edges": [
      {
        "source": "F17_N01",
        "target": "F17_N02",
        "required": true
      },
      {
        "source": "F17_N02",
        "target": "F17_N03",
        "required": true
      },
      {
        "source": "F17_N03",
        "target": "F17_N04",
        "required": true
      }
    ],
    "recovery": [
      "失败只重做受影响节点；保留已有证据与来源版本。",
      "取消传播至未完成模型与工具请求；已经发生的副作用保留记录。",
      "需要新信息的语义判断进入下一轮，不与其前置判断盲目合批。"
    ]
  },
  {
    "id": "F18",
    "name": "PR 审查、批准条件与合并",
    "nodes": [
      {
        "id": "F18_N01",
        "label": "固定 PR 当前提交 SHA 与 Diff",
        "kind": "input",
        "dependencies": [],
        "required": true,
        "resourceKeys": [
          "github_pr_context"
        ],
        "effectType": "读取",
        "inputFields": [
          "prNumber",
          "base",
          "headSha"
        ],
        "outputFields": [
          "filesChanged",
          "additions",
          "deletions"
        ]
      },
      {
        "id": "F18_N02",
        "label": "执行模型分别提出审查意见",
        "kind": "execution_model",
        "dependencies": [
          "F18_N01"
        ],
        "required": true,
        "resourceKeys": [],
        "effectType": "读取",
        "inputFields": [
          "diff"
        ],
        "outputFields": [
          "suggestions"
        ]
      },
      {
        "id": "F18_N03",
        "label": "决策模型 整理阻断项与建议",
        "kind": "semantic_decision",
        "dependencies": [
          "F18_N02"
        ],
        "required": true,
        "resourceKeys": [
          "domestic_decision_inference"
        ],
        "effectType": "读取",
        "inputFields": [
          "reviewFeed"
        ],
        "outputFields": [
          "hasBlockingBugs",
          "blockingCount",
          "nonBlockingCount"
        ]
      },
      {
        "id": "F18_N04",
        "label": "确定性门禁检查 (真人批准、CI、冲突)",
        "kind": "deterministic_check",
        "dependencies": [
          "F18_N03"
        ],
        "required": true,
        "resourceKeys": [
          "github_pr_context"
        ],
        "effectType": "读取",
        "inputFields": [
          "humanApprovals",
          "ciCheckStatus",
          "unresolvedThreads"
        ],
        "outputFields": [
          "mergeRequirementsSatisfied"
        ],
        "evidenceRequirement": "严格核对为非作者真实批准，且CI全部通过"
      },
      {
        "id": "F18_N05",
        "label": "执行受控合并并更新主干版本",
        "kind": "complete",
        "dependencies": [
          "F18_N04"
        ],
        "required": true,
        "resourceKeys": [
          "github_pr_context"
        ],
        "effectType": "外部写入（以工具描述为准）",
        "inputFields": [
          "mergeMethod"
        ],
        "outputFields": [
          "mergedSha",
          "prClosed"
        ]
      }
    ],
    "edges": [
      {
        "source": "F18_N01",
        "target": "F18_N02",
        "required": true
      },
      {
        "source": "F18_N02",
        "target": "F18_N03",
        "required": true
      },
      {
        "source": "F18_N03",
        "target": "F18_N04",
        "required": true
      },
      {
        "source": "F18_N04",
        "target": "F18_N05",
        "required": true
      }
    ],
    "recovery": [
      "失败只重做受影响节点；保留已有证据与来源版本。",
      "取消传播至未完成模型与工具请求；已经发生的副作用保留记录。",
      "需要新信息的语义判断进入下一轮，不与其前置判断盲目合批。"
    ]
  },
  {
    "id": "F19",
    "name": "Issue 分诊与关联修复",
    "nodes": [
      {
        "id": "F19_N01",
        "label": "接收新用户报告并检索已有 Issue 库",
        "kind": "input",
        "dependencies": [],
        "required": true,
        "resourceKeys": [
          "issue_tracker"
        ],
        "effectType": "读取",
        "inputFields": [
          "incomingTitles"
        ],
        "outputFields": [
          "count"
        ]
      },
      {
        "id": "F19_N02",
        "label": "决策模型 语义查重与合并判断",
        "kind": "semantic_decision",
        "dependencies": [
          "F19_N01"
        ],
        "required": true,
        "resourceKeys": [
          "domestic_decision_inference"
        ],
        "effectType": "读取",
        "inputFields": [
          "issues"
        ],
        "outputFields": [
          "isDuplicate",
          "canonicalIssueId",
          "duplicateMarkedId",
          "triageCategory"
        ]
      },
      {
        "id": "F19_N03",
        "label": "创建关联修复子任务 (进入 F15)",
        "kind": "tool_exec",
        "dependencies": [
          "F19_N02"
        ],
        "required": true,
        "resourceKeys": [
          "task_scheduler_queue"
        ],
        "effectType": "本地状态 / 缓存",
        "inputFields": [
          "canonicalId",
          "linkedPrId"
        ],
        "outputFields": [
          "fixSubtaskSpawned"
        ]
      },
      {
        "id": "F19_N04",
        "label": "PR 合并后独立回归复验",
        "kind": "verification",
        "dependencies": [
          "F19_N03"
        ],
        "required": true,
        "resourceKeys": [
          "sandbox_runner"
        ],
        "effectType": "读取",
        "inputFields": [
          "touchTestScenario"
        ],
        "outputFields": [
          "originalBugGone",
          "verifiedPassed"
        ],
        "evidenceRequirement": "按原问题复现并核实实际行为；PR合并、模型结论和Fake通过分别标记。"
      },
      {
        "id": "F19_N05",
        "label": "核实解决后安全关闭 Issue",
        "kind": "complete",
        "dependencies": [
          "F19_N04"
        ],
        "required": true,
        "resourceKeys": [
          "issue_tracker"
        ],
        "effectType": "写入（以工具描述为准）",
        "inputFields": [
          "issueId",
          "comment"
        ],
        "outputFields": [
          "closedSuccess"
        ]
      }
    ],
    "edges": [
      {
        "source": "F19_N01",
        "target": "F19_N02",
        "required": true
      },
      {
        "source": "F19_N02",
        "target": "F19_N03",
        "required": true
      },
      {
        "source": "F19_N03",
        "target": "F19_N04",
        "required": true
      },
      {
        "source": "F19_N04",
        "target": "F19_N05",
        "required": true
      }
    ],
    "recovery": [
      "失败只重做受影响节点；保留已有证据与来源版本。",
      "取消传播至未完成模型与工具请求；已经发生的副作用保留记录。",
      "需要新信息的语义判断进入下一轮，不与其前置判断盲目合批。"
    ]
  },
  {
    "id": "F20",
    "name": "API 文档与一致性检查",
    "nodes": [
      {
        "id": "F20_N01",
        "label": "读取待比对的代码与契约来源",
        "kind": "input",
        "dependencies": [],
        "required": true,
        "resourceKeys": [
          "api_docs_workspace"
        ],
        "effectType": "读取",
        "inputFields": [
          "schemaFile",
          "codeFile"
        ],
        "outputFields": [
          "sourceReadback"
        ]
      },
      {
        "id": "F20_N02",
        "label": "执行模型比对来源并生成文档补丁与示例",
        "kind": "execution_model",
        "dependencies": [
          "F20_N01"
        ],
        "required": true,
        "resourceKeys": [],
        "effectType": "读取",
        "inputFields": [
          "sourceReadback",
          "field",
          "docTemplate"
        ],
        "outputFields": [
          "diffFields",
          "docMarkdown",
          "exampleArguments"
        ]
      },
      {
        "id": "F20_N03",
        "label": "确定性校验：示例代码可编译可解析",
        "kind": "deterministic_check",
        "dependencies": [
          "F20_N02"
        ],
        "required": true,
        "resourceKeys": [],
        "effectType": "读取",
        "inputFields": [
          "sampleSnippet"
        ],
        "outputFields": [
          "typeCheckPassed",
          "noPhantomFields"
        ],
        "evidenceRequirement": "类型检查器证实示例参数完全匹配 TypeScript Interface"
      },
      {
        "id": "F20_N04",
        "label": "主模型检查来源支持并提出文档候选",
        "kind": "semantic_decision",
        "dependencies": [
          "F20_N03"
        ],
        "required": true,
        "resourceKeys": [
          "api_docs_workspace"
        ],
        "effectType": "写入（以工具描述为准）",
        "inputFields": [
          "targetDoc"
        ],
        "outputFields": [
          "docVersion",
          "synchronized"
        ]
      }
    ],
    "edges": [
      {
        "source": "F20_N01",
        "target": "F20_N02",
        "required": true
      },
      {
        "source": "F20_N02",
        "target": "F20_N03",
        "required": true
      },
      {
        "source": "F20_N03",
        "target": "F20_N04",
        "required": true
      }
    ],
    "recovery": [
      "失败只重做受影响节点；保留已有证据与来源版本。",
      "取消传播至未完成模型与工具请求；已经发生的副作用保留记录。",
      "需要新信息的语义判断进入下一轮，不与其前置判断盲目合批。"
    ]
  },
  {
    "id": "F21",
    "name": "MCP、Skills 和连接器接入",
    "nodes": [
      {
        "id": "F21_N01",
        "label": "读取工具能力声明与权限清单",
        "kind": "input",
        "dependencies": [],
        "required": true,
        "resourceKeys": [
          "mcp_registry"
        ],
        "effectType": "读取",
        "inputFields": [
          "manifest",
          "permissions"
        ],
        "outputFields": [
          "toolId",
          "transport"
        ]
      },
      {
        "id": "F21_N02",
        "label": "注册协议与能力元数据",
        "kind": "tool_exec",
        "dependencies": [
          "F21_N01"
        ],
        "required": true,
        "resourceKeys": [
          "mcp_registry"
        ],
        "effectType": "本地状态 / 缓存",
        "inputFields": [
          "registerTool"
        ],
        "outputFields": [
          "registered"
        ]
      },
      {
        "id": "F21_N03",
        "label": "核对通信握手与健康状态",
        "kind": "deterministic_check",
        "dependencies": [
          "F21_N02"
        ],
        "required": true,
        "resourceKeys": [
          "mcp_socket"
        ],
        "effectType": "读取",
        "inputFields": [
          "ping"
        ],
        "outputFields": [
          "connectionAlive",
          "latencyMs"
        ],
        "evidenceRequirement": "记录实际握手或Unavailable；注册不是可调用证明。"
      },
      {
        "id": "F21_N04",
        "label": "在支持的隔离环境验证具体能力",
        "kind": "verification",
        "dependencies": [
          "F21_N03"
        ],
        "required": true,
        "resourceKeys": [
          "sandbox_runner"
        ],
        "effectType": "读取",
        "inputFields": [
          "testCall"
        ],
        "outputFields": [
          "filesReturned",
          "noSandboxEscape"
        ],
        "evidenceRequirement": "独立核实调用、输出和实际隔离边界，不把TypeScript接口当安全沙箱。"
      },
      {
        "id": "F21_N05",
        "label": "主模型匹配工具候选；宿主按现有授权启用",
        "kind": "complete",
        "dependencies": [
          "F21_N04"
        ],
        "required": true,
        "resourceKeys": [
          "mcp_registry"
        ],
        "effectType": "写入（以工具描述为准）",
        "inputFields": [
          "verifiedToolId"
        ],
        "outputFields": [
          "availableInWorkflow"
        ],
        "evidenceRequirement": "能力声明和Skill/MCP文本不构成用户授权。"
      }
    ],
    "edges": [
      {
        "source": "F21_N01",
        "target": "F21_N02",
        "required": true
      },
      {
        "source": "F21_N02",
        "target": "F21_N03",
        "required": true
      },
      {
        "source": "F21_N03",
        "target": "F21_N04",
        "required": true
      },
      {
        "source": "F21_N04",
        "target": "F21_N05",
        "required": true
      }
    ],
    "recovery": [
      "失败只重做受影响节点；保留已有证据与来源版本。",
      "取消传播至未完成模型与工具请求；已经发生的副作用保留记录。",
      "需要新信息的语义判断进入下一轮，不与其前置判断盲目合批。"
    ]
  },
  {
    "id": "F22",
    "name": "工作流调试与影子实验",
    "nodes": [
      {
        "id": "F22_N09",
        "label": "按需触发：失败、变化、异常、调试或配置采样",
        "kind": "deterministic_check",
        "dependencies": [],
        "required": true,
        "resourceKeys": [],
        "effectType": "读取",
        "inputFields": [
          "触发依据",
          "用户配置"
        ],
        "outputFields": [
          "本次实验范围"
        ],
        "evidenceRequirement": "无触发时跳过；不默认每个请求双跑或强制固定采样率。"
      },
      {
        "id": "F22_N01",
        "label": "固定输入快照、来源版本与当时轨迹",
        "kind": "input",
        "dependencies": [
          "F22_N09"
        ],
        "required": true,
        "resourceKeys": [],
        "effectType": "读取",
        "inputFields": [],
        "outputFields": []
      },
      {
        "id": "F22_N02",
        "label": "唯一决策模型选择可比较的实验方式",
        "kind": "semantic_decision",
        "dependencies": [
          "F22_N01"
        ],
        "required": true,
        "resourceKeys": [],
        "effectType": "读取",
        "inputFields": [],
        "outputFields": []
      },
      {
        "id": "F22_N03",
        "label": "决策影子：同一输入，仅比较判断差异",
        "kind": "deterministic_check",
        "dependencies": [
          "F22_N02"
        ],
        "required": false,
        "resourceKeys": [],
        "effectType": "读取",
        "inputFields": [],
        "outputFields": [],
        "condition": "选择决策影子时为本轮必需分支，否则跳过"
      },
      {
        "id": "F22_N04",
        "label": "轨迹回放：只读历史，不读取未来数据",
        "kind": "tool_exec",
        "dependencies": [
          "F22_N02"
        ],
        "required": false,
        "resourceKeys": [],
        "effectType": "读取",
        "inputFields": [],
        "outputFields": [],
        "condition": "选择轨迹回放时为本轮必需分支，否则跳过"
      },
      {
        "id": "F22_N05",
        "label": "隔离执行：独立数据、资源与操作记录",
        "kind": "tool_exec",
        "dependencies": [
          "F22_N02"
        ],
        "required": false,
        "resourceKeys": [],
        "effectType": "读取",
        "inputFields": [],
        "outputFields": [],
        "condition": "选择隔离执行时为本轮必需分支，否则跳过"
      },
      {
        "id": "F22_N06",
        "label": "核对回放完整性：缺反事实工具结果标未知",
        "kind": "verification",
        "dependencies": [
          "F22_N04"
        ],
        "required": false,
        "resourceKeys": [],
        "effectType": "读取",
        "inputFields": [],
        "outputFields": []
      },
      {
        "id": "F22_N07",
        "label": "对齐可比较证据；候选实验可并行",
        "kind": "join",
        "dependencies": [
          "F22_N03",
          "F22_N06",
          "F22_N05"
        ],
        "required": true,
        "resourceKeys": [],
        "effectType": "读取",
        "inputFields": [],
        "outputFields": [],
        "condition": "只汇合已选择的实验模式；其他分支跳过"
      },
      {
        "id": "F22_N08",
        "label": "后台提出改进候选，不改主任务、主记忆或授权",
        "kind": "complete",
        "dependencies": [
          "F22_N07"
        ],
        "required": true,
        "resourceKeys": [],
        "effectType": "读取",
        "inputFields": [],
        "outputFields": []
      }
    ],
    "edges": [
      {
        "source": "F22_N09",
        "target": "F22_N01",
        "required": true
      },
      {
        "source": "F22_N01",
        "target": "F22_N02",
        "required": false
      },
      {
        "source": "F22_N02",
        "target": "F22_N03",
        "required": false
      },
      {
        "source": "F22_N02",
        "target": "F22_N04",
        "required": false
      },
      {
        "source": "F22_N02",
        "target": "F22_N05",
        "required": false
      },
      {
        "source": "F22_N04",
        "target": "F22_N06",
        "required": false
      },
      {
        "source": "F22_N03",
        "target": "F22_N07",
        "required": false
      },
      {
        "source": "F22_N05",
        "target": "F22_N07",
        "required": false
      },
      {
        "source": "F22_N06",
        "target": "F22_N07",
        "required": false
      },
      {
        "source": "F22_N07",
        "target": "F22_N08",
        "required": false
      },
      {
        "source": "F22_N06",
        "target": "F22_N07",
        "required": false
      }
    ],
    "recovery": [
      "失败只重做受影响节点；保留已有证据与来源版本。",
      "取消传播至未完成模型与工具请求；已经发生的副作用保留记录。",
      "需要新信息的语义判断进入下一轮，不与其前置判断盲目合批。"
    ]
  },
  {
    "id": "F23",
    "name": "决策配置、评估与版本晋升",
    "nodes": [
      {
        "id": "F23_N01",
        "label": "加载数据集并执行时序防泄漏切分",
        "kind": "input",
        "dependencies": [],
        "required": true,
        "resourceKeys": [
          "dataset_vault"
        ],
        "effectType": "读取",
        "inputFields": [
          "totalSamples",
          "splitMethod"
        ],
        "outputFields": [
          "trainSet",
          "testSetHeldOut",
          "leakageOverlapCount"
        ]
      },
      {
        "id": "F23_N02",
        "label": "确定性数据泄漏审查",
        "kind": "deterministic_check",
        "dependencies": [
          "F23_N01"
        ],
        "required": true,
        "resourceKeys": [],
        "effectType": "读取",
        "inputFields": [
          "overlapHashCount"
        ],
        "outputFields": [
          "noLeakageVerified"
        ],
        "evidenceRequirement": "核对时间切分、同源关联及可比性；SHA不重复也不能单独证明没有数据泄漏。"
      },
      {
        "id": "F23_N03",
        "label": "评估提示、流程、调用配置与可用模型版本",
        "kind": "tool_exec",
        "dependencies": [
          "F23_N02"
        ],
        "required": true,
        "resourceKeys": [
          "benchmark_cluster"
        ],
        "effectType": "读取",
        "inputFields": [
          "配置与模板候选",
          "可用模型版本",
          "可选独立权重训练方案（另行实现）"
        ],
        "outputFields": [
          "accuracy",
          "falsePositiveRate",
          "p95LatencyMs"
        ]
      },
      {
        "id": "F23_N04",
        "label": "决策模型 综合质量与安全门禁裁决",
        "kind": "semantic_decision",
        "dependencies": [
          "F23_N03"
        ],
        "required": true,
        "resourceKeys": [
          "domestic_decision_inference"
        ],
        "effectType": "读取",
        "inputFields": [
          "metrics"
        ],
        "outputFields": [
          "gateVerdict",
          "rationale"
        ]
      },
      {
        "id": "F23_N05",
        "label": "按现有发布条件固化配置版本与回滚点",
        "kind": "complete",
        "dependencies": [
          "F23_N04"
        ],
        "required": true,
        "resourceKeys": [
          "image_version_registry"
        ],
        "effectType": "本地状态 / 缓存",
        "inputFields": [
          "promotedVersion",
          "rollbackAnchor"
        ],
        "outputFields": [
          "promotionReady",
          "rollbackPointActive"
        ]
      }
    ],
    "edges": [
      {
        "source": "F23_N01",
        "target": "F23_N02",
        "required": true
      },
      {
        "source": "F23_N02",
        "target": "F23_N03",
        "required": true
      },
      {
        "source": "F23_N03",
        "target": "F23_N04",
        "required": true
      },
      {
        "source": "F23_N04",
        "target": "F23_N05",
        "required": true
      }
    ],
    "recovery": [
      "评估失败保留当前版本；撤回候选并使用已记录的回滚点。",
      "取消传播至未完成模型与工具请求；已经发生的副作用保留记录。",
      "需要新信息的语义判断进入下一轮，不与其前置判断盲目合批。"
    ]
  },
  {
    "id": "F24",
    "name": "调度、并发、取消与恢复",
    "nodes": [
      {
        "id": "F24_N01",
        "label": "持久化任务图、revision与完成条件",
        "kind": "checkpoint",
        "dependencies": [],
        "required": true,
        "resourceKeys": [],
        "effectType": "本地状态 / 缓存",
        "inputFields": [],
        "outputFields": [
          "稳定节点/操作身份",
          "required/optional与条件分支"
        ]
      },
      {
        "id": "F24_N02",
        "label": "就绪节点并行；资源冲突进入等待",
        "kind": "parallel_split",
        "dependencies": [
          "F24_N01"
        ],
        "required": true,
        "resourceKeys": [],
        "effectType": "读取",
        "inputFields": [],
        "outputFields": [
          "已选择且依赖满足节点",
          "资源等待项"
        ],
        "evidenceRequirement": "CPU/账号/服务能力按实际容量与用户配置调度；不新增固定并发上限。"
      },
      {
        "id": "F24_N03",
        "label": "执行前核对Policy、版本与操作身份",
        "kind": "deterministic_check",
        "dependencies": [
          "F24_N02"
        ],
        "required": true,
        "resourceKeys": [],
        "effectType": "读取",
        "inputFields": [],
        "outputFields": [
          "获准的具体操作",
          "当前控制revision"
        ]
      },
      {
        "id": "F24_N04",
        "label": "经ModelGateway/ToolGateway执行并存检查点",
        "kind": "tool_exec",
        "dependencies": [
          "F24_N03"
        ],
        "required": true,
        "resourceKeys": [],
        "effectType": "写入（以工具描述为准）",
        "inputFields": [],
        "outputFields": [
          "执行记录",
          "实际效果/未知状态"
        ],
        "evidenceRequirement": "读取、模型请求可并行；桌面输入和同资源写入遵守既有锁。"
      },
      {
        "id": "F24_N05",
        "label": "证据就绪：汇合已选择的必需分支",
        "kind": "verification",
        "dependencies": [
          "F24_N04"
        ],
        "required": true,
        "resourceKeys": [],
        "effectType": "读取",
        "inputFields": [],
        "outputFields": [
          "完成条件证据",
          "未完成项"
        ],
        "evidenceRequirement": "TaskRuntime决定终态；模型自报、工具受理或取消受理都不等于完成。"
      },
      {
        "id": "F24_N06",
        "label": "本地取消/停止：先更新控制revision",
        "kind": "deterministic_check",
        "dependencies": [],
        "required": false,
        "resourceKeys": [],
        "effectType": "读取",
        "inputFields": [
          "直接停止或已识别语音停止"
        ],
        "outputFields": [
          "取消已受理",
          "停止信号"
        ],
        "evidenceRequirement": "直接本地入口不等待云端；拦住尚未开始操作，取消传播到在途请求。"
      },
      {
        "id": "F24_N07",
        "label": "未开始：阻止当前操作并保留此前效果",
        "kind": "checkpoint",
        "dependencies": [
          "F24_N06"
        ],
        "required": false,
        "resourceKeys": [],
        "effectType": "本地状态 / 缓存",
        "inputFields": [],
        "outputFields": [
          "当前操作未开始",
          "之前已发生效果"
        ],
        "condition": "当前操作尚未提交"
      },
      {
        "id": "F24_N08",
        "label": "已提交/在途：显示正在停止",
        "kind": "checkpoint",
        "dependencies": [
          "F24_N06"
        ],
        "required": false,
        "resourceKeys": [],
        "effectType": "本地状态 / 缓存",
        "inputFields": [],
        "outputFields": [
          "停止中",
          "在途请求身份"
        ],
        "condition": "请求已提交，尚不能确认停止"
      },
      {
        "id": "F24_N09",
        "label": "结果未知：等待对账与外部读回",
        "kind": "verification",
        "dependencies": [
          "F24_N06",
          "F24_N08"
        ],
        "required": false,
        "resourceKeys": [],
        "effectType": "读取",
        "inputFields": [],
        "outputFields": [
          "原状态及读回依据",
          "继续核实或明确结果"
        ],
        "condition": "外部结果未知",
        "evidenceRequirement": "一次缺失读回不是未执行证明；使用支持的查询/回查及实际期限。"
      },
      {
        "id": "F24_N10",
        "label": "已确认发生：保留结果，按需转补偿",
        "kind": "checkpoint",
        "dependencies": [
          "F24_N06",
          "F24_N09"
        ],
        "required": false,
        "resourceKeys": [],
        "effectType": "本地状态 / 缓存",
        "inputFields": [],
        "outputFields": [
          "原效果证据",
          "F03补偿候选"
        ],
        "condition": "已有实际发生证据"
      },
      {
        "id": "F24_N11",
        "label": "恢复：读检查点及原操作结果再调度",
        "kind": "checkpoint",
        "dependencies": [],
        "required": false,
        "resourceKeys": [],
        "effectType": "本地状态 / 缓存",
        "inputFields": [],
        "outputFields": [
          "已确认结果复用",
          "未知项先核实",
          "可恢复节点"
        ],
        "condition": "重启、断连或恢复请求"
      },
      {
        "id": "F24_N12",
        "label": "状态徽章与必要主动通知",
        "kind": "complete",
        "dependencies": [
          "F24_N05",
          "F24_N07",
          "F24_N08",
          "F24_N09",
          "F24_N10"
        ],
        "required": true,
        "resourceKeys": [],
        "effectType": "读取",
        "inputFields": [],
        "outputFields": [
          "完成/停止中/待核实/已发生",
          "需要用户决定的事项"
        ],
        "evidenceRequirement": "正常等待可静默；重要效果、截止冲击和必须决定的事项主动通知，不能一律隐藏。"
      }
    ],
    "edges": [
      {
        "source": "F24_N01",
        "target": "F24_N02",
        "required": true
      },
      {
        "source": "F24_N02",
        "target": "F24_N03",
        "required": true
      },
      {
        "source": "F24_N03",
        "target": "F24_N04",
        "required": true
      },
      {
        "source": "F24_N04",
        "target": "F24_N05",
        "required": true
      },
      {
        "source": "F24_N06",
        "target": "F24_N07",
        "required": false,
        "condition": "提交前"
      },
      {
        "source": "F24_N06",
        "target": "F24_N08",
        "required": false,
        "condition": "已提交/在途"
      },
      {
        "source": "F24_N06",
        "target": "F24_N09",
        "required": false,
        "condition": "外部结果未知"
      },
      {
        "source": "F24_N08",
        "target": "F24_N09",
        "required": false,
        "condition": "仍未知"
      },
      {
        "source": "F24_N06",
        "target": "F24_N10",
        "required": false,
        "condition": "已有证据"
      },
      {
        "source": "F24_N09",
        "target": "F24_N10",
        "required": false,
        "condition": "已核实"
      },
      {
        "source": "F24_N09",
        "target": "F24_N07",
        "required": false,
        "condition": "有充分证据"
      },
      {
        "source": "F24_N11",
        "target": "F24_N09",
        "required": false,
        "condition": "不能确认"
      },
      {
        "source": "F24_N11",
        "target": "F24_N02",
        "required": false,
        "condition": "可恢复"
      },
      {
        "source": "F24_N05",
        "target": "F24_N12",
        "required": true
      },
      {
        "source": "F24_N07",
        "target": "F24_N12",
        "required": true
      },
      {
        "source": "F24_N08",
        "target": "F24_N12",
        "required": true
      },
      {
        "source": "F24_N09",
        "target": "F24_N12",
        "required": true
      },
      {
        "source": "F24_N10",
        "target": "F24_N12",
        "required": true
      }
    ],
    "recovery": [
      "只重做来源或输入已失效的分支；保留仍有效结果、版本与操作记录。",
      "取消先传播到本地宿主；已发生副作用保留，未知写入先读回核实。",
      "截止时间、取消与实际配置贯穿模型及工具；不新增固定轮数、金额或预算限制。"
    ]
  },
  {
    "id": "F25",
    "name": "配置、账户、凭据和数据范围",
    "nodes": [
      {
        "id": "F25_N01",
        "label": "接收账户与安全范围策略指令",
        "kind": "input",
        "dependencies": [],
        "required": true,
        "resourceKeys": [
          "config_vault"
        ],
        "effectType": "读取",
        "inputFields": [
          "account",
          "cloudPolicy"
        ],
        "outputFields": [
          "policyParsed"
        ]
      },
      {
        "id": "F25_N02",
        "label": "决策模型 圈定上下文允许域",
        "kind": "semantic_decision",
        "dependencies": [
          "F25_N01"
        ],
        "required": true,
        "resourceKeys": [
          "domestic_decision_inference"
        ],
        "effectType": "读取",
        "inputFields": [
          "policy"
        ],
        "outputFields": [
          "allowedCategories",
          "bannedCategories"
        ]
      },
      {
        "id": "F25_N03",
        "label": "宿主依据实际授权组装出站上下文",
        "kind": "deterministic_check",
        "dependencies": [
          "F25_N02"
        ],
        "required": true,
        "resourceKeys": [],
        "effectType": "读取",
        "inputFields": [
          "testPayloadContainsPrivate"
        ],
        "outputFields": [
          "filteredOut",
          "cleanPayloadReady"
        ],
        "evidenceRequirement": "保留凭据隔离并核对数据范围；本地保存不等于没有内容送往已配置国内云。"
      },
      {
        "id": "F25_N04",
        "label": "保存安全配置引用 (三态独立验证)",
        "kind": "complete",
        "dependencies": [
          "F25_N03"
        ],
        "required": true,
        "resourceKeys": [
          "config_vault"
        ],
        "effectType": "写入（以工具描述为准）",
        "inputFields": [
          "saved",
          "pingConnected",
          "capabilityTested"
        ],
        "outputFields": [
          "accountActive",
          "privateDataBlocked"
        ]
      }
    ],
    "edges": [
      {
        "source": "F25_N01",
        "target": "F25_N02",
        "required": true
      },
      {
        "source": "F25_N02",
        "target": "F25_N03",
        "required": true
      },
      {
        "source": "F25_N03",
        "target": "F25_N04",
        "required": true
      }
    ],
    "recovery": [
      "失败只重做受影响节点；保留已有证据与来源版本。",
      "取消传播至未完成模型与工具请求；已经发生的副作用保留记录。",
      "需要新信息的语义判断进入下一轮，不与其前置判断盲目合批。"
    ]
  },
  {
    "id": "F26",
    "name": "镜像、部署与比赛验收",
    "nodes": [
      {
        "id": "F26_N01",
        "label": "固定代码、镜像与模型调用配置版本",
        "kind": "input",
        "dependencies": [],
        "required": true,
        "resourceKeys": [
          "docker_registry"
        ],
        "effectType": "读取",
        "inputFields": [
          "代码版本",
          "镜像构建配置",
          "模型配置引用"
        ],
        "outputFields": [
          "imageTag"
        ]
      },
      {
        "id": "F26_N02",
        "label": "[阶段1/4] 构建镜像并检查产物",
        "kind": "tool_exec",
        "dependencies": [
          "F26_N01"
        ],
        "required": true,
        "resourceKeys": [
          "docker_daemon"
        ],
        "effectType": "写入（以工具描述为准）",
        "inputFields": [
          "buildCommand"
        ],
        "outputFields": [
          "imageSizeMb",
          "buildDurationSeconds"
        ]
      },
      {
        "id": "F26_N03",
        "label": "[阶段2/4] 部署上线并就绪探针",
        "kind": "deterministic_check",
        "dependencies": [
          "F26_N02"
        ],
        "required": true,
        "resourceKeys": [
          "container_runtime"
        ],
        "effectType": "读取",
        "inputFields": [
          "healthzPort"
        ],
        "outputFields": [
          "podRunning",
          "readinessProbe"
        ],
        "evidenceRequirement": "分别读取实际镜像版本、deployment与健康结果；就绪探针不是语义工具闭环。"
      },
      {
        "id": "F26_N04",
        "label": "[阶段3/4] 真实语义闭环评测：云端提案->本地Policy->工具->证据",
        "kind": "verification",
        "dependencies": [
          "F26_N03"
        ],
        "required": true,
        "resourceKeys": [
          "cloud_decision_rpc"
        ],
        "effectType": "读取",
        "inputFields": [
          "testTask"
        ],
        "outputFields": [
          "cloudProposal",
          "localPolicyVerdict",
          "toolExecution",
          "evidenceVerified"
        ],
        "evidenceRequirement": "分别留存invocation/trace、工具实际状态、Evidence及外部读回，不扩大固定读取场景证明范围。"
      },
      {
        "id": "F26_N05",
        "label": "记录验收覆盖与剩余问题；按既有发布条件上线",
        "kind": "complete",
        "dependencies": [
          "F26_N04"
        ],
        "required": true,
        "resourceKeys": [
          "service_gateway"
        ],
        "effectType": "写入（以工具描述为准）",
        "inputFields": [
          "verificationEvidence"
        ],
        "outputFields": [
          "activeServiceVersion",
          "status"
        ]
      }
    ],
    "edges": [
      {
        "source": "F26_N01",
        "target": "F26_N02",
        "required": true
      },
      {
        "source": "F26_N02",
        "target": "F26_N03",
        "required": true
      },
      {
        "source": "F26_N03",
        "target": "F26_N04",
        "required": true
      },
      {
        "source": "F26_N04",
        "target": "F26_N05",
        "required": true
      }
    ],
    "recovery": [
      "失败只重做受影响节点；保留已有证据与来源版本。",
      "取消传播至未完成模型与工具请求；已经发生的副作用保留记录。",
      "需要新信息的语义判断进入下一轮，不与其前置判断盲目合批。"
    ]
  },
  {
    "id": "F27",
    "name": "上下文预算、压缩与恢复",
    "nodes": [
      {
        "id": "F27_N01",
        "label": "读取模型实际容量、配置与版本",
        "kind": "deterministic_check",
        "dependencies": [],
        "required": true,
        "resourceKeys": [],
        "effectType": "读取",
        "inputFields": [],
        "outputFields": [
          "可用上下文容量",
          "当前任务/事实版本"
        ],
        "evidenceRequirement": "不默认固定Token数；服务参数接受与内部思考深度验证分开。"
      },
      {
        "id": "F27_N05",
        "label": "并行召回当前责任、事实与必要工具证据",
        "kind": "tool_exec",
        "dependencies": [
          "F27_N01"
        ],
        "required": true,
        "resourceKeys": [],
        "effectType": "读取",
        "inputFields": [],
        "outputFields": [
          "原文片段与引用",
          "未知/缺失项"
        ]
      },
      {
        "id": "F27_N02",
        "label": "主模型联合排序上下文并识别缺口",
        "kind": "semantic_decision",
        "dependencies": [
          "F27_N05"
        ],
        "required": true,
        "resourceKeys": [],
        "effectType": "读取",
        "inputFields": [],
        "outputFields": [
          "保留片段",
          "压缩建议",
          "扩充/恢复请求"
        ]
      },
      {
        "id": "F27_N03",
        "label": "长日志按需由执行模型摘要",
        "kind": "execution_model",
        "dependencies": [
          "F27_N02"
        ],
        "required": false,
        "resourceKeys": [],
        "effectType": "读取",
        "inputFields": [],
        "outputFields": [
          "摘要",
          "原文区段映射"
        ],
        "condition": "确需压缩且原文可恢复"
      },
      {
        "id": "F27_N06",
        "label": "需要原证据时恢复引用或扩充检索",
        "kind": "tool_exec",
        "dependencies": [
          "F27_N02"
        ],
        "required": false,
        "resourceKeys": [],
        "effectType": "读取",
        "inputFields": [],
        "outputFields": [
          "恢复原文",
          "新增依据或无新增标记"
        ],
        "condition": "存在新证据需求或摘要不足"
      },
      {
        "id": "F27_N04",
        "label": "宿主组装关键指令/授权/版本映射",
        "kind": "deterministic_check",
        "dependencies": [
          "F27_N02",
          "F27_N03"
        ],
        "required": true,
        "resourceKeys": [],
        "effectType": "读取",
        "inputFields": [],
        "outputFields": [
          "上下文包",
          "引用版本",
          "保留/压缩原因"
        ],
        "condition": "直接选取或摘要候选已就绪",
        "evidenceRequirement": "关键指令与有效授权绑定不可被摘要替换；实际容量不足时明确报告。"
      },
      {
        "id": "F27_N07",
        "label": "变化使旧映射失效并反馈F28",
        "kind": "checkpoint",
        "dependencies": [
          "F27_N04"
        ],
        "required": true,
        "resourceKeys": [],
        "effectType": "本地状态 / 缓存",
        "inputFields": [],
        "outputFields": [
          "上下文版本",
          "模型能力反馈",
          "可复用片段"
        ]
      }
    ],
    "edges": [
      {
        "source": "F27_N01",
        "target": "F27_N05",
        "required": true
      },
      {
        "source": "F27_N05",
        "target": "F27_N02",
        "required": true
      },
      {
        "source": "F27_N02",
        "target": "F27_N03",
        "required": false,
        "condition": "确需摘要"
      },
      {
        "source": "F27_N02",
        "target": "F27_N06",
        "required": false,
        "condition": "有缺口"
      },
      {
        "source": "F27_N06",
        "target": "F27_N02",
        "required": false,
        "condition": "新增信息"
      },
      {
        "source": "F27_N02",
        "target": "F27_N04",
        "required": false,
        "condition": "容量足够"
      },
      {
        "source": "F27_N03",
        "target": "F27_N04",
        "required": true
      },
      {
        "source": "F27_N04",
        "target": "F27_N07",
        "required": true
      }
    ],
    "recovery": [
      "只重做来源或输入已失效的分支；保留仍有效结果、版本与操作记录。",
      "取消先传播到本地宿主；已发生副作用保留，未知写入先读回核实。",
      "截止时间、取消与实际配置贯穿模型及工具；不新增固定轮数、金额或预算限制。"
    ]
  },
  {
    "id": "F28",
    "name": "多厂商模型、思考深度与主对话分配",
    "nodes": [
      {
        "id": "F28_N01",
        "label": "主对话接收目标与模型偏好",
        "kind": "input",
        "dependencies": [],
        "required": true,
        "resourceKeys": [],
        "effectType": "读取",
        "inputFields": [
          "goal"
        ],
        "outputFields": [
          "roles"
        ]
      },
      {
        "id": "F28_N02",
        "label": "Laya从候选中选择模型分工与上下文",
        "kind": "semantic_decision",
        "dependencies": [
          "F28_N01"
        ],
        "required": false,
        "resourceKeys": [],
        "effectType": "读取",
        "inputFields": [],
        "outputFields": [
          "任务角色与范围",
          "能力匹配的模型候选",
          "原生参数/验证强度候选"
        ],
        "condition": "缺少有效分派建议，或新证据需要重判"
      },
      {
        "id": "F28_N03",
        "label": "区分原生思考、步骤预算与验证强度",
        "kind": "deterministic_check",
        "dependencies": [
          "F28_N01",
          "F28_N02"
        ],
        "required": true,
        "resourceKeys": [],
        "effectType": "读取",
        "inputFields": [
          "check"
        ],
        "outputFields": [
          "research",
          "analysis",
          "coder"
        ],
        "condition": "复用有效已有分派建议，或本轮主模型分派完成",
        "evidenceRequirement": "按实际MaaS/Provider能力映射；不支持的参数明确报告，步骤预算不冒充原生思考深度。"
      },
      {
        "id": "F28_N04",
        "label": "并行启动独立研究与分析分支",
        "kind": "parallel_split",
        "dependencies": [
          "F28_N03"
        ],
        "required": true,
        "resourceKeys": [],
        "effectType": "读取",
        "inputFields": [],
        "outputFields": []
      },
      {
        "id": "F28_N06",
        "label": "Qwen3-32B：收集与整理资料候选",
        "kind": "execution_model",
        "dependencies": [
          "F28_N04"
        ],
        "required": true,
        "resourceKeys": [],
        "effectType": "读取",
        "inputFields": [],
        "outputFields": [
          "sources"
        ]
      },
      {
        "id": "F28_N07",
        "label": "DeepSeek-V4-Pro：分析现有上下文",
        "kind": "execution_model",
        "dependencies": [
          "F28_N04"
        ],
        "required": true,
        "resourceKeys": [],
        "effectType": "读取",
        "inputFields": [
          "context"
        ],
        "outputFields": [
          "analysis"
        ]
      },
      {
        "id": "F28_N08",
        "label": "GLM-5.2：依据研究结果生成补丁候选",
        "kind": "execution_model",
        "dependencies": [
          "F28_N06"
        ],
        "required": true,
        "resourceKeys": [],
        "effectType": "读取",
        "inputFields": [
          "sources"
        ],
        "outputFields": [
          "patch"
        ]
      },
      {
        "id": "F28_N09",
        "label": "汇合研究、分析与补丁候选",
        "kind": "join",
        "dependencies": [
          "F28_N06",
          "F28_N07",
          "F28_N08"
        ],
        "required": true,
        "resourceKeys": [],
        "effectType": "读取",
        "inputFields": [],
        "outputFields": []
      },
      {
        "id": "F28_N10",
        "label": "独立检查来源、补丁与行为测试",
        "kind": "verification",
        "dependencies": [
          "F28_N09"
        ],
        "required": true,
        "resourceKeys": [],
        "effectType": "读取",
        "inputFields": [],
        "outputFields": [
          "sourcesSupported",
          "tests"
        ],
        "evidenceRequirement": "独立来源核对与实际行为检查分别记录；模型自报不能充当工具执行证据。"
      },
      {
        "id": "F28_N05",
        "label": "唯一决策模型判断是否需要补查或修订",
        "kind": "semantic_decision",
        "dependencies": [
          "F28_N10"
        ],
        "required": true,
        "resourceKeys": [],
        "effectType": "读取",
        "inputFields": [],
        "outputFields": [
          "recommendation"
        ]
      },
      {
        "id": "F28_N11",
        "label": "Runtime 完成条件通过后汇总",
        "kind": "complete",
        "dependencies": [
          "F28_N05"
        ],
        "required": true,
        "resourceKeys": [],
        "effectType": "读取",
        "inputFields": [],
        "outputFields": [
          "result"
        ]
      },
      {
        "id": "F28_N12",
        "label": "执行者在派定范围内自主选工具与探索",
        "kind": "tool_exec",
        "dependencies": [
          "F28_N04"
        ],
        "required": false,
        "resourceKeys": [],
        "effectType": "读取",
        "inputFields": [
          "受派子任务",
          "已公布工具能力",
          "实际取消/期限/预算配置"
        ],
        "outputFields": [
          "经ToolGateway的请求",
          "局部观察与候选"
        ],
        "condition": "该子任务需要本地工具循环",
        "evidenceRequirement": "复用subagent-host.ts受限工具循环；无需每次工具选择都回到全局模型。授权仍通过原有Policy。"
      }
    ],
    "edges": [
      {
        "source": "F28_N01",
        "target": "F28_N02",
        "required": true
      },
      {
        "source": "F28_N02",
        "target": "F28_N03",
        "required": true
      },
      {
        "source": "F28_N03",
        "target": "F28_N04",
        "required": true
      },
      {
        "source": "F28_N04",
        "target": "F28_N06",
        "required": true
      },
      {
        "source": "F28_N04",
        "target": "F28_N07",
        "required": true
      },
      {
        "source": "F28_N06",
        "target": "F28_N08",
        "required": true
      },
      {
        "source": "F28_N06",
        "target": "F28_N09",
        "required": true
      },
      {
        "source": "F28_N07",
        "target": "F28_N09",
        "required": true
      },
      {
        "source": "F28_N08",
        "target": "F28_N09",
        "required": true
      },
      {
        "source": "F28_N09",
        "target": "F28_N10",
        "required": true
      },
      {
        "source": "F28_N10",
        "target": "F28_N05",
        "required": true
      },
      {
        "source": "F28_N05",
        "target": "F28_N11",
        "required": true
      },
      {
        "source": "F28_N04",
        "target": "F28_N12",
        "required": false
      },
      {
        "source": "F28_N01",
        "target": "F28_N03",
        "required": false,
        "condition": "有效建议已存在"
      }
    ],
    "recovery": [
      "失败只重做受影响节点；保留已有证据与来源版本。",
      "取消传播至未完成模型与工具请求；已经发生的副作用保留记录。",
      "需要新信息的语义判断进入下一轮，不与其前置判断盲目合批。"
    ]
  }
];
