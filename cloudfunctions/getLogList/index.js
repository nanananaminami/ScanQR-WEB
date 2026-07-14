const cloud = require('wx-server-sdk');
cloud.init({ env: cloud.DYNAMIC_CURRENT_ENV });
const db = cloud.database();
const _ = db.command;

async function authenticate(event) {
  const token = event.session_token;
  if (!token) return { ok: false, code: 'NO_TOKEN', msg: '未登录，请先登录' };
  const sessionRes = await db.collection('sys_sessions').where({
    session_token: token,
    expires_at: _.gt(new Date())
  }).get();
  if (sessionRes.data.length === 0) {
    return { ok: false, code: 'SESSION_EXPIRED', msg: '会话已过期，请重新登录' };
  }
  const session = sessionRes.data[0];
  let user = null;
  try {
    const userRes = await db.collection('sys_users').doc(session.user_id).get();
    user = userRes.data;
  } catch (e) {
    return { ok: false, code: 'USER_NOT_FOUND', msg: '用户不存在' };
  }
  if (!user || user.status === 'disabled') {
    return { ok: false, code: 'DISABLED', msg: '账号已被禁用' };
  }
  const roleRes = await db.collection('sys_roles').where({ role_id: user.role_id }).get();
  const role = roleRes.data[0] || null;
  const permissions = (role && role.permissions) || [];
  db.collection('sys_sessions').doc(session._id).update({
    data: { last_active: db.serverDate() }
  }).catch(() => {});
  return { ok: true, user, role, role_id: user.role_id, permissions, session };
}

exports.main = async (event, context) => {
  const { keyword, status, page = 1, pageSize = 20 } = event;
  try {
    const auth = await authenticate(event);
    if (!auth.ok) return { success: false, code: auth.code, msg: auth.msg };
    if (auth.permissions.indexOf('log_view') === -1) {
      return { success: false, code: 'FORBIDDEN', msg: '无权限：缺少 log_view 权限' };
    }

    const andParts = [];

    if (keyword) {
      andParts.push(_.or([
        { card_no: db.RegExp({ regexp: keyword, options: 'i' }) },
        { order_no: db.RegExp({ regexp: keyword, options: 'i' }) },
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
