// 文档配置候选，无模型调用、模拟时延、价格或账户可用性声明。
export const DEFAULT_DECISION_MODEL = 'laya-multilingual';
export const MODEL_CATALOG = [
 {id:'laya-multilingual',vendor:'Laya',name:'Laya multilingual',role:'既有可选Local实验；不进入Competition Agent/Workflow编排',native:'现有typed-choice接口；不适用通用模型原生思考档位，ARM64推理待验收'},
 {id:'deepseek-v4.1-flash',vendor:'深度求索',name:'DeepSeek-V4.1-Flash',role:'执行候选',native:'思考开关及low/high/max；接口接受待实测'},
 {id:'deepseek-v4-flash',vendor:'深度求索',name:'DeepSeek-V4-Flash',role:'执行候选',native:'思考开关及high/max；接口接受待实测'},
 {id:'deepseek-v4-pro',vendor:'深度求索',name:'DeepSeek-V4-Pro',role:'执行候选',native:'思考开关及high/max；接口接受待实测'},
 {id:'glm-5.2',vendor:'智谱',name:'GLM-5.2',role:'执行候选；角色匹配是待评估假设',native:'按MaaS参数映射，步骤预算不等于原生思考量'},
 {id:'qwen3-32b',vendor:'通义千问',name:'Qwen3-32B',role:'执行候选；不保证比其他模型快',native:'思考开关；强度档位未配置'},
 {id:'qwen3-235b-a22b',vendor:'通义千问',name:'Qwen3-235B-A22B',role:'执行候选',native:'具体端点参数待验证'},
 {id:'openpangu-2.0-flash',vendor:'华为盘古',name:'openPangu-2.0-Flash',role:'执行候选',native:'具体端点参数待验证'},
];
export const MODEL_SOURCES = [
 {label:'华为云模型目录',url:'https://support.huaweicloud.com/model-call-maas/model-call-050.html'},
 {label:'大陆区发布公告',url:'https://support.huaweicloud.com/bulletin-maas/bulletin-maas-0001.html'},
 {label:'原生思考参数',url:'https://support.huaweicloud.com/model-call-maas/model-call-019.html'},
];
