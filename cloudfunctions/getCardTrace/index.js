const cloud = require('wx-server-sdk');
cloud.init({ env: cloud.DYNAMIC_CURRENT_ENV });
const db = cloud.database();

exports.main = async (event, context) => {
  const { card_no } = event;
  const wxContext = cloud.getWXContext();

  if (!card_no) {
    return { success: false, code: 'NO_CARD_NO', msg: '缺少流程卡号' };
  }

  try {
    // 权限校验：仅管理员
    const userRes = await db.collection('sys_users').where({ openid: wxContext.OPENID }).get();
    if (userRes.data.length === 0 || userRes.data[0].role !== 'admin') {
      return { success: false, code: 'FORBIDDEN', msg: '无权限：仅管理员可查看追溯' };
    }

    // 获取流程卡数据
    const cardRes = await db.collection('process_cards').where({ card_no }).get();
    const card = cardRes.data[0] || null;

    // 获取该卡所有操作日志（按时间正序）
    const logsRes = await db.collection('process_logs')
      .where({ card_no })
      .orderBy('submit_time', 'asc')
      .limit(100)
      .get();

    return {
      success: true,
      card: card,
      logs: logsRes.data
    };
  } catch (err) {
    return { success: false, msg: '查询失败', error: err };
  }
};
