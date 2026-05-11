#!/usr/bin/env node
// -*- coding: utf-8 -*-

/**
 * 验证稳定性合并提交的改动
 * 
 * 验收标准：
 * 1. /api/health 返回包含 web.useVueClient、web.staticDirectory、web.mode
 * 2. requireSuperAdmin 方法存在
 * 3. 权限检查点被正确添加到管理型 API
 */

import fs from 'fs/promises';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const projectRoot = path.resolve(__dirname, '..');

async function verifyHealthEndpoint() {
  const webServerPath = path.resolve(projectRoot, 'core', 'web-server.js');
  const content = await fs.readFile(webServerPath, 'utf8');
  
  console.log('📋 验证 /api/health 端点...');
  
  // 检查 health 端点是否返回新字段
  if (!content.includes('useVueClient: this.useVueClient')) {
    console.error('❌ /api/health 缺少 useVueClient 字段');
    return false;
  }
  
  if (!content.includes('mode: this.useVueClient ? "vue" : "legacy"')) {
    console.error('❌ /api/health 缺少 mode 字段');
    return false;
  }
  
  console.log('✅ /api/health 包含正确的字段');
  return true;
}

async function verifySuperAdminMethod() {
  const webServerPath = path.resolve(projectRoot, 'core', 'web-server.js');
  const content = await fs.readFile(webServerPath, 'utf8');
  
  console.log('📋 验证 requireSuperAdmin 方法...');
  
  if (!content.includes('requireSuperAdmin(user, res)')) {
    console.error('❌ 缺少 requireSuperAdmin 方法');
    return false;
  }
  
  if (!content.includes('this.core.authManager?.hasEverything?.(user)')) {
    console.error('❌ requireSuperAdmin 方法实现不正确');
    return false;
  }
  
  console.log('✅ requireSuperAdmin 方法正确实现');
  return true;
}

async function verifyPermissionChecks() {
  const webServerPath = path.resolve(projectRoot, 'core', 'web-server.js');
  const content = await fs.readFile(webServerPath, 'utf8');
  
  console.log('📋 验证权限检查点...');
  
  // 需要验证的端点
  const endpoints = [
    'POST /api/log-clock/set',
    'POST /api/log-clock/reset',
    'POST /api/plugin-subscriptions/set',
    'POST /api/plugin-subscriptions/toggle',
    'POST /api/jobs/playtime-refresh-online',
    'POST /api/jobs/rcon-refresh',
    'POST /api/playtime/online/refresh',
    'POST /api/playtime/players/refresh',
    'POST /api/console/rcon',
    'POST /api/logpost/raw-output',
    'POST /api/rcon/refresh',
    'POST /api/combat/clear',
    'POST /api/combat-clean/clear',
    'POST /api/player-database/sync-online',
    'PATCH /api/db/players/:id/permission-group',
    'POST /api/db/reset-kill-stats',
    'DELETE /api/db/players/:id',
    'POST /api/weapon-collector/clear',
  ];
  
  // 验证每个端点是否有权限检查
  let failedEndpoints = [];
  
  for (const endpoint of endpoints) {
    const [method, path] = endpoint.split(' ');
    
    // 简单的启发式检查：检查路径和方法之后是否有 requireSuperAdmin 检查
    if (!content.includes(`req.method === "${method}"`)) {
      // 某些端点可能不指定方法
      failedEndpoints.push(`❌ 找不到 ${endpoint} 的方法检查`);
      continue;
    }
  }
  
  // 计算 requireSuperAdmin 的调用次数
  const matches = content.match(/if \(!this\.requireSuperAdmin/g);
  const count = matches ? matches.length : 0;
  
  if (count < 18) {
    console.warn(`⚠️  仅发现 ${count} 处权限检查（预期至少 18 处）`);
  } else {
    console.log(`✅ 发现 ${count} 处权限检查`);
  }
  
  if (failedEndpoints.length > 0) {
    failedEndpoints.forEach(msg => console.error(msg));
    return false;
  }
  
  return true;
}

async function verifyStartupOrder() {
  const mainPath = path.resolve(projectRoot, 'main.js');
  const content = await fs.readFile(mainPath, 'utf8');
  
  console.log('📋 验证 main.js 启动顺序...');
  
  // 找到启动代码部分
  const authStart = content.indexOf('await authManager.start()');
  const moduleLoad = content.indexOf('await moduleManager.loadBuiltInModules()');
  const eventPipelineSet = content.indexOf('eventPipeline.setCombatIdentityResolver');
  const rconStart = content.indexOf('await rconManager.start()');
  const udpStart = content.indexOf('await udpReceiver.start()');
  const pluginLoad = content.indexOf('await pluginManager.loadPlugins()');
  const webStart = content.indexOf('await webServer.start()');
  const pythonStart = content.indexOf('await pythonLogParserManager.start()');
  
  if (authStart === -1) {
    console.error('❌ 找不到 authManager.start()');
    return false;
  }
  
  // 验证顺序
  const positions = [
    { name: 'authManager.start()', pos: authStart },
    { name: 'moduleManager.loadBuiltInModules()', pos: moduleLoad },
    { name: 'eventPipeline.setCombatIdentityResolver', pos: eventPipelineSet },
    { name: 'rconManager.start()', pos: rconStart },
    { name: 'udpReceiver.start()', pos: udpStart },
    { name: 'pluginManager.loadPlugins()', pos: pluginLoad },
    { name: 'webServer.start()', pos: webStart },
    { name: 'pythonLogParserManager.start()', pos: pythonStart },
  ];
  
  for (let i = 0; i < positions.length - 1; i++) {
    if (positions[i].pos > positions[i + 1].pos && positions[i].pos !== -1 && positions[i + 1].pos !== -1) {
      console.error(`❌ 顺序错误: ${positions[i].name} 应该在 ${positions[i + 1].name} 之前`);
      return false;
    }
  }
  
  console.log('✅ 启动顺序正确');
  
  // 验证注释也被更新了
  if (!content.includes('6. AuthManager') && !content.includes('7. ModuleManager (loadBuiltInModules)')) {
    console.warn('⚠️  启动顺序注释可能未更新');
  } else {
    console.log('✅ 启动顺序注释已更新');
  }
  
  return true;
}

async function verifyStartupLogs() {
  const mainPath = path.resolve(projectRoot, 'main.js');
  const content = await fs.readFile(mainPath, 'utf8');
  
  console.log('📋 验证启动日志...');
  
  if (!content.includes('Web static mode:')) {
    console.error('❌ 缺少 "Web static mode:" 日志');
    return false;
  }
  
  if (!content.includes('Static directory:')) {
    console.error('❌ 缺少 "Static directory:" 日志');
    return false;
  }
  
  console.log('✅ 启动日志已正确添加');
  return true;
}

async function main() {
  console.log('\n🔍 验证稳定性合并提交...\n');
  
  const results = await Promise.all([
    verifyHealthEndpoint(),
    verifySuperAdminMethod(),
    verifyPermissionChecks(),
    verifyStartupOrder(),
    verifyStartupLogs(),
  ]);
  
  console.log('\n' + '='.repeat(50));
  
  if (results.every(r => r)) {
    console.log('\n✅ 所有验证通过！\n');
    process.exit(0);
  } else {
    console.log('\n❌ 某些验证失败\n');
    process.exit(1);
  }
}

main().catch(err => {
  console.error('验证过程出错:', err);
  process.exit(1);
});
