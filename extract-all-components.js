#!/usr/bin/env node
/**
 * 完整组件提取工具 - 包括内联的客户端组件
 *
 * 目标：从 Next.js 编译文件中提取所有函数（不只是主函数）
 */

const fs = require('fs');
const path = require('path');

console.log('🔍 完整组件提取工具\n');

const NEXT_SERVER_DIR = path.join(__dirname, '../../Creatos/recovered-project/next-app/.next/server/app');
const OUTPUT_DIR = path.join(__dirname, 'extracted-complete');

if (!fs.existsSync(OUTPUT_DIR)) {
  fs.mkdirSync(OUTPUT_DIR, { recursive: true });
}

/**
 * 提取完整函数（支持括号匹配）
 */
function extractCompleteFunction(content, startPos) {
  let braceCount = 0;
  let inFunction = false;
  let funcBody = '';
  let foundFirstBrace = false;

  for (let i = startPos; i < content.length; i++) {
    const char = content[i];
    funcBody += char;

    if (char === '{') {
      braceCount++;
      inFunction = true;
      foundFirstBrace = true;
    } else if (char === '}') {
      braceCount--;
      if (foundFirstBrace && braceCount === 0) {
        break;
      }
    }
  }

  return funcBody.trim();
}

/**
 * 提取文件中的所有函数
 */
function extractAllFunctions(content) {
  const functions = [];
  const funcPattern = /(?:async\s+)?function\s+([a-zA-Z_$][a-zA-Z0-9_$]*)\s*\([^)]*\)\s*\{/g;

  let match;
  const matches = [];

  while ((match = funcPattern.exec(content)) !== null) {
    matches.push({
      name: match[1],
      index: match.index,
      fullMatch: match[0]
    });
  }

  for (const match of matches) {
    const funcCode = extractCompleteFunction(content, match.index);

    // 只保留包含 jsx 或看起来像组件的函数
    if (funcCode.includes('.jsx') ||
        funcCode.includes('jsx(') ||
        funcCode.includes('return') ||
        funcCode.length > 200) {
      functions.push({
        name: match.name,
        code: funcCode,
        length: funcCode.length
      });
    }
  }

  return functions;
}

/**
 * 查找所有页面文件
 */
function findAllPages(dir, baseDir = dir) {
  let pages = [];

  if (!fs.existsSync(dir)) {
    return pages;
  }

  const items = fs.readdirSync(dir);

  for (const item of items) {
    const fullPath = path.join(dir, item);
    const stat = fs.statSync(fullPath);

    if (stat.isDirectory()) {
      pages = pages.concat(findAllPages(fullPath, baseDir));
    } else if (item === 'page.js') {
      const relativePath = path.relative(baseDir, fullPath);
      pages.push({ fullPath, relativePath });
    }
  }

  return pages;
}

/**
 * 提取源文件路径
 */
function extractSourcePath(content) {
  const match = content.match(/\/workspace\/src\/([^\s"']+\.tsx)/);
  return match ? match[1] : 'unknown';
}

// 主处理流程
console.log('📄 扫描所有页面文件...\n');

const pages = findAllPages(NEXT_SERVER_DIR);
const extracted = {};

console.log(`找到 ${pages.length} 个页面文件\n`);

pages.forEach(({ fullPath, relativePath }) => {
  try {
    const content = fs.readFileSync(fullPath, 'utf-8');
    const sourcePath = extractSourcePath(content);
    const functions = extractAllFunctions(content);

    if (functions.length > 0) {
      console.log(`✅ ${relativePath}`);
      console.log(`   源码: ${sourcePath}`);
      console.log(`   函数数量: ${functions.length}`);

      functions.forEach((func, idx) => {
        console.log(`   函数 ${idx + 1}: ${func.name}() - ${func.length} 字符`);
      });

      console.log('');

      extracted[relativePath] = {
        sourcePath,
        functions: functions.map(f => ({
          name: f.name,
          codeLength: f.code.length,
          code: f.code
        }))
      };
    }
  } catch (error) {
    console.log(`❌ ${relativePath}: ${error.message}`);
  }
});

// 保存提取结果
const outputFile = path.join(OUTPUT_DIR, 'extracted-functions.json');
fs.writeFileSync(outputFile, JSON.stringify(extracted, null, 2));

console.log('\n✅ 提取完成！');
console.log(`📊 总计:`);
console.log(`   - 页面数: ${Object.keys(extracted).length}`);
console.log(`   - 函数数: ${Object.values(extracted).reduce((sum, p) => sum + p.functions.length, 0)}`);
console.log(`   - 总代码量: ${Object.values(extracted).reduce((sum, p) => sum + p.functions.reduce((s, f) => s + f.codeLength, 0), 0)} 字符`);
console.log(`\n📁 保存到: ${outputFile}`);
