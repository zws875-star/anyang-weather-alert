// 安阳市区天气预警监控
// 数据来源：中国气象局 (CMA) 官方 API
// https://weather.cma.cn/api/now/53898 (安阳站)

import fetch from 'node-fetch';

const CONFIG = {
  FEISHU_APP_ID: process.env.FEISHU_APP_ID || '',
  FEISHU_APP_SECRET: process.env.FEISHU_APP_SECRET || '',
  USER_OPEN_ID: process.env.FEISHU_USER_OPEN_ID || '',
  TEST_MODE: process.env.TEST_MODE === 'true',
  
  // 安阳 CMA 站点编号
  ANYANG_STATION_ID: '53898',
  
  // 监控范围：市区（不包含所辖县）
  // 站点 53898 对应安阳市区
};

// ============ 飞书 API ============

async function getFeishuToken() {
  const resp = await fetch(
    'https://open.feishu.cn/open-apis/auth/v3/tenant_access_token/internal',
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        app_id: CONFIG.FEISHU_APP_ID,
        app_secret: CONFIG.FEISHU_APP_SECRET,
      }),
    }
  );
  const data = await resp.json();
  if (data.code !== 0) throw new Error(`飞书 token 失败: ${JSON.stringify(data)}`);
  return data.tenant_access_token;
}

async function sendMsg(token, text) {
  const resp = await fetch(
    'https://open.feishu.cn/open-apis/im/v1/messages?receive_id_type=open_id',
    {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${token}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        receive_id: CONFIG.USER_OPEN_ID,
        msg_type: 'text',
        content: JSON.stringify({ text }),
      }),
    }
  );
  const data = await resp.json();
  return data.code === 0;
}

async function sendAlerts(token, alerts, count = 5) {
  const msg = `🚨【安阳市区高级别气象预警提醒】🚨\n\n${alerts}\n\n⚠️ 请做好防范准备，注意安全！`;
  for (let i = 1; i <= count; i++) {
    await sendMsg(token, `${msg}\n[消息 ${i}/${count}]`);
    if (i < count) await new Promise((r) => setTimeout(r, 2000));
  }
}

async function sendHealthCheck(token) {
  const msg = `🌤【安阳市区天气监控日报】\n\n今日一切正常，当前无红色/橙色预警。\n\n✅ 监控服务运行正常\n✅ 数据来源：中国气象局\n✅ 下次检查时间：明日整点\n\n如果天气有变，我会第一时间通知你。`;
  await sendMsg(token, msg);
}

// ============ CMA 天气预警查询 ============

async function checkWeatherAlerts() {
  const url = `https://weather.cma.cn/api/now/${CONFIG.ANYANG_STATION_ID}`;
  const resp = await fetch(url, {
    headers: {
      'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7)',
      'Accept': 'application/json',
    },
  });
  const data = await resp.json();

  if (data.code !== 0) {
    throw new Error(`CMA API 返回错误: ${JSON.stringify(data)}`);
  }

  const alarms = data.data?.alarm || [];
  const now = data.data?.now || {};

  // 获取天气概况
  const temp = now.temperature;
  const weather = `${now.temperature}°C, ${now.windDirection} ${now.windSpeed}m/s, 湿度${now.humidity}%`;

  return { alarms, weather };
}

// ============ 主函数 ============

async function main() {
  console.log('========================================');
  console.log('安阳市区天气预警监控 - 中国气象局');
  console.log(`时间: ${new Date().toLocaleString('zh-CN', { timeZone: 'Asia/Shanghai' })}`);
  console.log('========================================\n');

  if (!CONFIG.FEISHU_APP_ID || !CONFIG.FEISHU_APP_SECRET || !CONFIG.USER_OPEN_ID) {
    console.error('飞书配置不完整');
    process.exit(1);
  }

  const beijingNow = new Date(new Date().toLocaleString('en-US', { timeZone: 'Asia/Shanghai' }));
  const hour = beijingNow.getHours();

  try {
    const token = await getFeishuToken();
    console.log('飞书 token 获取成功\n');

    if (CONFIG.TEST_MODE) {
      await sendMsg(
        token,
        '✅【安阳市区天气预警监控测试】\n\n脚本运行正常！\n\n📡 数据来源：中国气象局 (weather.cma.cn)\n🕐 检查频率：每小时\n📍 监控范围：安阳市区\n🔴🟠 关注级别：红色预警、橙色预警\n📢 发现预警：连续发送 5 次\n\n测试成功 ✅'
      );
      console.log('测试消息发送完成');
      return;
    }

    // 查询 CMA 官方预警
    console.log('正在查询中国气象局官方数据...');
    let result;
    try {
      result = await checkWeatherAlerts();
    } catch (err) {
      console.error('CMA API 查询失败:', err.message);
      await sendMsg(token, `⚠️【天气预警监控异常】\n\n查询中国气象局数据失败：${err.message}`);
      return;
    }

    const { alarms, weather } = result;
    console.log(`安阳天气: ${weather}`);
    console.log(`官方预警数: ${alarms.length}`);
    
    if (alarms.length > 0) {
      alarms.forEach(a => console.log(`  - ${a.title} (${a.signallevel})`));
    }

    // 只关注红色和橙色预警
    const highAlarms = alarms.filter((a) => {
      const level = (a.signallevel || a.severity || '').toLowerCase();
      return level.includes('红') || level === 'red' || level === 'orange' || level.includes('橙');
    });

    if (highAlarms.length > 0) {
      console.log('\n🔴🟠 发现高级别预警！发送 5 次提醒...');
      const alertText = highAlarms
        .map(
          (a) =>
            `• ${a.title}\n  ⏰ 生效时间：${a.effective || '未知'}`
        )
        .join('\n\n');
      await sendAlerts(token, alertText);
      console.log('预警提醒发送完成 ✅');
    } else {
      console.log('\n✅ 无红色/橙色预警');
      if (hour === 20) {
        console.log('每日 20:00 发送日报...');
        await sendHealthCheck(token);
        console.log('日报发送完成 ✅');
      } else {
        console.log('非日报时间，安静跳过');
      }
    }
  } catch (err) {
    console.error('\n❌ 执行出错:', err.message);
    console.error(err.stack);
  }
}

main();
