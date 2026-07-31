// 安阳市区天气预警监控 v3.1
// 单数据源：weather.com.cn product API
// 每10分钟检测，发现红/橙预警立即推送（按预警发布时间去重）

import fs from 'fs';

const CONFIG = {
  FEISHU_APP_ID: process.env['FEISHU_APP_ID'] || '',
  FEISHU_APP_SECRET: process.env['FEISHU_APP_SECRET'] || '',
  USER_OPEN_ID: process.env['FEISHU_USER_OPEN_ID'] || '',
  ANYANG_CITY_CODE: '1011802', // 安阳市（含市区及所辖县）
};

// ============ 去重持久化 ============

const STATE_FILE = '/tmp/notified_alerts.json';

function loadNotified() {
  try {
    const raw = fs.readFileSync(STATE_FILE, 'utf8');
    return JSON.parse(raw);
  } catch {
    return {};
  }
}

function saveNotified(ids) {
  try {
    fs.writeFileSync(STATE_FILE, JSON.stringify(ids));
  } catch (e) {
    console.error('保存状态失败:', e.message);
  }
}

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
  if (data.code !== 0) {
    console.error('飞书发送失败:', data.msg);
  }
  return data.code === 0;
}

// ============ 每日 20:00 健康日报 ============

async function sendDailyReport(token, lowAlarms) {
  const now = new Date();
  const dateStr = now.toLocaleDateString('zh-CN', { timeZone: 'Asia/Shanghai' });
  const lines = [
    '🌤【安阳天气监控日报】',
    '',
    `📅 ${dateStr}`,
    '✅ 监控服务运行正常',
    '✅ 当前无红色/橙色预警',
  ];
  if (lowAlarms && lowAlarms.length > 0) {
    lines.push('', `ℹ️ 当前生效低级别预警 ${lowAlarms.length} 条:`);
    for (const a of lowAlarms) {
      lines.push(`   • ${a.title}`);
    }
  }
  lines.push('', '🔔 每 10 分钟自动监测，有红/橙预警会第一时间推送。');
  await sendMsg(token, lines.join('\n'));
}

// ============ 天气预警查询 ============

async function checkWeatherAlerts() {
  const resp = await fetch(
    'https://product.weather.com.cn/alarm/grepalarm_cn.php',
    {
      headers: {
        'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7)',
        'Referer': 'https://www.weather.com.cn/',
      },
    }
  );
  const text = await resp.text();
  const match = text.match(/alarminfo\s*=\s*(\{.*\})/);
  if (!match) {
    throw new Error('weather.com.cn 返回格式异常');
  }
  const data = JSON.parse(match[1]);
  const alarms = [];
  if (data.data && Array.isArray(data.data)) {
    for (const item of data.data) {
      const fileId = item[1] || '';
      const title = item[6] || '';

      if (fileId.startsWith('1011802')) {
        let level = '未知';
        if (title.includes('红色')) level = '红色';
        else if (title.includes('橙色')) level = '橙色';
        else if (title.includes('黄色')) level = '黄色';
        else if (title.includes('蓝色')) level = '蓝色';

        // 从 fileId 提取发布时间作为唯一标识
        // 格式: 1011802-20260722203000-5203.html
        const parts = fileId.split('-');
        const publishTime = parts[1] || '';

        alarms.push({
          region: item[0] || '',
          title,
          level,
          publishTime,
          fileId,
        });
      }
    }
  }
  return alarms;
}

// ============ 主函数 ============

async function main() {
  console.log('========================================');
  console.log('安阳市区天气预警监控 v3.1');
  console.log(`时间: ${new Date().toLocaleString('zh-CN', { timeZone: 'Asia/Shanghai' })}`);
  console.log('========================================\n');

  if (!CONFIG.FEISHU_APP_ID || !CONFIG.FEISHU_APP_SECRET || !CONFIG.USER_OPEN_ID) {
    console.error('飞书配置不完整');
    process.exit(1);
  }

  try {
    const token = await getFeishuToken();
    console.log('飞书 token 获取成功 ✅\n');

    // 查询预警
    console.log('正在查询预警信息...');
    const alarms = await checkWeatherAlerts();
    console.log(`安阳报警数量: ${alarms.length}`);

    if (alarms.length > 0) {
      alarms.forEach(a => console.log(`  - ${a.title} | 发布: ${a.publishTime}`));
    }

    // 只关注红色和橙色预警
    const highAlarms = alarms.filter((a) => a.level === '红色' || a.level === '橙色');

    if (highAlarms.length === 0) {
      console.log('✅ 当前无红色/橙色预警');

      // 每日 20:00 发送健康日报（限定 20:00-20:09，避免每 10 分钟重复发送）
      const now = new Date();
      const hour = Number(now.toLocaleString('en-US', { hour: 'numeric', hour12: false, timeZone: 'Asia/Shanghai' }));
      const minute = Number(now.toLocaleString('en-US', { minute: 'numeric', timeZone: 'Asia/Shanghai' }));
      const lowAlarms = alarms.filter((a) => a.level === '黄色' || a.level === '蓝色');
      if (hour === 20 && minute < 10) {
        console.log('每日 20:00 发送日报...');
        await sendDailyReport(token, lowAlarms);
        console.log('日报发送完成 ✅');
      } else {
        console.log('非日报时间，安静跳过');
      }
      return;
    }

    // 去重：只推送未被通知过的新预警（按发布时间区分）
    const notified = loadNotified();
    const newAlarms = highAlarms.filter((a) => !notified[a.publishTime]);

    if (newAlarms.length === 0) {
      console.log('⚠️ 未发现新发布的预警（已有预警已通知过），跳过');
      return;
    }

    console.log(`\n🔴🟠 检测到 ${newAlarms.length} 条新发布红/橙预警，立即推送...`);

    const alertText = newAlarms
      .map((a) => {
        const timeStr = a.publishTime
          ? `${a.publishTime.slice(0,4)}-${a.publishTime.slice(4,6)}-${a.publishTime.slice(6,8)} ${a.publishTime.slice(8,10)}:${a.publishTime.slice(10,12)}`
          : '未知';
        return `• ${a.title}\n  🕐 发布：${timeStr}`;
      })
      .join('\n\n');

    const msg = `🚨【安阳天气预警】🚨\n\n${alertText}\n\n⚠️ 请做好防范准备，注意安全！`;

    await sendMsg(token, msg);
    console.log('预警推送完成 ✅');

    // 记录已通知的预警
    const updated = { ...notified };
    for (const a of newAlarms) {
      updated[a.publishTime] = true;
    }
    saveNotified(updated);

  } catch (err) {
    console.error('\n❌ 执行出错:', err.message);
  }
}

main();
