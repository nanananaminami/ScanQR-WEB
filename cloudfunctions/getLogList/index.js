const cloud = require('wx-server-sdk');
cloud.init({ env: cloud.DYNAMIC_CURRENT_ENV });
const db = cloud.database();
const _ = db.command;
const common = require('./common');
const authenticate = common.makeAuth(db, _);

exports.main = async (event, context) => {
  event = common.unwrapHttpEvent(event);
  const { keyword, status, page = 1, pageSize = 20 } = event;
  try {
    const auth = await authenticate(event);
    if (!auth.ok) return { success: false, code: auth.code, msg: auth.msg };
    if (auth.permissions.indexOf('log_view') === -1) {
      return { success: false, code: 'FORBIDDEN', msg: '无权限：缺少 log_view 权限' };
    }

    const andParts = [];

    if (keyword) {
      const safe = common.escapeRegex(keyword);
      andParts.push(_.or([
        { card_no: db.RegExp({ regexp: safe, options: 'i' }) },
        { order_no: db.RegExp({ regexp: safe, options: 'i' }) },
        { operator_name: db.RegExp({ regexp: safe, options: 'i' }) },
        { step_name: db.RegExp({ regexp: safe, options: 'i' }) }
      ]));
    }

    if (status === 'normal') {
      andParts.push({ cancelled: false });
    } else if (status === 'cancelled') {
      andParts.push({ cancelled: true, is_force_unlock: _.neq(true) });
    } else if (status === 'force_unlock') {
      andParts.push({ is_force_unlock: true });
    }

    const whereCond = andParts.length === 0 ? {}
      : andParts.length === 1 ? andParts[0]
      : _.and(andParts);

    const countRes = await db.collection('process_logs').where(whereCond).count();

    const skip = (page - 1) * pageSize;
    const dataRes = await db.collection('process_logs')
      .where(whereCond)
      .orderBy('submit_time', 'desc')
      .skip(skip)
      .limit(pageSize)
      .get();

    return {
      success: true,
      logs: dataRes.data,
      total: countRes.total,
      page: page,
      hasMore: skip + dataRes.data.length < countRes.total
    };
  } catch (err) {
    return { success: false, msg: '查询失败', error: err };
  }
};
