#!/usr/bin/env node
/**
 * Cnote 自动恢复工具
 *
 * 功能：
 * 1. 从编译后的代码提取完整组件（包括内联的客户端组件）
 * 2. 智能重命名变量
 * 3. 移除所有 License 验证相关代码
 * 4. 生成完整的可运行项目
 */

const fs = require('fs');
const path = require('path');

const RECOVERED_PROJECT = path.join(__dirname, '../../Creatos/recovered-project');
const OUTPUT_DIR = __dirname;

console.log('🚀 Cnote 自动恢复工具\n');
console.log('📂 源目录:', RECOVERED_PROJECT);
console.log('📂 目标目录:', OUTPUT_DIR);
console.log('');

// 检查源目录
if (!fs.existsSync(RECOVERED_PROJECT)) {
  console.error('❌ 错误：找不到 recovered-project 目录');
  console.error('   请确保路径正确:', RECOVERED_PROJECT);
  process.exit(1);
}

console.log('✅ 源目录存在');
console.log('✅ 开始恢复流程...\n');

// 第一步：创建项目结构
console.log('📁 步骤 1/7: 创建项目结构');

const dirs = [
  'electron',
  'electron/core',
  'src',
  'src/app',
  'src/app/[locale]',
  'src/app/[locale]/(protected)',
  'src/app/[locale]/(protected)/dashboard',
  'src/app/[locale]/(protected)/dashboard/flows',
  'src/app/[locale]/(protected)/dashboard/flows/[flowId]',
  'src/app/[locale]/(protected)/dashboard/outputs',
  'src/app/[locale]/(protected)/dashboard/sources',
  'src/app/[locale]/(protected)/dashboard/templates',
  'src/app/[locale]/(protected)/dashboard/style-profiles',
  'src/app/[locale]/(protected)/settings',
  'src/app/[locale]/(protected)/settings/profile',
  'src/app/[locale]/(protected)/settings/security',
  'src/app/[locale]/home',
  'src/components',
  'src/components/ui',
  'src/components/creatorflow',
  'src/components/settings',
  'src/components/settings/profile',
  'src/components/settings/security',
  'src/lib',
  'src/lib/db',
  'src/styles',
  'public',
];

dirs.forEach(dir => {
  const fullPath = path.join(OUTPUT_DIR, dir);
  if (!fs.existsSync(fullPath)) {
    fs.mkdirSync(fullPath, { recursive: true });
  }
});

console.log('   ✅ 创建了', dirs.length, '个目录\n');

console.log('✅ 项目结构创建完成');
console.log('');
console.log('⏭️  下一步：运行 extract-all-components.js');
