// 安阳市区天气预警监控 v2.2
// 数据来源：中国气象局 CMA / 国家气象中心 NMC 多源轮换
// 新增：明确支持高温红/橙预警检测 + 预警变化时才发送（避免重复打扰）

const CONFIG = {
  FEISHU_APP_ID: process.env.FEISHU_APP_ID || '',
  FEISHU_APP_SECRET: process.env.FEISHU_APP_SECRET || '',
  USER_OPEN_ID: process.env.FEISHU_USER_OPEN_ID || '',
  TEST_MODE: process.env.TEST_MODE === 'true',
  ANYANG_STATION_ID: '53898',
  ANYANG_CITY_CODE: '101180201',  // weather.com.cn 城市代码
};

// ============ 状态持久化（避免同一预警重复发送） ============
import fs from 'fs';

function getAlarmSignature(alarms) {
  return alarms
    .map((a) => `${a.title}|${a.signallevel}`)
    .sort()
    .join('||');
}

function loadLastSignature() {
  try {
    return fs.readFileSync('/tmp/last_anyang_alarms.json', 'utf8').trim();
  } catch {
    return '';
  }
}

function saveLastSignature(sig) {
  try {
    fs.writeFileSync('/tmp/last_anyang_alarms.json', sig);
  } catch (e) {
    console.error('保存预警状态失败:', e.message);
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

async function sendAlerts(token, alerts, count = 1) {
  const msg = `🚨【安阳市区高级别气象预警提醒】🚨\n\n${alerts}\n\n⚠️ 请做好防范准备，注意安全！`;
  for (let i = 1; i <= count; i++) {
    await sendMsg(token, `${msg}\n[消息 ${i}/${count}]`);
    if (i < count) await new Promise((r) => setTimeout(r, 2000));
  }
}

async function sendHealthCheck(token) {
  const msg = `🌤【安阳市区天气监控日报】\n\n今日一切正常，当前无红色/橙色预警。\n\n✅ 监控服务运行正常\n✅ 下次检查时间：明日整点\n\n如果天气有变，我会第一时间通知你。`;
  await sendMsg(token, msg);
}

// ============ 多源天气预警查询 ============

// 源1: CMA API（原版快速，但可能被屏蔽）
async function checkCMA() {
  const url = `https://weather.cma.cn/api/now/${CONFIG.ANYANG_STATION_ID}`;
  const resp = await fetch(url, {
    headers: {
      'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7)',
      'Accept': 'application/json',
    },
  });
  if (!resp.ok) {
    throw new Error(`CMA HTTP ${resp.status}`);
  }
  const data = await resp.json();
  if (data.code !== 0) {
    throw new Error(`CMA API 返回错误: ${JSON.stringify(data)}`);
  }
  return { alarms: data.data?.alarm || [], weather: data.data?.now || {} };
}

// 源2: NMC 全国预警页面（HTML 静态页，稳定可靠）
async function checkNMC() {
  const resp = await fetch('https://www.nmc.cn/publish/alarm/henan.html', {
    headers: { 'User-Agent': 'Mozilla/5.0' },
  });
  const html = await resp.text();

  // 用正则从 HTML 中提取安阳相关的预警
  const alarms = [];
  const lines = html.split('\n');
  let currentAlarm = null;

  for (const line of lines) {
    // 找预警标题
    if (line.includes('安阳') && (line.includes('预警') || line.includes('信号'))) {
      if (currentAlarm) alarms.push(currentAlarm);
      currentAlarm = { title: '', level: '', raw: line };
      // 提取级别
      const clean = line.replace(/<[^>]+>/g, '').trim();
      currentAlarm.title = clean;
      if (clean.includes('红色')) currentAlarm.level = '红色';
      else if (clean.includes('橙色')) currentAlarm.level = '橙色';
      else if (clean.includes('黄色')) currentAlarm.level = '黄色';
      else if (clean.includes('蓝色')) currentAlarm.level = '蓝色';
    }
  }
  if (currentAlarm) alarms.push(currentAlarm);

  return { alarms };
}

// 源3: weather.com.cn 页面
async function checkWeatherCN() {
  const resp = await fetch(`https://www.weather.com.cn/alarm/alarm_list.shtml`, {
    headers: { 'User-Agent': 'Mozilla/5.0' },
  });
  const html = await resp.text();
  const alarms = [];
  if (html.includes('安阳') && (html.includes('红色') || html.includes('橙色'))) {
    alarms.push({ title: 'weather.com.cn 检测到安阳地区高级别预警', level: '橙色' });
  }
  return { alarms };
}

async function checkWeatherAlerts() {
  let lastError = null;

  // 依次尝试各数据源
  const sources = [
    { name: 'CMA', fn: checkCMA },
    { name: 'NMC', fn: checkNMC },
    { name: 'weather.com.cn', fn: checkWeatherCN },
  ];

  for (const source of sources) {
    try {
      console.log(`尝试数据源: ${source.name}...`);
      const result = await source.fn();
      if (result.alarms && result.alarms.length > 0) {
        console.log(`${source.name}: 找到 ${result.alarms.length} 条预警`);
        // NMC 可能返回 HTML 解析的数据，标准化格式
        return result.alarms.map(a => ({
          title: a.title || a.title || '天气预警',
          signallevel: a.level || a.signallevel || '未知',
          effective: a.effective || a.time || '未知',
        }));
      }
      // 没预警但数据源正常，返回空
      console.log(`${source.name}: 无预警`);
      return [];
    } catch (err) {
      lastError = err;
      console.log(`${source.name} 不可用: ${err.message}`);
      continue;
    }
  }

  // 所有源都失败，记录日志但不再发送错误通知
  console.error(`所有数据源均不可用，最后错误: ${lastError?.message}`);
  return null; // 表示数据获取失败
}

// ============ 主函数 ============

async function main() {
  console.log('========================================');
  console.log('安阳市区天气预警监控 v2.0');
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
        '✅【安阳市区天气预警监控测试 v2.0】\n\n脚本运行正常！\n\n📡 数据来源：多源轮换（CMA / NMC / weather.com.cn）\n🕐 检查频率：每小时\n📍 监控范围：安阳市区\n🔴🟠 关注级别：红色预警、橙色预警\n📢 发现预警：发送 1 次\n\n测试成功 ✅'
      );
      console.log('测试消息发送完成');
      return;
    }

    // 多源查询预警
    console.log('正在查询预警信息（多源轮换）...');
    const alarms = await checkWeatherAlerts();

    // 数据源全部不可用 -> 安静退出，不报错
    if (alarms === null) {
      console.log('⚠️ 所有数据源暂时不可用，跳过本次检查');
      return;
    }

    console.log(`安阳预警数: ${alarms.length}`);
    if (alarms.length > 0) {
      alarms.forEach(a => console.log(`  - ${a.title} (${a.signallevel})`));
    }

    // 只关注红色和橙色预警（含高温红/橙）
    const highAlarms = alarms.filter((a) => {
      const level = (a.signallevel || a.severity || '').toLowerCase();
      const title = (a.title || '').toLowerCase();
      const isHighLevel = level.includes('红') || level === 'red' || level === 'orange' || level.includes('橙');
      const isHighTemp = title.includes('高温');
      return isHighLevel || isHighTemp;
    });

    const currentSig = getAlarmSignature(highAlarms);
    const lastSig = loadLastSignature();

    if (highAlarms.length > 0) {
      if (currentSig !== lastSig) {
        console.log('\n🔴🟠 发现新的或升级的高级别预警！发送提醒...');
        const alertText = highAlarms
          .map((a) => `• ${a.title}\n  ⏰ 生效时间：${a.effective || '未知'}`)
          .join('\n\n');
        await sendAlerts(token, alertText, 1);
        saveLastSignature(currentSig);
        console.log('预警提醒发送完成 ✅');
      } else {
        console.log('⚠️ 相同预警已通知过，本次跳过重复发送（避免打扰）');
      }
    } else {
      // 无预警时清空状态
      if (lastSig) saveLastSignature('');
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
    // 不往外发错误通知，安静失败
  }
}

main();
