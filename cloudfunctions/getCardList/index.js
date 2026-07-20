const cloud = require('wx-server-sdk');
cloud.init({ env: cloud.DYNAMIC_CURRENT_ENV });
const db = cloud.database();
const _ = db.command;
const common = require('./common');
const authenticate = common.makeAuth(db, _);

exports.main = async (event) => {
  event = common.unwrapHttpEvent(event);
  const { status } = event;
  try {
    const auth = await authenticate(event);
    if (!auth.ok) return { success: false, code: auth.code, msg: auth.msg };
    if (auth.permissions.indexOf('card_list') === -1) {
      return { success: false, code: 'FORBIDDEN', msg: '无权限' };
    }

    const where = {};
    if (status && ['加工中', '已完工', '已作废'].includes(status)) {
      where.status = status;
    }

    const res = await db.collection('process_cards')
      .where(where)
      .orderBy('created_at', 'desc')
      .limit(200)
      .get();

    return { success: true, cards: res.data };
  } catch (err) {
    return { success: false, msg: '查询失败', error: err };
  }
};
