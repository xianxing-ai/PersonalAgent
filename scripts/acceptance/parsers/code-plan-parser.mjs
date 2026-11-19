import fs from 'node:fs';
import path from 'node:path';
import {
  normalizeEnvironment,
  validateNormalizedRecord,
} from '../types.mjs';

const TOOL_SELF_FILES = new Set([
  'code-plan-parser.mjs',
  'markdown-plan-parser.mjs',
  'json-plan-parser.mjs',
  'scanner.mjs',
  'formatter.mjs',
  'types.mjs',
  'build-pending-acceptance-index.mjs',
]);

/**
 * 判断代码文件是否为验收规划候选文件（纯文件名与静态导出特征）
 */
export function isCodePlanCandidate(filePath, content = '') {
  const baseName = path.basename(filePath).toLowerCase();

  // 排除扫描工具自身实现文件
  if (TOOL_SELF_FILES.has(baseName)) {
    return false;
  }

  // 排除测试和声明文件
  if (
    baseName.includes('.test.') ||
    baseName.includes('.spec.') ||
    baseName.endsWith('.d.ts')
  ) {
    return false;
  }

  // 1. 文件名特征
  if (baseName.endsWith('.plan.mjs') || baseName.endsWith('.plan.ts') || baseName.endsWith('.plan.js')) {
    return true;
  }
  if (baseName.includes('acceptance') && baseName.includes('plan')) {
    return true;
  }

  // 2. 代码导出特征：必须明确导出 plan*Acceptance 或 *AcceptancePlan 纯函数/对象
  if (
    /export\s+(?:async\s+)?function\s+plan[A-Za-z0-9_]*Acceptance/i.test(content) ||
    /export\s+(?:async\s+)?function\s+[A-Za-z0-9_]*AcceptancePlan/i.test(content) ||
    /export\s+const\s+plan[A-Za-z0-9_]*Acceptance/i.test(content) ||
    /export\s+const\s+[A-Za-z0-9_]*AcceptancePlan/i.test(content) ||
    /export\s+(?:async\s+)?function\s+plan[A-Za-z0-9_]+/i.test(content) ||
    /export\s+const\s+plan[A-Za-z0-9_]+/i.test(content)
  ) {
    return true;
  }

  return false;
}

/**
 * 从多行文本中提取静态字符串字面量数组（支持单引号、双引号、反引号）
 */
function extractStringLiteralsFromArrayText(rawBlock) {
  const items = [];
  const regex = /(?:['"`])([^'"`\\]*(?:\\.[^'"`\\]*)*)(?:['"`])/g;
  let match;
  while ((match = regex.exec(rawBlock)) !== null) {
    const val = match[1].trim();
    if (val) {
      items.push(val);
    }
  }
  return items;
}

/**
 * 纯文本词法 Tokenizer：
 * 将代码解析为 Token 序列（字符串、注释、正则、标点、关键字、标识符、数字）。
 * 正确处理正则字面量 vs 除法运算符（区分标点/关键字 vs 标识符/闭合括号），
 * 正确处理模板字面量及其 ${} 表达式（保留表达式内部代码 token，递归跟踪大括号平衡），
 * 未闭合语法（未闭合模板、未闭合注释、未闭合字符串、未闭合正则）安全 fail-closed。
 * 绝不使用 import/require/eval/vm 执行任何代码。
 */
