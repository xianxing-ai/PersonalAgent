export function mountF23EvaluationControls(root,invoke){
  const section=document.createElement('details');section.className='connection-advanced';
  section.innerHTML='<summary>候选模型评估与晋升</summary><p>仅使用明确公开的样本。先固定候选、时间切分和验收阈值，再生成两分支实际输出；原任务授权卡确认后调用当前固定云部署。</p>'+
    '<form data-experiment><label>评估配置 JSON<textarea name="experiment" rows="8" required spellcheck="false"></textarea></label><label><input name="publicData" type="checkbox" required>这些输入和参考答案可以发送至当前 AgentArts</label><button type="submit" class="btn">生成实际输出</button></form>'+
    '<p data-evaluation-status role="status"></p><details><summary>两分支原输出（JSONL）</summary><label>基线<textarea data-main rows="5" readonly></textarea></label><label>候选<textarea data-shadow rows="5" readonly></textarea></label></details>'+
    '<p>将两组原输出分别作为 AgentArts 评测集评估，使用相同评估器及版本。读取完成任务的 ID、数据集版本与逐条 ID，再绑定评分；绑定不会自动晋升。</p>'+
    '<form data-evaluation-binding><label>平台结果绑定 JSON<textarea name="binding" rows="6" required spellcheck="false"></textarea></label><button type="submit" class="btn">核对原输出与评分</button></form><p data-evaluation-release></p>';
  root.append(section);const status=section.querySelector('[data-evaluation-status]');let busy=false;
  for(const [selector,method,key]of [['[data-experiment]','workflow.evaluation.prepare','experiment'],['[data-evaluation-binding]','workflow.evaluation.bind','binding']]){
    const form=section.querySelector(selector);form.addEventListener('submit',async event=>{
      event.preventDefault();if(busy)return;busy=true;form.querySelector('button').disabled=true;
      try{const input=JSON.parse(form.elements[key].value),args=key==='experiment'?{experiment:input}:input;
        const result=await invoke(method,{...args,commandId:crypto.randomUUID()});status.textContent='已受理原任务 '+result.taskId+'；请处理授权卡并查看原执行结果。';}
      catch{status.textContent='未确认完成。请检查配置或原任务记录，不要重复提交结果未知的模型调用。';}
      finally{busy=false;form.querySelector('button').disabled=false;}
    });
  }
  return {render(value){section.querySelector('[data-main]').value=value?.mainRows?.map(row=>JSON.stringify({turns:[row]})).join('\n')??'';
    section.querySelector('[data-shadow]').value=value?.shadowRows?.map(row=>JSON.stringify({turns:[row]})).join('\n')??'';
    section.querySelector('[data-evaluation-release]').textContent=value?.evaluationTaskId?
      '平台结果已绑定至 '+value.evaluationTaskId+'。在对话中请求评估晋升并提供此 ID；原 Policy 单独批准后才会修改后续 F03 模型配置。':
      value?.experimentId?'原实验 '+value.experimentId+' 已保存；尚需平台评估读回。':'先初始化当前模型基线，再提交公开样本配置。';}};
}
