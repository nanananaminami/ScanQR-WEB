const cloud = require('wx-server-sdk');
cloud.init({ env: cloud.DYNAMIC_CURRENT_ENV });
const db = cloud.database();
const _ = db.command;

exports.main = async (event, context) => {
  const wxContext = cloud.getWXContext();

  try {
    // 权限校验：仅管理员可查看
    const userRes = await db.collection('sys_users').where({ openid: wxContext.OPENID }).get();
    if (userRes.data.length === 0 || userRes.data[0].role !== 'admin') {
      return { success: false, code: 'FORBIDDEN', msg: '无权限：仅管理员可查看看板' };
    }

    // 今日零点
    const todayStart = new Date();
    todayStart.setHours(0, 0, 0, 0);

    const [todayLogs, activeCards, lockedCards, todayExceptions, totalLogs] = await Promise.all([
      // 今日扫码量（今日提交的报工日志数）
      db.collection('process_logs').where({ submit_time: _.gte(todayStart) }).count(),
      // 在制卡片数
      db.collection('process_cards').where({ status: '加工中' }).count(),
      // 锁定中卡片数
      db.collection('process_cards').where({ is_locked: true }).count(),
      // 今日异常提报数（今日放弃的日志数）
      db.collection('process_logs').where({ submit_time: _.gte(todayStart), cancelled: true }).count(),
      // 总报工数
      db.collection('process_logs').count()
    ]);

    return {
      success: true,
      stats: {
        todayScans: todayLogs.total,
        activeCards: activeCards.total,
        lockedCards: lockedCards.total,
        todayExceptions: todayExceptions.total,
        totalLogs: totalLogs.total
      }
    };
  } catch (err) {
    return { success: false, msg: '统计失败', error: err };
  }
};