export function tokenizeCode(content) {
  const tokens = [];
  let i = 0;
  const len = content.length;
  let line = 1;
  let col = 1;

  // 模板字面量嵌套栈：{ type: 'template_string' | 'template_expr', braceDepth: number }
  const templateStack = [];
  let unclosedSyntax = null;

  function advance() {
    const ch = content[i];
    i++;
    if (ch === '\n') {
      line++;
      col = 1;
    } else {
      col++;
    }
    return ch;
  }

  function peek(offset = 0) {
    return i + offset < len ? content[i + offset] : '';
  }

  function getLastCodeToken() {
    for (let k = tokens.length - 1; k >= 0; k--) {
      if (tokens[k].type !== 'comment' && tokens[k].type !== 'whitespace') {
        return tokens[k];
      }
    }
    return null;
  }

  while (i < len) {
    const startLine = line;
    const startCol = col;
    const ch = peek();

    // 检查是否处于模板字面量非代码字符串中
    const currentTpl = templateStack.length > 0 ? templateStack[templateStack.length - 1] : null;
    if (currentTpl && currentTpl.type === 'template_string') {
      let strVal = '';
      let isClosed = false;
      while (i < len) {
        const c = peek();
        if (c === '\\') {
          advance();
          strVal += advance();
        } else if (c === '$' && peek(1) === '{') {
          advance(); // $
          advance(); // {
          templateStack.push({ type: 'template_expr', braceDepth: 1 });
          break;
        } else if (c === '`') {
          advance();
          templateStack.pop();
          isClosed = true;
          break;
        } else {
          strVal += advance();
        }
      }
      tokens.push({
        type: 'string',
        value: strVal,
        raw: strVal,
        lineStart: startLine,
        colStart: startCol,
        lineEnd: line,
        colEnd: col,
      });
      if (!isClosed && templateStack.length > 0 && templateStack[templateStack.length - 1].type === 'template_string' && i >= len) {
        unclosedSyntax = 'unclosed_template_literal';
      }
      continue;
    }

    // 检查空白字符
    if (/\s/.test(ch)) {
      advance();
      continue;
    }

    // 单行注释 //
    if (ch === '/' && peek(1) === '/') {
      let comm = '';
      advance(); // /
      advance(); // /
      while (i < len && peek() !== '\n' && peek() !== '\r') {
        comm += advance();
      }
      tokens.push({
        type: 'comment',
        value: comm,
        raw: '//' + comm,
        lineStart: startLine,
        colStart: startCol,
        lineEnd: line,
        colEnd: col,
      });
      continue;
    }

    // 多行注释 /* ... */
    if (ch === '/' && peek(1) === '*') {
      let comm = '';
      advance(); // /
      advance(); // *
      let closed = false;
      while (i < len) {
        if (peek() === '*' && peek(1) === '/') {
          advance();
          advance();
          closed = true;
          break;
        }
        comm += advance();
      }
      if (!closed) {
        unclosedSyntax = 'unclosed_multiline_comment';
      }
      tokens.push({
        type: 'comment',
        value: comm,
        raw: '/*' + comm + (closed ? '*/' : ''),
        lineStart: startLine,
        colStart: startCol,
        lineEnd: line,
        colEnd: col,
      });
      continue;
    }

    // 单引号字符串
    if (ch === '\'') {
      advance();
      let strVal = '';
      let closed = false;
      while (i < len) {
        const c = peek();
        if (c === '\\') {
          advance();
          strVal += advance();
        } else if (c === '\'') {
          advance();
          closed = true;
          break;
        } else if (c === '\n' || c === '\r') {
          break;
        } else {
          strVal += advance();
        }
      }
      if (!closed) {
        unclosedSyntax = 'unclosed_single_quote';
      }
      tokens.push({
        type: 'string',
        value: strVal,
        raw: "'" + strVal + (closed ? "'" : ''),
        lineStart: startLine,
        colStart: startCol,
        lineEnd: line,
        colEnd: col,
      });
      continue;
    }

    // 双引号字符串
    if (ch === '"') {
      advance();
      let strVal = '';
      let closed = false;
      while (i < len) {
        const c = peek();
        if (c === '\\') {
          advance();
          strVal += advance();
        } else if (c === '"') {
          advance();
          closed = true;
          break;
        } else if (c === '\n' || c === '\r') {
          break;
        } else {
          strVal += advance();
        }
      }
      if (!closed) {
        unclosedSyntax = 'unclosed_double_quote';
      }
      tokens.push({
        type: 'string',
        value: strVal,
        raw: '"' + strVal + (closed ? '"' : ''),
        lineStart: startLine,
        colStart: startCol,
        lineEnd: line,
        colEnd: col,
      });
      continue;
    }

    // 模板字符串反引号开始 `
    if (ch === '`') {
      advance();
      templateStack.push({ type: 'template_string' });
      continue;
    }

    // 正则表达式 vs 除法运算符
    if (ch === '/') {
      const lastToken = getLastCodeToken();
      let isRegex = false;
      if (!lastToken) {
        isRegex = true;
      } else if (lastToken.type === 'punct') {
        if (lastToken.value !== ')' && lastToken.value !== ']' && lastToken.value !== '}') {
          isRegex = true;
        }
      } else if (lastToken.type === 'keyword') {
        isRegex = true;
      }

      if (isRegex) {
        advance(); // /
        let regVal = '';
        let closed = false;
        let inClass = false;
        while (i < len) {
          const c = peek();
          if (c === '\\') {
            advance();
            regVal += '\\' + advance();
          } else if (c === '[' && !inClass) {
            inClass = true;
            regVal += advance();
          } else if (c === ']' && inClass) {
            inClass = false;
            regVal += advance();
          } else if (c === '/' && !inClass) {
            advance();
            closed = true;
            break;
          } else if (c === '\n' || c === '\r') {
            break;
          } else {
            regVal += advance();
          }
        }
        let flags = '';
        while (i < len && /[a-z]/i.test(peek())) {
          flags += advance();
        }
        if (!closed) {
          unclosedSyntax = 'unclosed_regex';
        }
        tokens.push({
          type: 'regex',
          value: regVal,
          flags,
          raw: '/' + regVal + '/' + flags,
          lineStart: startLine,
          colStart: startCol,
          lineEnd: line,
          colEnd: col,
        });
        continue;
      } else {
        advance();
        tokens.push({
          type: 'punct',
          value: '/',
          raw: '/',
          lineStart: startLine,
          colStart: startCol,
          lineEnd: line,
          colEnd: col,
        });
        continue;
      }
    }

    // 标点符号与括号平衡监控（在模板表达式内时更新 braceDepth）
    if (/[{}()[\]:;,?.=+\-*%^~<>&|!]/.test(ch)) {
      const punct = advance();
      let fullPunct = punct;
      if ((punct === '=' || punct === '!' || punct === '<' || punct === '>') && peek() === '=') {
        fullPunct += advance();
        if (peek() === '=') fullPunct += advance();
      } else if (punct === '=' && peek() === '>') {
        fullPunct += advance();
      } else if ((punct === '&' && peek() === '&') || (punct === '|' && peek() === '|')) {
        fullPunct += advance();
      }

      if (punct === '{') {
        const top = templateStack.length > 0 ? templateStack[templateStack.length - 1] : null;
        if (top && top.type === 'template_expr') {
          top.braceDepth++;
        }
      } else if (punct === '}') {
        const top = templateStack.length > 0 ? templateStack[templateStack.length - 1] : null;
        if (top && top.type === 'template_expr') {
          top.braceDepth--;
          if (top.braceDepth === 0) {
            templateStack.pop();
          }
        }
      }

      tokens.push({
        type: 'punct',
        value: fullPunct,
        raw: fullPunct,
        lineStart: startLine,
        colStart: startCol,
        lineEnd: line,
        colEnd: col,
      });
      continue;
    }

    // 标识符或关键字
    if (/[a-zA-Z_$]/.test(ch)) {
      let idStr = advance();
      while (i < len && /[a-zA-Z0-9_$]/.test(peek())) {
        idStr += advance();
      }
      const KEYWORDS = new Set([
        'return', 'export', 'const', 'let', 'var', 'function', 'async',
        'readonly', 'true', 'false', 'null', 'undefined', 'as', 'import',
        'from', 'if', 'else', 'case', 'switch', 'default', 'try', 'catch',
        'finally', 'throw', 'typeof', 'instanceof', 'void', 'delete', 'new',
      ]);
      const isKw = KEYWORDS.has(idStr);
      tokens.push({
        type: isKw ? 'keyword' : 'identifier',
        value: idStr,
        raw: idStr,
        lineStart: startLine,
        colStart: startCol,
        lineEnd: line,
        colEnd: col,
      });
      continue;
    }

    // 数字
    if (/[0-9]/.test(ch)) {
      let numStr = advance();
      while (i < len && /[0-9.xXabcdefABCDEF]/.test(peek())) {
        numStr += advance();
      }
      tokens.push({
        type: 'number',
        value: numStr,
        raw: numStr,
        lineStart: startLine,
        colStart: startCol,
        lineEnd: line,
        colEnd: col,
      });
      continue;
    }

    // 其他字符
    const otherChar = advance();
    tokens.push({
      type: 'punct',
      value: otherChar,
      raw: otherChar,
      lineStart: startLine,
      colStart: startCol,
      lineEnd: line,
      colEnd: col,
    });
  }

  if (templateStack.length > 0 && !unclosedSyntax) {
    const top = templateStack[templateStack.length - 1];
    unclosedSyntax = top.type === 'template_expr' ? 'unclosed_template_expression' : 'unclosed_template_literal';
  }

  return {
    tokens,
    unclosedSyntax,
  };
}

