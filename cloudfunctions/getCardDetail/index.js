const cloud = require('wx-server-sdk');
cloud.init({ env: cloud.DYNAMIC_CURRENT_ENV });
const db = cloud.database();
const _ = db.command;
const common = require('./common');
const authenticate = common.makeAuth(db, _);

exports.main = async (event) => {
  event = common.unwrapHttpEvent(event);
  const { order_no } = event;
  try {
    const auth = await authenticate(event);
    if (!auth.ok) return { success: false, code: auth.code, msg: auth.msg };

    const cardRes = await db.collection('process_cards').where({ order_no }).get();
    if (cardRes.data.length === 0) {
      return { success: false, code: 'NOT_FOUND', msg: '流转卡不存在' };
    }

    const card = cardRes.data[0];
    let template = null;
    if (card.template_id) {
      const tplRes = await db.collection('process_templates').where({ template_id: card.template_id }).get();
      template = tplRes.data[0] || null;
    }

    return { success: true, card, template };
  } catch (err) {
    return { success: false, msg: '查询失败', error: err };
  }
};
