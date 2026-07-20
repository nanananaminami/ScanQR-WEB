const cloud = require('wx-server-sdk');
cloud.init({ env: cloud.DYNAMIC_CURRENT_ENV });
const db = cloud.database();
const _ = db.command;
const common = require('./common');
const authenticate = common.makeAuth(db, _);

const VALID_STATUS = ['加工中', '已完工', '已作废'];

// 流程卡状态流转：完工 / 作废 / 恢复加工
exports.main = async (event, context) => {
  event = common.unwrapHttpEvent(event);
  const { card_id, new_status } = event;
  try {
    const auth = await authenticate(event);
    if (!auth.ok) return { success: false, code: auth.code, msg: auth.msg };
    if (auth.permissions.indexOf('card_list') === -1) {
      return { success: false, code: 'FORBIDDEN', msg: '无权限：缺少 card_list 权限' };
    }

    if (!card_id || VALID_STATUS.indexOf(new_status) === -1) {
      return { success: false, code: 'INVALID_PARAMS', msg: '参数无效' };
    }

    const cardRes = await db.collection('process_cards').doc(card_id).get();
    const card = cardRes.data;
    if (!card) return { success: false, code: 'NOT_FOUND', msg: '流程卡不存在' };

    const updateData = {
      status: new_status,
      last_updated: db.serverDate(),
      updated_by: auth.user.username
    };

    // 离开「加工中」时释放可能存在的锁，避免孤立锁
    if (new_status !== '加工中' && card.is_locked) {
      updateData.is_locked = false;
      updateData.locked_by = '';
      updateData.locked_by_user_id = '';
      updateData.lock_time = null;
    }

    await db.collection('process_cards').doc(card_id).update({ data: updateData });

    return { success: true, msg: '状态已更新为：' + new_status };
  } catch (err) {
    return { success: false, msg: '更新失败', error: err };
  }
};