/**
 * 从冒号或等号右侧开始，提取当前对象字面量深度的完整 RHS 有效代码 Token 序列
 * 自动跨越注释，以顶层逗号、分号或闭合大括号为边界。
 */
function extractRhsCodeTokens(tokens, startIdx) {
  const rhsTokens = [];
  let j = startIdx;
  let depth = 0; // 内部括号深度 ( ) [ ] { }

  while (j < tokens.length) {
    const t = tokens[j];
    // 跟踪内部嵌套括号
    if (t.value === '(' || t.value === '{' || t.value === '[') depth++;
    if (t.value === ')' || t.value === '}' || t.value === ']') {
      if (depth === 0) break; // 遇到外层闭合大括号，说明对象结束
      depth--;
    }
    // 顶层逗号或分号表示当前属性赋值结束
    if ((t.value === ',' || t.value === ';') && depth === 0) {
      break;
    }
    if (t.type !== 'comment') {
      rhsTokens.push(t);
    }
    j++;
  }
  return rhsTokens;
}

/**
 * 纯文本词法处理：剥离单行/多行注释、字符串字面量、模板字面量非 ${} 区域及正则字面量
 * 严格保留换行符 \n 与 \r，被剥离的内容替换为等量空格，确保行号和字符列位置完全一致。
 * 绝不使用 import/require/eval/vm 执行任何代码。
 */
