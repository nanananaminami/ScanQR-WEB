const cloud = require('wx-server-sdk');
cloud.init({ env: cloud.DYNAMIC_CURRENT_ENV });
const db = cloud.database();
const _ = db.command;

exports.main = async (event, context) => {
  const { keyword, status, page = 1, pageSize = 20 } = event;
  const wxContext = cloud.getWXContext();

  try {
    // 权限校验：仅管理员
    const userRes = await db.collection('sys_users').where({ openid: wxContext.OPENID }).get();
    if (userRes.data.length === 0 || userRes.data[0].role !== 'admin') {
      return { success: false, code: 'FORBIDDEN', msg: '无权限：仅管理员可查看日志' };
    }

    // 构建查询条件
    const andParts = [];

    if (keyword) {
      andParts.push(_.or([
        { card_no: db.RegExp({ regexp: keyword, options: 'i' }) },
        { operator_name: db.RegExp({ regexp: keyword, options: 'i' }) },
        { step_name: db.RegExp({ regexp: keyword, options: 'i' }) }
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

    // 总数
    const countRes = await db.collection('process_logs').where(whereCond).count();

    // 分页数据
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
