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

// 获取全部数据字典（下拉选项库）
exports.main = async (event, context) => {
  try {
    const auth = await authenticate(event);
    if (!auth.ok) return { success: false, code: auth.code, msg: auth.msg };

    const res = await db.collection('sys_dicts').orderBy('created_at', 'asc').limit(100).get();
    return { success: true, dicts: res.data };
  } catch (err) {
    return { success: false, msg: '查询失败', error: err };
  }
};
