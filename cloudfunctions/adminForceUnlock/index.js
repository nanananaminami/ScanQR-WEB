const cloud = require('wx-server-sdk');
cloud.init({ env: cloud.DYNAMIC_CURRENT_ENV });
const db = cloud.database();
const _ = db.command;
const common = require('./common');
const authenticate = common.makeAuth(db, _);

exports.main = async (event, context) => {
  event = common.unwrapHttpEvent(event);
  const { card_id, user_name } = event;
  try {
    const auth = await authenticate(event);
    if (!auth.ok) return { success: false, code: auth.code, msg: auth.msg };
    if (auth.permissions.indexOf('card_unlock') === -1) {
      return { success: false, code: 'FORBIDDEN', msg: '无权限：缺少 card_unlock 权限' };
    }

    if (!card_id) {
      return { success: false, code: 'NO_CARD_ID', msg: '缺少卡片ID' };
    }

    const adminName = user_name || auth.user.real_name || auth.user.username || '管理员';

    const cardRes = await db.collection('process_cards').doc(card_id).get();
    const card = cardRes.data;

    await db.collection('process_cards').doc(card_id).update({
      data: {
        is_locked: false,
        locked_by: '',
        locked_by_user_id: '',
        lock_time: null,
        last_updated: db.serverDate()
      }
    });

    await db.collection('process_logs').add({
      data: {
        order_no: card.order_no || '',
        card_no: card.card_no || card.order_no || '',
        card_id: card_id,
        operator_name: adminName,
        operator_user_id: auth.user._id,
        operator_username: auth.user.username,
        step_name: '',
        form_data: {},
        cancelled: true,
        is_force_unlock: true,
        submit_time: db.serverDate()
      }
    });

    return { success: true, msg: '已强制解锁', order_no: card.order_no || card.card_no };
  } catch (err) {
    return { success: false, msg: '解锁失败', error: err };
  }
};
