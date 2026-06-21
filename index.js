// 安阳市区天气预警监控脚本
// 每小时执行一次，检测红/橙预警，通过飞书发送提醒
// Feishu Open API 文档: https://open.feishu.cn/document

import fetch from 'node-fetch';

// ============= 配置 =============
const CONFIG = {
  // 飞书应用凭证（OpenClaw 正在使用的同一个飞书机器人）
  FEISHU_APP_ID: process.env.FEISHU_APP_ID || '',
  FEISHU_APP_SECRET: process.env.FEISHU_APP_SECRET || '',

  // 要发送消息的用户 Open ID
  USER_OPEN_ID: process.env.FEISHU_USER_OPEN_ID || '',

  // 安阳城市代码（中国天气网）
  ANYANG_CITY_CODE: '101180201',

  // 是否发送测试消息（设为 true 时无论有无预警都发送一条测试消息）
  TEST_MODE: process.env.TEST_MODE === 'true',
};

// ============= 飞书 API 工具 =============

/**
 * 获取飞书 tenant_access_token
 */
async function getFeishuToken() {
  const url = 'https://open.feishu.cn/open-apis/auth/v3/tenant_access_token/internal';
  const resp = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      app_id: CONFIG.FEISHU_APP_ID,
      app_secret: CONFIG.FEISHU_APP_SECRET,
    }),
  });
  const data = await resp.json();
  if (data.code !== 0) throw new Error(`获取飞书 token 失败: ${JSON.stringify(data)}`);
  return data.tenant_access_token;
}

/**
 * 通过飞书 API 发送消息给指定用户
 */
async function sendFeishuMessage(token, text, count = 1) {
  const url = 'https://open.feishu.cn/open-apis/im/v1/messages?receive_id_type=open_id';
  const content = JSON.stringify({ text });
  
  const resp = await fetch(url, {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${token}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      receive_id: CONFIG.USER_OPEN_ID,
      msg_type: 'text',
      content,
    }),
  });
  const data = await resp.json();
  
  if (data.code !== 0) {
    console.error(`[${count}/5] 发送第 ${count} 条消息失败:`, JSON.stringify(data));
    return false;
  }
  console.log(`[${count}/5] 第 ${count} 条消息发送成功`);
  return true;
}

/**
 * 连续发送 5 条消息（间隔 2 秒）
 */
async function sendAlerts(token, alertInfo) {
  const message = `🚨【安阳市区高级别气象预警提醒】🚨\n\n${alertInfo}`;
  
  console.log('开始发送 5 条预警消息...');
  for (let i = 1; i <= 5; i++) {
    await sendFeishuMessage(token, message, i);
    if (i < 5) {
      await new Promise(r => setTimeout(r, 2000));
    }
  }
  console.log('5 条消息全部发送完成');
}

/**
 * 发送测试消息（验证配置是否正常）
 */
async function sendTestMessage(token) {
  const message = '✅【天气预警监控测试】\n\n安阳市区天气预警监控脚本已成功运行！\n\n- 执行频率：每小时\n- 监控范围：安阳市区（不含所辖县）\n- 关注级别：红色预警、橙色预警\n- 发现预警：连续发送 5 次提醒\n\n当前配置正常 ✅';
  await sendFeishuMessage(token, message, 1);
  console.log('测试消息发送完成');
}

// ============= 天气预警查询 =============

/**
 * 从中国天气网查询安阳市的天气预警信息
 * 使用官方网页的 JSONP 数据接口
 */
async function checkWeatherAlert() {
  // 方法1：通过中国天气网城市天气页面获取预警信息
  try {
    console.log(`正在查询安阳市天气预警...`);
    
    // 获取安阳市的天气页面
    const url = `https://www.weather.com.cn/weathern/${CONFIG.ANYANG_CITY_CODE}.shtml`;
    const resp = await fetch(url, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36',
        'Accept': 'text/html,application/xhtml+xml',
        'Accept-Language': 'zh-CN,zh;q=0.9',
      },
    });
    const html = await resp.text();
    
    // 在页面中搜索预警相关信息
    // 中国天气网使用 alert-xxx 类名表示预警
    const alertPatterns = [
      /(?:红色|橙色).*?(?:预警|预警信号)/g,
      /(?:预警|预警信号).*?(?:红色|橙色)/g,
      /(?:红|橙).*?(?:色预警|色警报)/g,
      /class="[^"]*alarm[^"]*"[^>]*>[^<]*(?:红色|橙色)[^<]*</gi,
      /(?:暴雨|暴雪|台风|高温|寒潮|大风|沙尘暴|雷电|冰雹|大雾).*?(?:红色|橙色)[^。]*预警/g,
    ];
    
    const alerts = [];
    for (const pattern of alertPatterns) {
      const matches = html.matchAll(pattern);
      for (const match of matches) {
        alerts.push(match[0]);
      }
    }
    
    console.log(`页面扫描完成，发现 ${alerts.length} 条预警关键词`);
    if (alerts.length > 0) {
      console.log('预警内容:', alerts.join(' | '));
    }
    
    return alerts;
    
  } catch (error) {
    console.error('查询天气预警失败:', error.message);
    throw error;
  }
}

