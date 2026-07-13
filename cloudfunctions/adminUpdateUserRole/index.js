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
  const { target_user_id, new_role_id } = event;
  try {
    const auth = await authenticate(event);
    if (!auth.ok) return { success: false, code: auth.code, msg: auth.msg };
    if (auth.permissions.indexOf('user_manage') === -1) {
      return { success: false, code: 'FORBIDDEN', msg: '无权限：缺少 user_manage 权限' };
    }

    if (!target_user_id || !new_role_id) {
      return { success: false, code: 'INVALID_PARAMS', msg: '参数无效' };
    }

    const roleRes = await db.collection('sys_roles').where({ role_id: new_role_id }).get();
    if (roleRes.data.length === 0) {
      return { success: false, code: 'INVALID_ROLE', msg: '角色不存在' };
    }

    const targetRes = await db.collection('sys_users').doc(target_user_id).get();
    const target = targetRes.data;
    if (!target) return { success: false, code: 'NOT_FOUND', msg: '用户不存在' };

    // 最后一名管理员保护
    if (target.role_id === 'admin' && new_role_id !== 'admin') {
      const adminCountRes = await db.collection('sys_users').where({ role_id: 'admin', status: 'active' }).count();
      if (adminCountRes.total <= 1) {
        return { success: false, code: 'LAST_ADMIN', msg: '系统至少需要保留一名在职管理员' };
      }
    }

    await db.collection('sys_users').doc(target_user_id).update({
      data: { role_id: new_role_id, updated_at: db.serverDate() }
    });

    // 角色变更后使该用户所有会话失效（强制重新登录以刷新权限）
    await db.collection('sys_sessions').where({ user_id: target_user_id }).remove();

    return { success: true, msg: '角色已更新为：' + roleRes.data[0].role_name };
  } catch (err) {
    return { success: false, msg: '更新失败', error: err };
  }
};
