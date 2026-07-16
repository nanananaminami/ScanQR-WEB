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
    if (auth.permissions.indexOf('user_manage') === -1) {
      return { success: false, code: 'FORBIDDEN', msg: '无权限：缺少 user_manage 权限' };
    }

    const [usersRes, rolesRes] = await Promise.all([
      db.collection('sys_users').orderBy('created_at', 'desc').limit(100).get(),
      db.collection('sys_roles').get()
    ]);
    const roleMap = {};
    rolesRes.data.forEach(r => { roleMap[r.role_id] = r; });

    const users = usersRes.data.map(u => ({
      _id: u._id,
      username: u.username,
      real_name: u.real_name || '',
      department: u.department || '',
      phone: u.phone || '',
      role_id: u.role_id,
      role_name: (roleMap[u.role_id] && roleMap[u.role_id].role_name) || u.role_id,
      workstation: u.workstation || [],
      status: u.status,
      created_at: u.created_at,
      last_login: u.last_login
    }));

    return { success: true, users: users };
  } catch (err) {
    return { success: false, msg: '查询失败', error: err };
  }
};
