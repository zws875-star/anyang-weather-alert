// 安阳市区天气预警监控 v3.0
// 单数据源：weather.com.cn product API
// 每10分钟检测，发现红/橙预警立即发送（不去重）

const CONFIG = {
  FEISHU_APP_ID: process.env.FEISHU_APP_ID || '',
  FEISHU_APP_SECRET: process.env.FEISHU_APP_SECRET || '',
  USER_OPEN_ID: process.env.FEISHU_USER_OPEN_ID || '',
  ANYANG_CITY_CODE: '1011802', // 安阳市（含市区及所辖县）
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
  if (data.code !== 0) {
    console.error('飞书发送失败:', data.msg);
  }
  return data.code === 0;
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
  // 返回格式: var alarminfo={"count":"...","data":[[...],...]}
  const match = text.match(/alarminfo\s*=\s*(\{.*\})/);
  if (!match) {
    throw new Error('weather.com.cn 返回格式异常');
  }
  const data = JSON.parse(match[1]);
  const alarms = [];
  if (data.data && Array.isArray(data.data)) {
    for (const item of data.data) {
      // item = [地区名称, 文件ID, lng, lat, ..., 发布单位ID, 更新ID, 预警标题]
      const regionName = item[0] || '';
      const fileId = item[1] || '';
      const title = item[6] || '';

      // 匹配安阳市（code 1011802 开头）
      if (fileId.startsWith('1011802')) {
        let level = '未知';
        if (title.includes('红色')) level = '红色';
        else if (title.includes('橙色')) level = '橙色';
        else if (title.includes('黄色')) level = '黄色';
        else if (title.includes('蓝色')) level = '蓝色';

        alarms.push({
          region: regionName,
          title: title,
          level: level,
          effective: fileId.split('-')[1] || '未知',
          type: title.includes('暴雨') ? '暴雨' :
                title.includes('雷暴大风') ? '雷暴大风' :
                title.includes('雷雨大风') ? '雷雨大风' :
                title.includes('冰雹') ? '冰雹' :
                title.includes('强对流') ? '强对流' :
                title.includes('高温') ? '高温' :
                title.includes('台风') ? '台风' :
                title.includes('雷电') ? '雷电' : '其他',
        });
      }
    }
  }
  return alarms;
}

// ============ 主函数 ============

async function main() {
  console.log('========================================');
  console.log('安阳市区天气预警监控 v3.0');
  console.log(`时间: ${new Date().toLocaleString('zh-CN', { timeZone: 'Asia/Shanghai' })}`);
  console.log('========================================\n');

  if (!CONFIG.FEISHU_APP_ID || !CONFIG.FEISHU_APP_SECRET || !CONFIG.USER_OPEN_ID) {
    console.error('飞书配置不完整');
    process.exit(1);
  }

  try {
    const token = await getFeishuToken();
    console.log('飞书 token 获取成功 ✅\n');

    if (process.env.TEST_MODE === 'true') {
      await sendMsg(
        token,
        '✅【安阳市区天气预警监控 v3.0】\n\n脚本运行正常！\n\n📡 数据来源：weather.com.cn\n🕐 检查频率：每 10 分钟\n📍 监控范围：安阳市（含所辖县）\n🔴🟠 关注级别：红色预警、橙色预警\n📢 有预警即立即推送给您\n\n测试成功 ✅'
      );
      console.log('测试消息发送完成');
      return;
    }

    // 查询预警
    console.log('正在查询预警信息...');
    const alarms = await checkWeatherAlerts();
    console.log(`安阳报警数量: ${alarms.length}`);

    if (alarms.length > 0) {
      alarms.forEach(a => console.log(`  - ${a.title} (${a.level})`));
    }

    // 只关注红色和橙色预警
    const highAlarms = alarms.filter((a) => a.level === '红色' || a.level === '橙色');

    if (highAlarms.length > 0) {
      console.log(`\n🔴🟠 检测到 ${highAlarms.length} 条红/橙预警，立即推送...`);

      const alertText = highAlarms
        .map((a) => `• ${a.title}\n  🕐 发布：${a.effective || '未知'}`)
        .join('\n\n');

      const msg = `🚨【安阳天气预警】🚨\n\n${alertText}\n\n⚠️ 请做好防范准备，注意安全！\n\n🕐 检测时间：${new Date().toLocaleString('zh-CN', { timeZone: 'Asia/Shanghai' })}`;

      await sendMsg(token, msg);
      console.log('预警推送完成 ✅');
    } else {
      console.log('✅ 当前无红色/橙色预警');
    }
  } catch (err) {
    console.error('\n❌ 执行出错:', err.message);
  }
}

main();
