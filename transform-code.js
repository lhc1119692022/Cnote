#!/usr/bin/env node
/**
 * 智能代码转换工具
 *
 * 功能：
 * 1. 将编译后的代码转换为可读的 React/TypeScript
 * 2. 移除所有 License 验证相关代码
 * 3. 智能重命名变量
 * 4. 重建组件结构
 */

const fs = require('fs');
const path = require('path');

console.log('🔄 智能代码转换工具\n');

const EXTRACTED_FILE = path.join(__dirname, 'extracted-complete/extracted-functions.json');
const OUTPUT_DIR = path.join(__dirname, 'src');
const ELECTRON_SOURCE = path.join(__dirname, '../../Creatos/recovered-project/electron-src-rebuilt/electron');

if (!fs.existsSync(EXTRACTED_FILE)) {
  console.error('❌ 错误：找不到提取的函数文件');
  console.error('   请先运行 extract-all-components.js');
  process.exit(1);
}

// 读取提取的函数
const extracted = JSON.parse(fs.readFileSync(EXTRACTED_FILE, 'utf-8'));

console.log(`📊 加载了 ${Object.keys(extracted).length} 个页面的数据`);
console.log(`📊 总共 ${Object.values(extracted).reduce((sum, p) => sum + p.functions.length, 0)} 个函数\n`);

// License 相关的关键词（用于检测和移除）
const LICENSE_KEYWORDS = [
  'license',
  'activate',
  'activation',
  'validateLicense',
  'checkLicense',
  'hasValidLicense',
  'getLicense',
  'machineId',
  'instanceId',
  'licenseKey',
  'lemonsqueezy',
  'lemon-squeezy',
];

/**
 * 检测函数是否与 License 相关
 */
function isLicenseRelated(code) {
  const lowerCode = code.toLowerCase();
  return LICENSE_KEYWORDS.some(keyword => lowerCode.includes(keyword));
}

/**
 * 简单的变量名推断
 */
function inferVariableName(varName, context) {
  // 如果已经是有意义的名字，保留
  if (varName.length > 2) {
    return varName;
  }

  // 基于上下文推断
  const contextLower = context.toLowerCase();

  // 常见的 React hooks 模式
  if (context.includes('useState')) {
    if (contextLower.includes('email')) return 'email';
    if (contextLower.includes('title')) return 'title';
    if (contextLower.includes('content')) return 'content';
    if (contextLower.includes('url')) return 'url';
    if (contextLower.includes('search')) return 'searchQuery';
    if (contextLower.includes('dialog')) return 'isDialogOpen';
    if (contextLower.includes('loading')) return 'isLoading';
    if (contextLower.includes('error')) return 'errorMessage';
    if (contextLower.includes('source')) return 'sources';
    if (contextLower.includes('flow')) return 'flows';
    if (contextLower.includes('output')) return 'outputs';
  }

  // 保持原样
  return varName;
}

/**
 * 转换编译后的 JSX 调用
 */
function convertJSX(code) {
  let converted = code;

  // 简单的 JSX 转换（基础版）
  // (0,a.jsx)("div", {...}) => <div {...} />
  // 这里只做基础标记，实际转换在后续步骤

  return converted;
}

/**
 * 美化函数代码
 */
function beautifyFunction(func) {
  let code = func.code;

  // 添加换行和缩进
  code = code
    .replace(/\{/g, ' {\n  ')
    .replace(/\}/g, '\n}')
    .replace(/;/g, ';\n  ')
    .replace(/,/g, ',\n  ');

  return code;
}

/**
 * 处理页面文件
 */
function processPage(pageKey, pageData) {
  const { sourcePath, functions } = pageData;

  console.log(`\n📄 处理: ${sourcePath}`);
  console.log(`   函数数量: ${functions.length}`);

  // 过滤掉 License 相关的函数
  const nonLicenseFunctions = functions.filter(func => {
    const isLicense = isLicenseRelated(func.code);
    if (isLicense) {
      console.log(`   ⚠️  跳过 License 相关函数: ${func.name}() (${func.codeLength} 字符)`);
    }
    return !isLicense;
  });

  console.log(`   ✅ 保留 ${nonLicenseFunctions.length} 个函数`);

  if (nonLicenseFunctions.length === 0) {
    console.log(`   ⚠️  所有函数都被过滤，跳过此文件`);
    return null;
  }

  // 找到主要的页面组件（通常是代码最长的函数）
  const mainFunction = nonLicenseFunctions.reduce((max, func) =>
    func.codeLength > max.codeLength ? func : max
  , nonLicenseFunctions[0]);

  console.log(`   📌 主函数: ${mainFunction.name}() (${mainFunction.codeLength} 字符)`);

  return {
    sourcePath,
    mainFunction,
    helperFunctions: nonLicenseFunctions.filter(f => f !== mainFunction)
  };
}

// 统计信息
const stats = {
  totalPages: 0,
  processedPages: 0,
  skippedPages: 0,
  removedFunctions: 0,
  keptFunctions: 0,
};

console.log('\n' + '='.repeat(60));
console.log('开始处理所有页面');
console.log('='.repeat(60));

const processed = {};

for (const [pageKey, pageData] of Object.entries(extracted)) {
  stats.totalPages++;

  const result = processPage(pageKey, pageData);

  if (result) {
    processed[pageKey] = result;
    stats.processedPages++;
    stats.keptFunctions += result.helperFunctions.length + 1;
  } else {
    stats.skippedPages++;
  }

  const originalCount = pageData.functions.length;
  const keptCount = result ? result.helperFunctions.length + 1 : 0;
  stats.removedFunctions += originalCount - keptCount;
}

console.log('\n' + '='.repeat(60));
console.log('处理完成');
console.log('='.repeat(60));
console.log(`\n📊 统计信息:`);
console.log(`   总页面数: ${stats.totalPages}`);
console.log(`   处理成功: ${stats.processedPages}`);
console.log(`   跳过页面: ${stats.skippedPages}`);
console.log(`   保留函数: ${stats.keptFunctions}`);
console.log(`   移除函数: ${stats.removedFunctions} (License 相关)`);

// 保存处理结果
const outputFile = path.join(OUTPUT_DIR, '../processed-components.json');
fs.writeFileSync(outputFile, JSON.stringify(processed, null, 2));

console.log(`\n✅ 处理结果保存到: ${outputFile}`);
console.log(`\n⏭️  下一步：生成 TypeScript 文件`);
