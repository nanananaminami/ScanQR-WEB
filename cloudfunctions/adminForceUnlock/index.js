const cloud = require('wx-server-sdk');
cloud.init({ env: cloud.DYNAMIC_CURRENT_ENV });
const db = cloud.database();

exports.main = async (event, context) => {
  const { card_id, user_name } = event;
  const wxContext = cloud.getWXContext();

  if (!card_id) {
    return { success: false, code: 'NO_CARD_ID', msg: '缺少卡片ID' };
  }

  try {
    // 权限校验：仅管理员可强制解锁
    const userRes = await db.collection('sys_users').where({ openid: wxContext.OPENID }).get();
    if (userRes.data.length === 0 || userRes.data[0].role !== 'admin') {
      return { success: false, code: 'FORBIDDEN', msg: '无权限：仅管理员可强制解锁' };
    }

    const adminName = user_name || userRes.data[0].name || '管理员';

    // 拉取卡片信息用于日志
    const cardRes = await db.collection('process_cards').doc(card_id).get();
    const card = cardRes.data;

    // 强制解锁
    await db.collection('process_cards').doc(card_id).update({
      data: {
        is_locked: false,
        locked_by: '',
        lock_time: null,
        last_updated: db.serverDate()
      }
    });

    // 留痕：写入操作日志
    await db.collection('process_logs').add({
      data: {
        card_no: card.card_no,
        card_id: card_id,
        operator_name: adminName,
        operator_openid: wxContext.OPENID,
        step_name: card.current_step || '',
        form_data: {},
        cancelled: true,
        is_force_unlock: true,
        submit_time: db.serverDate()
      }
    });

    return { success: true, msg: '已强制解锁', card_no: card.card_no };
  } catch (err) {
    return { success: false, msg: '解锁失败', error: err };
  }
};
