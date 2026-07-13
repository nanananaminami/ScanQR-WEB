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
  const { role_id, role_name, permissions, description, is_new } = event;
  try {
    const auth = await authenticate(event);
    if (!auth.ok) return { success: false, code: auth.code, msg: auth.msg };
    if (auth.permissions.indexOf('role_manage') === -1) {
      return { success: false, code: 'FORBIDDEN', msg: '无权限：缺少 role_manage 权限' };
    }

    if (!role_id || !role_name || !Array.isArray(permissions)) {
      return { success: false, code: 'INVALID_PARAMS', msg: '参数无效' };
    }

    const existRes = await db.collection('sys_roles').where({ role_id }).get();
    if (is_new && existRes.data.length > 0) {
      return { success: false, code: 'DUP_ROLE', msg: '角色标识已存在' };
    }
    if (!is_new && existRes.data.length === 0) {
      return { success: false, code: 'NOT_FOUND', msg: '角色不存在' };
    }

    if (existRes.data.length > 0) {
      const existing = existRes.data[0];
      if (existing.is_system) {
        // 系统内置角色：仅允许更新权限与描述，不允许改名/删除
        await db.collection('sys_roles').doc(existing._id).update({
          data: {
            permissions: permissions,
            description: description !== undefined ? description : existing.description,
            updated_at: db.serverDate()
          }
        });
        return { success: true, msg: '系统角色权限已更新' };
      }
      await db.collection('sys_roles').doc(existing._id).update({
        data: {
          role_name: role_name,
          permissions: permissions,
          description: description || '',
          updated_at: db.serverDate()
        }
      });
      return { success: true, msg: '角色已更新' };
    }

    await db.collection('sys_roles').add({
      data: {
        role_id,
        role_name,
        permissions,
        description: description || '',
        is_system: false,
        created_at: db.serverDate()
      }
    });
    return { success: true, msg: '角色已创建' };
  } catch (err) {
    return { success: false, msg: '保存失败', error: err };
  }
};
