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

// 判断某 role_id 是否为「管理员」角色（拥有 user_manage + role_manage 权限）
async function isAdminRole(role_id) {
  const r = await db.collection('sys_roles').where({ role_id }).get();
  const role = r.data[0];
  if (!role || !role.permissions) return false;
  return role.permissions.indexOf('user_manage') !== -1 && role.permissions.indexOf('role_manage') !== -1;
}

exports.main = async (event, context) => {
  const { user_id, real_name, department, role_id, phone, status } = event;
  try {
    const auth = await authenticate(event);
    if (!auth.ok) return { success: false, code: auth.code, msg: auth.msg };
    if (auth.permissions.indexOf('user_manage') === -1) {
      return { success: false, code: 'FORBIDDEN', msg: '无权限：缺少 user_manage 权限' };
    }
    if (!user_id) return { success: false, code: 'INVALID_PARAMS', msg: '缺少用户 ID' };

    const targetRes = await db.collection('sys_users').doc(user_id).get();
    const target = targetRes.data;
    if (!target) return { success: false, code: 'NOT_FOUND', msg: '用户不存在' };

    // 禁止禁用自己
    if (target._id === auth.user._id && status === 'disabled') {
      return { success: false, code: 'SELF_DISABLE', msg: '不能禁用自己的账号' };
    }

    const updateData = { updated_at: db.serverDate() };
    if (real_name !== undefined) updateData.real_name = real_name;
    if (department !== undefined) updateData.department = department;
    if (phone !== undefined) updateData.phone = phone;
    if (role_id !== undefined && role_id !== target.role_id) {
      const roleRes = await db.collection('sys_roles').where({ role_id }).get();
      if (roleRes.data.length === 0) {
        return { success: false, code: 'INVALID_ROLE', msg: '角色不存在' };
      }
      updateData.role_id = role_id;
    }
    if (status !== undefined) {
      if (['active', 'disabled'].indexOf(status) === -1) {
        return { success: false, code: 'INVALID_PARAMS', msg: '状态值非法' };
      }
      updateData.status = status;
    }

    // 最后一名管理员保护：降级或禁用管理员时，至少保留一名在职管理员
    const willLoseAdmin = (updateData.role_id && updateData.role_id !== target.role_id) || status === 'disabled';
    if (willLoseAdmin && await isAdminRole(target.role_id)) {
      const allUsers = await db.collection('sys_users').where({ status: 'active' }).get();
      const adminCount = allUsers.data.filter(u => u.role_id === target.role_id).length;
      if (adminCount <= 1) {
        return { success: false, code: 'LAST_ADMIN', msg: '系统至少需要保留一名在职管理员' };
      }
    }

    await db.collection('sys_users').doc(user_id).update({ data: updateData });

    // 角色变更或禁用时，使该用户所有会话失效（强制重新登录以刷新权限）
    if (updateData.role_id !== undefined || status === 'disabled') {
      await db.collection('sys_sessions').where({ user_id }).remove();
    }

    return { success: true, msg: '已更新' };
  } catch (err) {
    return { success: false, msg: '更新失败', error: err };
  }
};