export function stripCodeCommentsAndStrings(content) {
  const { tokens, unclosedSyntax } = tokenizeCode(content);
  // 基于 tokens 重构 cleanContent，严格保持行数和列位置
  const lines = content.split('\n');
  const lineChars = lines.map((l) => l.split('').map(() => ' '));

  for (const t of tokens) {
    // 仅保留标识符、关键字、标点、数字（即有效语法代码结构）
    if (t.type === 'identifier' || t.type === 'keyword' || t.type === 'punct' || t.type === 'number') {
      const lIdx = t.lineStart - 1;
      const cIdx = t.colStart - 1;
      if (lIdx >= 0 && lIdx < lineChars.length) {
        for (let k = 0; k < t.raw.length; k++) {
          if (cIdx + k < lineChars[lIdx].length) {
            lineChars[lIdx][cIdx + k] = t.raw[k];
          }
        }
      }
    }
  }

  return {
    cleanContent: lineChars.map((l) => l.join('')).join('\n'),
    unclosedSyntax,
  };
}

/**
 * 纯静态文本提取代码规划文件字段（绝不 import/require/eval/vm 执行任何代码）
 */
function staticallyExtractPlanRecord(content, filePath, repoRoot) {
  const relativePath = path.relative(repoRoot, filePath).split(path.sep).join('/');
  const origLines = content.split('\n');
  const lines = origLines;

  const provenance = {};
  const cannotConfirm = {};
  const warnings = [];

  // 纯文本词法分析与 Token 化（绝不动态执行任何代码）
  const { tokens, unclosedSyntax } = tokenizeCode(content);

  // 纯文本词法处理：剥离单行/多行注释、字符串与模板非代码区，严格保留换行
  const { cleanContent } = stripCodeCommentsAndStrings(content);
  const cleanLines = cleanContent.split('\n');

  // 提取纯有效代码 Token 序列：排除 comment token，保证语法语义邻接性不受任何注释打断
  // 每个 codeToken 严格保留源码真实 lineStart、colStart、raw 等位置信息
  const codeTokens = tokens.filter((t) => t.type !== 'comment');

  if (unclosedSyntax !== null) {
    cannotConfirm.syntax = {
      sourcePath: relativePath,
      reason: 'lexical_syntax_error',
      details: `Unclosed syntax "${unclosedSyntax}" detected during static lexical scanning. Code plan cannot be safely confirmed without well-formed syntax.`,
    };
  }

  // 1. 提取 ID / Capability
  let id = null;
  for (let i = 0; i < origLines.length; i++) {
    const cleanLine = cleanLines[i];
    if (!cleanLine.trim()) continue;
    const line = origLines[i];
    const capMatch = line.match(/(?:export\s+const\s+[A-Z0-9_]*CAPABILITY\s*=\s*|const\s+PLAN_ID\s*=\s*|(?:planId|id|capability)\s*[:=]\s*)['"]([^'"]+)['"]/);
    if (capMatch) {
      id = capMatch[1];
      provenance.id = {
        value: id,
        sourcePath: relativePath,
        lineStart: i + 1,
        lineEnd: i + 1,
        source: 'ts_code_literal',
        raw: line.trim(),
      };
      break;
    }
  }
  if (!id) {
    cannotConfirm.id = {
      sourcePath: relativePath,
      reason: 'missing_id',
      details: 'No explicit id/planId/capability string literal found in code. Filename cannot substitute for missing source field.',
    };
  }

  // 2. 提取 Title
  let title = null;
  for (let i = 0; i < origLines.length; i++) {
    const cleanLine = cleanLines[i];
    if (!cleanLine.trim()) continue;
    const line = origLines[i];
    const titleMatch = line.match(/(?:const\s+PLAN_TITLE\s*=\s*|(?:title|planTitle|name)\s*[:=]\s*)['"]([^'"]+)['"]/);
    if (titleMatch) {
      title = titleMatch[1];
      provenance.title = {
        value: title,
        sourcePath: relativePath,
        lineStart: i + 1,
        lineEnd: i + 1,
        source: 'ts_code_literal',
        raw: line.trim(),
      };
      break;
    }
  }
  if (!title) {
    cannotConfirm.title = {
      sourcePath: relativePath,
      reason: 'missing_title',
      details: 'No explicit title/planTitle string literal found in code. ID or filename cannot substitute for missing source field.',
    };
  }

  // 3. 提取 closedLoop：全局遍历代码 Token，识别所有代码赋值点（排除类型声明、支持同一行多赋值检测）
  // 基于 codeTokens 进行语义分析，保证在 key 与冒号、冒号与 RHS 之间存在注释时依然能够精准识别代码赋值，避免隐藏真实的 true 分支
  const closedLoopOccurrences = [];
  if (unclosedSyntax === null) {
    for (let idx = 0; idx < codeTokens.length; idx++) {
      const t = codeTokens[idx];
      if (t.type === 'identifier' && t.value === 'closedLoop') {
        const prev = idx > 0 ? codeTokens[idx - 1] : null;
        const next = idx + 1 < codeTokens.length ? codeTokens[idx + 1] : null;
        const next2 = idx + 2 < codeTokens.length ? codeTokens[idx + 2] : null;

        // 排除接口或类型定义：readonly closedLoop: boolean 或 closedLoop: boolean
        if (next && next.type === 'punct' && next.value === ':') {
          if (next2 && next2.type === 'identifier' && next2.value === 'boolean') {
            continue;
          }
        }
        if (prev && prev.type === 'keyword' && prev.value === 'readonly') {
          if (next && next.type === 'punct' && next.value === ':') {
            if (next2 && next2.type === 'identifier' && next2.value === 'boolean') {
              continue;
            }
          }
        }

        // 检查实际赋值：后一个 token 为 : 或 =
        if (next && next.type === 'punct' && (next.value === ':' || next.value === '=')) {
          const rhsTokens = extractRhsCodeTokens(codeTokens, idx + 2);
          let rawVal = '';

          // 严格完整值边界检测：必须且只能恰好有 1 个独立代码 Token 且为 false 或 true 关键字
          // 后面仍有运算符（如 ||, &&, ?, + 等）、成员访问或多 token 组合，一律视为动态表达式
          if (rhsTokens.length === 1 && rhsTokens[0].type === 'keyword' && (rhsTokens[0].value === 'false' || rhsTokens[0].value === 'true')) {
            rawVal = rhsTokens[0].value;
          } else if (rhsTokens.length > 0) {
            rawVal = rhsTokens.map((tok) => tok.raw || tok.value).join(' ');
          }

          closedLoopOccurrences.push({
            line: t.lineStart,
            col: t.colStart,
            rawVal,
            tokenIdx: idx,
            fullLine: origLines[t.lineStart - 1] ? origLines[t.lineStart - 1].trim() : '',
          });
        }
      }
    }
  }

  let closedLoop = undefined;
  let targetClosedLoopTokenIdx = -1;
  let targetClosedLoopLine = -1;

  if (unclosedSyntax !== null) {
    cannotConfirm.closedLoop = {
      sourcePath: relativePath,
      reason: 'lexical_syntax_error',
      details: `Syntax error "${unclosedSyntax}" prevents reliable closedLoop extraction.`,
    };
  } else if (closedLoopOccurrences.length === 0) {
    cannotConfirm.closedLoop = {
      sourcePath: relativePath,
      reason: 'missing_closedLoop',
      details: 'No closedLoop property found in code',
    };
  } else if (closedLoopOccurrences.length === 1) {
    const occ = closedLoopOccurrences[0];
    targetClosedLoopTokenIdx = occ.tokenIdx;
    targetClosedLoopLine = occ.line;
    if (occ.rawVal === 'false') {
      closedLoop = false;
      provenance.closedLoop = {
        value: false,
        sourcePath: relativePath,
        lineStart: occ.line,
        lineEnd: occ.line,
        source: 'ts_code_literal',
        raw: occ.fullLine,
      };
    } else if (occ.rawVal === 'true') {
      closedLoop = true;
      provenance.closedLoop = {
        value: true,
        sourcePath: relativePath,
        lineStart: occ.line,
        lineEnd: occ.line,
        source: 'ts_code_literal',
        raw: occ.fullLine,
      };
    } else {
      // 动态表达式（如 closedLoop: false || true, closedLoop: true && cond 或 closedLoop: false ? x : y）
      cannotConfirm.closedLoop = {
        sourcePath: relativePath,
        reason: 'ambiguous_closedLoop',
        lineStart: occ.line,
        lineEnd: occ.line,
        details: `Dynamic expression for closedLoop detected: "${occ.rawVal}". Static analysis cannot evaluate runtime boolean expression.`,
        occurrences: closedLoopOccurrences,
      };
    }
  } else {
    // 存在多个条件分支或同一行多赋值返回不同 closedLoop，一律严格报错 ambiguous_closedLoop
    cannotConfirm.closedLoop = {
      sourcePath: relativePath,
      reason: 'ambiguous_closedLoop',
      details: `Multiple code branches/assignments (${closedLoopOccurrences.length}) assigning closedLoop detected in code. Static analysis cannot determine default branch without runtime execution.`,
      occurrences: closedLoopOccurrences,
    };
  }

  // 4. 提取 status：对象字面量作用域精准锚定（严格完整值边界检测，绝不使用行距启发式排序，定位包含 closedLoop 的计划对象显式声明）
  let status = null;
  const objectStack = [];
  const objectScopes = [];

  for (let idx = 0; idx < codeTokens.length; idx++) {
    const t = codeTokens[idx];
    if (t.type === 'punct' && t.value === '{') {
      objectStack.push({
        startTokenIdx: idx,
        startLine: t.lineStart,
        closedLoopTokenIdx: null,
        statusToken: null,
        hasDynamicStatus: false,
        dynamicStatusRaw: '',
      });
    } else if (t.type === 'punct' && t.value === '}') {
      if (objectStack.length > 0) {
        const obj = objectStack.pop();
        obj.endTokenIdx = idx;
        obj.endLine = t.lineStart;
        objectScopes.push(obj);
      }
    } else if (objectStack.length > 0) {
      const currentObj = objectStack[objectStack.length - 1];
      if (t.type === 'identifier' && t.value === 'closedLoop') {
        const next = idx + 1 < codeTokens.length ? codeTokens[idx + 1] : null;
        if (next && next.type === 'punct' && next.value === ':') {
          currentObj.closedLoopTokenIdx = idx;
        }
      } else if (t.type === 'identifier' && t.value === 'status') {
        const next = idx + 1 < codeTokens.length ? codeTokens[idx + 1] : null;
        if (next && next.type === 'punct' && next.value === ':') {
          const rhsTokens = extractRhsCodeTokens(codeTokens, idx + 2);
          // 严格完整值边界检测：必须且只能恰好有 1 个独立代码 Token 且为合法 string 字面量
          // 后面仍有拼接（如 "unavailable" + suffix）、三元表达式等，一律标记动态 status
          if (rhsTokens.length === 1 && rhsTokens[0].type === 'string') {
            const rawStatus = rhsTokens[0].value.trim();
            const VALID_STATUSES = new Set(['unavailable', 'pending', 'in_progress', 'ready', 'verified']);
            if (VALID_STATUSES.has(rawStatus)) {
              currentObj.statusToken = {
                value: rawStatus,
                line: t.lineStart,
                col: t.colStart,
                raw: origLines[t.lineStart - 1] ? origLines[t.lineStart - 1].trim() : '',
              };
            }
          } else if (rhsTokens.length > 1) {
            currentObj.hasDynamicStatus = true;
            currentObj.dynamicStatusRaw = rhsTokens.map((tok) => tok.raw || tok.value).join(' ');
          }
        }
      }
    }
  }

  if (targetClosedLoopTokenIdx >= 0) {
    const parentObject = objectScopes.find((obj) =>
      obj.startTokenIdx < targetClosedLoopTokenIdx &&
      obj.endTokenIdx > targetClosedLoopTokenIdx &&
      obj.closedLoopTokenIdx === targetClosedLoopTokenIdx
    );

    if (parentObject && parentObject.hasDynamicStatus) {
      cannotConfirm.status = {
        sourcePath: relativePath,
        reason: 'ambiguous_status',
        details: `Dynamic expression for status detected: "${parentObject.dynamicStatusRaw}". Static analysis cannot evaluate runtime string expression.`,
      };
    } else if (parentObject && parentObject.statusToken) {
      status = parentObject.statusToken.value;
      provenance.status = {
        value: status,
        sourcePath: relativePath,
        lineStart: parentObject.statusToken.line,
        lineEnd: parentObject.statusToken.line,
        source: 'ts_code_literal',
        raw: parentObject.statusToken.raw,
      };
    } else {
      cannotConfirm.status = {
        sourcePath: relativePath,
        reason: 'missing_status',
        details: 'No explicit status property declared within the acceptance plan object containing closedLoop.',
      };
    }
  } else {
    cannotConfirm.status = {
      sourcePath: relativePath,
      reason: 'missing_status',
      details: 'No valid closedLoop property to anchor plan object scope.',
    };
  }

  // 5. 提取 reason
  let reason = null;
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    const rMatch = line.match(/(?:export\s+const\s+[A-Z0-9_]*PENDING_REASON\s*=\s*|reason\s*[:=]\s*)['"]([^'"]+)['"]/);
    if (rMatch) {
      reason = rMatch[1];
      provenance.reason = {
        value: reason,
        sourcePath: relativePath,
        lineStart: i + 1,
        lineEnd: i + 1,
        source: 'ts_code_literal',
        raw: line.trim(),
      };
      break;
    }
  }

  // 6. 提取 requiredEnvironments（严禁全文关键词猜测环境，只读明确字面量数组）
  let requiredEnvironments = undefined;
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    const envMatch = line.match(/(?:export\s+const\s+REQUIRED_ENVIRONMENTS\s*=\s*|(?:requiredEnvironments|environments)\s*[:=]\s*)\[([\s\S]*?)\]/);
    if (envMatch) {
      const rawItems = extractStringLiteralsFromArrayText(envMatch[1]);
      const norm = normalizeEnvironment(rawItems);
      if (norm && norm.environments.length > 0) {
        requiredEnvironments = norm.environments;
        provenance.requiredEnvironments = {
          value: requiredEnvironments,
          sourcePath: relativePath,
          lineStart: i + 1,
          lineEnd: i + 1,
          source: 'ts_code_literal',
          raw: line.trim(),
        };
        break;
      }
    }
  }
  if (!requiredEnvironments) {
    // 检查是否跨多行声明了 REQUIRED_ENVIRONMENTS 数组
    const multiMatch = content.match(/(?:export\s+const\s+REQUIRED_ENVIRONMENTS\s*=\s*|(?:requiredEnvironments|environments)\s*[:=]\s*)\[([\s\S]*?)\]/);
    if (multiMatch) {
      const rawItems = extractStringLiteralsFromArrayText(multiMatch[1]);
      const norm = normalizeEnvironment(rawItems);
      if (norm && norm.environments.length > 0) {
        requiredEnvironments = norm.environments;
        provenance.requiredEnvironments = {
          value: requiredEnvironments,
          sourcePath: relativePath,
          source: 'ts_code_multiline_literal',
          raw: multiMatch[0].slice(0, 100),
        };
      }
    }
  }
  if (!requiredEnvironments) {
    cannotConfirm.requiredEnvironments = {
      sourcePath: relativePath,
      reason: 'missing_environment_declaration',
      details: 'No explicit requiredEnvironments literal array found in code. Context keywords (such as profile/token/windows) are strictly prohibited from inferring required environments.',
    };
  }

  // 7. 提取 acceptanceSteps（严禁借用 pending 填补步骤）
  let acceptanceSteps = undefined;
  const stepsRegex = /(?:const\s+DEFAULT_CHECKLIST\s*=\s*|const\s+ACCEPTANCE_STEPS\s*=\s*|(?:acceptanceSteps|checklist|DEFAULT_STEPS)\s*[:=]\s*)(?:Object\.freeze\()?\[([\s\S]*?)\]/g;
  let stepsMatch;
  while ((stepsMatch = stepsRegex.exec(content)) !== null) {
    const rawItems = extractStringLiteralsFromArrayText(stepsMatch[1]);
    if (rawItems.length > 0) {
      acceptanceSteps = rawItems;
      provenance.acceptanceSteps = {
        value: acceptanceSteps,
        sourcePath: relativePath,
        source: 'ts_code_checklist_literal',
        itemCount: acceptanceSteps.length,
      };
      break;
    }
  }
  if (!acceptanceSteps) {
    cannotConfirm.acceptanceSteps = {
      sourcePath: relativePath,
      reason: 'missing_acceptance_steps',
      details: 'No explicit checklist/acceptanceSteps array literal found in code. Borrowing pending descriptions to fake steps is strictly prohibited.',
    };
  }

  // 8. 提取 evidenceRequirements（严禁借用 pending 填补证据）
  let evidenceRequirements = undefined;
  const evRegex = /(?:const\s+EVIDENCE_REQUIREMENTS\s*=\s*|const\s+EVIDENCE_CHECKS\s*=\s*|(?:evidenceRequirements|evidenceChecks|DEFAULT_EVIDENCE)\s*[:=]\s*)(?:Object\.freeze\()?\[([\s\S]*?)\]/g;
  let evMatch;
  while ((evMatch = evRegex.exec(content)) !== null) {
    const rawItems = extractStringLiteralsFromArrayText(evMatch[1]);
    if (rawItems.length > 0) {
      evidenceRequirements = rawItems;
      provenance.evidenceRequirements = {
        value: evidenceRequirements,
        sourcePath: relativePath,
        source: 'ts_code_evidence_literal',
        itemCount: evidenceRequirements.length,
      };
      break;
    }
  }
  if (!evidenceRequirements) {
    cannotConfirm.evidenceRequirements = {
      sourcePath: relativePath,
      reason: 'missing_evidence_requirements',
      details: 'No explicit evidenceRequirements or evidenceChecks array literal found in code. Borrowing pending items or path strings is strictly prohibited.',
    };
  }

  // 9. 提取 pendingItems
  let pendingItems = [];
  const pendRegex = /(?:DEFAULT_[A-Z0-9_]*PENDING_ITEMS\s*=\s*|pendingItems\s*[:=]\s*)(?:Object\.freeze\()?\[([\s\S]*?)\]/g;
  let pendMatch;
  while ((pendMatch = pendRegex.exec(content)) !== null) {
    const rawItems = extractStringLiteralsFromArrayText(pendMatch[1]);
    if (rawItems.length > 0) {
      pendingItems = rawItems;
      provenance.pendingItems = {
        value: pendingItems,
        sourcePath: relativePath,
        source: 'ts_code_pending_literal',
        itemCount: pendingItems.length,
      };
      break;
    }
  }

  return {
    id,
    title,
    sourcePath: relativePath,
    planType: 'code_plan_static',
    closedLoop,
    status,
    requiredEnvironments,
    acceptanceSteps,
    evidenceRequirements,
    reason,
    pendingItems,
    provenance,
    cannotConfirm,
    warnings,
  };
}

/**
 * 解析代码规划文件（纯文本静态分析，绝不动态 import/require/eval/vm 执行任何文件）
 */
export function parseCodePlan(filePath, repoRoot = '.') {
  const relativePath = path.relative(repoRoot, filePath).split(path.sep).join('/');
  let content = '';

  try {
    content = fs.readFileSync(filePath, 'utf8');
  } catch (err) {
    return {
      isPlan: false,
      skippedReason: `read_error: ${err.message}`,
      sourcePath: relativePath,
    };
  }

  if (!isCodePlanCandidate(filePath, content)) {
    const baseName = path.basename(filePath).toLowerCase();
    const isAcceptanceRelated =
      baseName.includes('acceptance') ||
      content.includes('acceptance') ||
      content.includes('验收');

    return {
      isPlan: false,
      skippedReason: isAcceptanceRelated
        ? 'historical_acceptance_code_not_a_plan'
        : 'not_acceptance_related',
      sourcePath: relativePath,
    };
  }

  // 纯静态文本提取
  const planObj = staticallyExtractPlanRecord(content, filePath, repoRoot);
  const validation = validateNormalizedRecord(planObj, relativePath);

  if (!validation.ok) {
    return {
      isPlan: true,
      ok: false,
      sourcePath: relativePath,
      title: planObj.title || null,
      missingFields: validation.missingFields,
      errors: validation.errors,
      cannotConfirm: validation.cannotConfirm,
      rawRecord: planObj,
    };
  }

  return {
    isPlan: true,
    ok: true,
    record: planObj,
  };
}
