const cloud = require('wx-server-sdk');
cloud.init({ env: cloud.DYNAMIC_CURRENT_ENV });
const db = cloud.database();
const _ = db.command;

// 会话鉴权中间件：根据 session_token 解析当前用户、角色与权限
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

// 根据会话令牌返回当前登录用户信息（角色 + 权限）
exports.main = async (event, context) => {
  try {
    const auth = await authenticate(event);
    if (!auth.ok) {
      return { success: false, code: auth.code, msg: auth.msg };
    }
    const safeUser = {
      _id: auth.user._id,
      username: auth.user.username,
      real_name: auth.user.real_name || '',
      department: auth.user.department || '',
      phone: auth.user.phone || '',
      role_id: auth.user.role_id,
      status: auth.user.status,
      created_at: auth.user.created_at,
      last_login: auth.user.last_login
    };
    return {
      success: true,
      user: safeUser,
      role: (auth.role && auth.role.role_name) || auth.user.role_id,
      role_id: auth.user.role_id,
      permissions: auth.permissions
    };
  } catch (err) {
    return { success: false, code: 'ERROR', msg: '获取用户信息失败', error: err };
  }
};
