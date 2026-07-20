const cloud = require('wx-server-sdk');
cloud.init({ env: cloud.DYNAMIC_CURRENT_ENV });
const db = cloud.database();
const _ = db.command;
const common = require('./common');
const authenticate = common.makeAuth(db, _);

exports.main = async (event, context) => {
  event = common.unwrapHttpEvent(event);
  const { order_no, card_no } = event;
  try {
    const auth = await authenticate(event);
    if (!auth.ok) return { success: false, code: auth.code, msg: auth.msg };
    if (auth.permissions.indexOf('card_trace') === -1) {
      return { success: false, code: 'FORBIDDEN', msg: '无权限：缺少 card_trace 权限' };
    }

    const queryId = order_no || card_no;
    if (!queryId) {
      return { success: false, code: 'NO_CARD_NO', msg: '缺少工单号' };
    }

    let cardRes;
    if (order_no) {
      cardRes = await db.collection('process_cards').where({ order_no }).get();
    } else {
      cardRes = await db.collection('process_cards').where(db.command.or([
        { card_no },
        { order_no: card_no }
      ])).get();
    }
    const card = cardRes.data[0] || null;

    let logsRes;
    if (card) {
      const logConditions = [{ order_no: card.order_no }];
      if (card.card_no) {
        logConditions.push({ card_no: card.card_no });
      }
      if (card.card_no && card.card_no !== card.order_no) {
        logConditions.push({ order_no: card.card_no });
      }
      logsRes = await db.collection('process_logs')
        .where(logConditions.length === 1 ? logConditions[0] : _.or(logConditions))
        .orderBy('submit_time', 'asc')
        .limit(100)
        .get();
    } else {
      logsRes = await db.collection('process_logs')
        .where(db.command.or([
          { order_no: queryId },
          { card_no: queryId }
        ]))
        .orderBy('submit_time', 'asc')
        .limit(100)
        .get();
    }

    return {
      success: true,
      card: card,
      logs: logsRes.data
    };
  } catch (err) {
    return { success: false, msg: '查询失败', error: err };
  }
};
