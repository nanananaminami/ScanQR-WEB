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
  try {
    const auth = await authenticate(event);
    if (!auth.ok) return { success: false, code: auth.code, msg: auth.msg };
    if (auth.permissions.indexOf('dashboard_view') === -1) {
      return { success: false, code: 'FORBIDDEN', msg: '无权限：缺少 dashboard_view 权限' };
    }

    const todayStart = new Date();
    todayStart.setHours(0, 0, 0, 0);

    const [todayLogs, activeCards, lockedCards, todayExceptions, totalLogs] = await Promise.all([
      db.collection('process_logs').where({ submit_time: _.gte(todayStart) }).count(),
      db.collection('process_cards').where({ status: '加工中' }).count(),
      db.collection('process_cards').where({ is_locked: true }).count(),
      db.collection('process_logs').where({ submit_time: _.gte(todayStart), cancelled: true }).count(),
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
