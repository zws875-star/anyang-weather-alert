// ⚠️ 脚本已暂停 - 等待配置完成
// 需要一个可靠的天气预警数据源（和风天气 API Key）
// 请去 https://dev.qweather.com 注册获取 Key
// 然后在 Railway 环境变量中添加 QWEATHER_KEY

import fetch from 'node-fetch';

const CONFIG = {
  FEISHU_APP_ID: process.env.FEISHU_APP_ID || '',
  FEISHU_APP_SECRET: process.env.FEISHU_APP_SECRET || '',
  USER_OPEN_ID: process.env.FEISHU_USER_OPEN_ID || '',
  QWEATHER_KEY: process.env.QWEATHER_KEY || '',
};

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

async function sendMessage(token, text) {
  const content = JSON.stringify({ text });
  const resp = await fetch('https://open.feishu.cn/open-apis/im/v1/messages?receive_id_type=open_id', {
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
  return resp.json();
}

async function main() {
  console.log('========================================');
  console.log('安阳市区天气预警监控 - 执行');
  console.log(`时间: ${new Date().toLocaleString('zh-CN', { timeZone: 'Asia/Shanghai' })}`);
  console.log('========================================');

  if (!CONFIG.QWEATHER_KEY) {
    console.log('⚠️ QWEATHER_KEY 未配置，跳过后台。');
    console.log('请去 https://dev.qweather.com 注册获取 API Key。');
    console.log('在 Railway 环境变量中添加 QWEATHER_KEY。');
    return;
  }

  console.log('✅ QWEATHER_KEY 已配置，开始查预警...');
  
  try {
    // 和风天气预警API
    const url = `https://devapi.qweather.com/v7/warning/now?location=36.099,114.329&key=${CONFIG.QWEATHER_KEY}`;
    const resp = await fetch(url);
    const data = await resp.json();
    
    if (data.code !== '200') {
      console.error('API 返回错误:', JSON.stringify(data));
      return;
    }

    const warnings = data.warning || [];
    const highLevel = warnings.filter(w => 
      w.severity === 'Red' || w.severity === 'Orange' ||
      w.severityColor === 'red' || w.severityColor === 'orange' ||
      (w.level && (w.level.includes('红') || w.level.includes('橙')))
    );

    if (highLevel.length > 0) {
      const token = await getFeishuToken();
      for (let i = 0; i < 5; i++) {
        const msg = `🚨【安阳市区高级别气象预警】🚨\n${highLevel.map(w => `• ${w.title || w.text || w.typeName}`).join('\n')}`;
        await sendMessage(token, msg);
        if (i < 4) await new Promise(r => setTimeout(r, 2000));
      }
    } else {
      console.log('✅ 无红/橙预警');
      const now = new Date(new Date().toLocaleString('en-US', { timeZone: 'Asia/Shanghai' }));
      if (now.getHours() === 20) {
        const token = await getFeishuToken();
        await sendMessage(token, '🌤【安阳市区天气监控日报】\n\n今日一切正常，无红色/橙色预警。\n✅ 监控服务运行正常');
      }
    }
  } catch (err) {
    console.error('查询失败:', err.message);
  }
}

main();
