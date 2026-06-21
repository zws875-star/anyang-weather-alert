// 安阳市区天气监控脚本
// 数据来源: wttr.in (免费，无需API Key)
// 判断异常天气情况，通过飞书推送提醒

import fetch from 'node-fetch';

const CONFIG = {
  FEISHU_APP_ID: process.env.FEISHU_APP_ID || '',
  FEISHU_APP_SECRET: proces…CRET || '',
  USER_OPEN_ID: process.env.FEISHU_USER_OPEN_ID || '',
  TEST_MODE: process.env.TEST_MODE === 'true',
};

// ============ 飞书 API ============

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
  if (data.code !== 0) throw new Error(`飞书 token 失败: ${JSON.stringify(data)}`);
  return data.tenant_access_token;
}

async function sendMsg(token, text) {
  const resp = await fetch('https://open.feishu.cn/open-apis/im/v1/messages?receive_id_type=open_id', {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${token}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      receive_id: CONFIG.USER_OPEN_ID,
      msg_type: 'text',
      content: JSON.stringify({ text }),
    }),
  });
  const data = await resp.json();
  return data.code === 0;
}

async function sendAlert(token, info, count = 1) {
  const msg = `🚨【安阳市区异常天气提醒】🚨\n\n${info}\n\n⚠️ 注意安全！`;
  for (let i = 1; i <= count; i++) {
    await sendMsg(token, `${msg}\n[消息 ${i}/${count}]`);
    if (i < count) await new Promise(r => setTimeout(r, 2000));
  }
}

// ============ 天气查询 ============

async function getWeather() {
  // wttr.in 免费 JSON API
  const url = 'https://wttr.in/Anyang?format=j2&lang=zh';
  const resp = await fetch(url, {
    headers: { 'User-Agent': 'curl/8.0' },
  });
  return await resp.json();
}

/**
 * 从天气预报数据中判断是否有异常/危险天气
 */
function analyzeWeather(data) {
  const warnings = [];
  
  // 当前天气
  const now = data.current_condition?.[0];
  if (now) {
    const temp = parseInt(now.temp_C);
    const feelsLike = parseInt(now.FeelsLikeC);
    const windSpeed = parseInt(now.windspeedKmph);
    const weatherDesc = now.weatherDesc?.[0]?.value || '';
    const humidity = parseInt(now.humidity);
    
    // 高温
    if (temp >= 40) warnings.push(`🔥 极端高温：当前 ${temp}°C，体感 ${feelsLike}°C`);
    else if (temp >= 37) warnings.push(`🌡 高温预警：当前 ${temp}°C，体感 ${feelsLike}°C`);
    
    // 低温
    if (temp <= -15) warnings.push(`🥶 极端低温：当前 ${temp}°C，体感 ${feelsLike}°C`);
    else if (temp <= -10) warnings.push(`❄️ 低温预警：当前 ${temp}°C，体感 ${feelsLike}°C`);
    
    // 大风
    if (windSpeed >= 80) warnings.push(`🌪 极端大风：风速 ${windSpeed} km/h`);
    else if (windSpeed >= 50) warnings.push(`💨 大风预警：风速 ${windSpeed} km/h`);
    
    // 暴雨/恶劣天气
    if (weatherDesc.includes('暴雨') || weatherDesc.includes('大暴雨') || weatherDesc.includes('特大暴雨'))
      warnings.push(`🌧 暴雨：${weatherDesc}`);
    if (weatherDesc.includes('暴雪') || weatherDesc.includes('大暴雪'))
      warnings.push(`❄️ 暴雪：${weatherDesc}`);
    if (weatherDesc.includes('冰雹'))
      warnings.push(`🧊 冰雹：${weatherDesc}`);
    if (weatherDesc.includes('沙尘暴'))
      warnings.push(`🏜 沙尘暴：${weatherDesc}`);
      
    // 高湿度 + 降雨 = 湿冷/湿热
    if (humidity >= 95 && weatherDesc.includes('雨'))
      warnings.push(`💧 高湿度 + 降雨：湿度 ${humidity}%`);
  }
  
  // 未来天气预报
  const forecast = data.weather || [];
  for (const day of forecast) {
    const date = day.date;
    const maxTemp = parseInt(day.maxtempC);
    const minTemp = parseInt(day.mintempC);
    
    // 检查未来是否有极端温度
    if (maxTemp >= 40) warnings.push(`🔥 ${date} 预报最高 ${maxTemp}°C（极端高温）`);
    if (minTemp <= -15) warnings.push(`🥶 ${date} 预报最低 ${minTemp}°C（极端低温）`);
    
    // 检查天文信息
    const uv = parseInt(day.uvIndex);
    if (uv >= 10) warnings.push(`☀️ ${date} UV指数 ${uv}（极高，注意防晒）`);
  }
  
  return warnings;
}

// ============ 主函数 ============

async function main() {
  console.log('========================================');
  console.log('安阳市区天气监控 - 执行');
  console.log(`时间: ${new Date().toLocaleString('zh-CN', { timeZone: 'Asia/Shanghai' })}`);
  console.log('========================================\n');

  if (!CONFIG.FEISHU_APP_ID || !CONFIG.FEISHU_APP_SECRET || !CONFIG.USER_OPEN_ID) {
    console.error('飞书配置不完整');
    process.exit(1);
  }

  const beijingNow = new Date(new Date().toLocaleString('en-US', { timeZone: 'Asia/Shanghai' }));
  const hour = beijingNow.getHours();
  const isTest = CONFIG.TEST_MODE;

  try {
    const token = await getFeishuToken();
    console.log('飞书 token 获取成功\n');

    // 测试模式
    if (isTest) {
      await sendMsg(token, '✅【安阳市区天气监控测试】\n\n脚本运行正常，数据来源 wttr.in（免费）\n每日 20:00 发送日报');
      console.log('测试消息发送完成');
      return;
    }

    // 查询天气
    console.log('正在查询安阳天气...');
    let weatherData;
    try {
      weatherData = await getWeather();
      console.log('天气数据获取成功');
    } catch (err) {
      console.error('天气查询失败:', err.message);
      await sendMsg(token, `⚠️【天气监控异常】\n\n天气数据查询失败：${err.message}`);
      return;
    }

    // 分析异常天气
    const warnings = analyzeWeather(weatherData);
    const currentDesc = weatherData.current_condition?.[0]?.weatherDesc?.[0]?.value || '未知';
    const temp = weatherData.current_condition?.[0]?.temp_C || '?';
    
    console.log(`当前天气: ${currentDesc}, ${temp}°C`);
    console.log(`异常发现: ${warnings.length} 条`);

    if (warnings.length > 0) {
      // 有异常天气，发送提醒
      console.log('⚠️ 发现异常天气，发送提醒...');
      await sendAlert(token, warnings.join('\n'), 3);
      console.log('提醒发送完成');
    } else if (hour === 20) {
      // 每日 20:00 日报（无异常也发）
      const summary = `🌤【安阳市区天气日报】\n\n` +
        `当前：${currentDesc}，${temp}°C\n` +
        `今日状况良好，无异常天气\n\n` +
        `✅ 监控服务运行正常\n` +
        `✅ 下次整点自动检查`;
      await sendMsg(token, summary);
      console.log('日报发送完成');
    } else {
      console.log('✅ 无异常天气，跳过');
    }

  } catch (err) {
    console.error('❌ 执行出错:', err.message);
  }
}

main();