/**
 * 查询中央气象台（NMC）的预警信息
 * 备用查询源
 */
async function checkNmcAlert() {
  try {
    console.log('正在查询中央气象台预警...');
    
    const url = 'http://www.nmc.cn/publish/alarm.html'; 
    const resp = await fetch(url, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36',
        'Accept': 'text/html,application/xhtml+xml',
        'Accept-Language': 'zh-CN,zh;q=0.9',
      },
    });
    const html = await resp.text();
    
    // 扫描页面查找河南安阳相关预警
    const lines = html.split('\n');
    const anyangAlerts = [];
    
    for (const line of lines) {
      if (line.includes('安阳') || line.includes('Anyang') || line.includes('anyang')) {
        if (line.includes('红色') || line.includes('橙色')) {
          anyangAlerts.push(line.trim());
        }
      }
    }
    
    return anyangAlerts;
    
  } catch (error) {
    console.error('查询中央气象台预警失败:', error.message);
    return [];
  }
}

// ============= 主函数 =============

/**
 * 判断预警级别（是否为红/橙）
 */
function isRedOrOrange(text) {
  return text.includes('红色') || text.includes('橙色');
}

async function main() {
  console.log('========================================');
  console.log('安阳市区天气预警监控 - 开始执行');
  console.log(`执行时间: ${new Date().toLocaleString('zh-CN', { timeZone: 'Asia/Shanghai' })}`);
  console.log('========================================\n');

  // 验证配置
  if (!CONFIG.FEISHU_APP_ID || !CONFIG.FEISHU_APP_SECRET || !CONFIG.USER_OPEN_ID) {
    console.error('错误: 飞书配置不完整！请设置环境变量:');
    console.error('  FEISHU_APP_ID      - 飞书应用的 App ID');
    console.error('  FEISHU_APP_SECRET  - 飞书应用的 App Secret');
    console.error('  FEISHU_USER_OPEN_ID - 接收消息的用户 Open ID');
    process.exit(1);
  }

  try {
    // 获取飞书 token
    console.log('正在获取飞书 token...');
    const token = await getFeishuToken();
    console.log('飞书 token 获取成功\n');

    // 如果是测试模式，发送测试消息后直接退出
    if (CONFIG.TEST_MODE) {
      console.log('🔄 测试模式：发送测试消息验证配置...');
      await sendTestMessage(token);
      console.log('\n✅ 测试完成！脚本配置正常。');
      return;
    }

    // 查询天气预警
    let alerts = [];
    
    try {
      alerts = await checkWeatherAlert();
    } catch (err) {
      console.log('主要查询源失败，尝试备用查询源...');
    }
    
    // 如果主源没查到，尝试备用源
    if (alerts.length === 0) {
      try {
        const nmcAlerts = await checkNmcAlert();
        alerts = alerts.concat(nmcAlerts);
      } catch (err) {
        console.log('备用查询源也未获取到数据');
      }
    }

    console.log(`\n共发现 ${alerts.length} 条预警信息`);

    // 分析预警级别
    const highLevelAlerts = alerts.filter(a => isRedOrOrange(a));

    if (highLevelAlerts.length > 0) {
      console.log('\n🔴🟠 发现高级别预警！');
      console.log('预警内容:', highLevelAlerts.join('\n'));
      
      const alertText = `安阳市区当前发布以下高级别预警：\n${highLevelAlerts.map(a => `• ${a}`).join('\n')}\n\n⚠️ 请做好防范准备，注意安全！`;
      
      await sendAlerts(token, alertText);
      console.log('\n✅ 预警消息发送完毕');
    } else {
      console.log('\n✅ 安阳市区当前无红色/橙色预警，无需发送消息');
      
      // 每日 20:00 发送健康检查通知
      const now = new Date();
      const beijingHour = new Date(now.toLocaleString('en-US', { timeZone: 'Asia/Shanghai' })).getHours();
      if (beijingHour === 20) {
        console.log('\n🕐 每日健康检查时间（20:00），发送平安通知...');
        const healthMessage = '🌤【安阳市区天气监控日报】\n\n今日一切正常，当前无红色/橙色预警。\n\n✅ 监控服务运行正常\n✅ 下次检查时间：明日整点\n\n如果天气有变，我会第一时间通知你。';
        await sendFeishuMessage(token, healthMessage, 1);
        console.log('健康检查通知发送完成');
      }
    }

  } catch (error) {
    console.error('\n❌ 执行出错:', error.message);
    console.error(error.stack);
    
    // 尝试发送错误通知
    try {
      const token = await getFeishuToken();
      await sendFeishuMessage(token, 
        `⚠️【天气预警监控异常】\n\n监控脚本执行出错：\n${error.message}\n\n时间：${new Date().toLocaleString('zh-CN', { timeZone: 'Asia/Shanghai' })}`
      );
    } catch (_) {
      console.error('无法发送错误通知（飞书 token 可能也获取失败了）');
    }
    
    process.exit(1);
  }
}

main();
