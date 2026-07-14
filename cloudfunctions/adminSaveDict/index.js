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

// 新建或更新数据字典
exports.main = async (event, context) => {
  const { dict_id, dict_name, options, is_new } = event;
  try {
    const auth = await authenticate(event);
    if (!auth.ok) return { success: false, code: auth.code, msg: auth.msg };
    if (auth.permissions.indexOf('template_manage') === -1) {
      return { success: false, code: 'FORBIDDEN', msg: '无权限：缺少 template_manage 权限' };
    }

    if (!dict_id || !dict_name || !Array.isArray(options)) {
      return { success: false, code: 'INVALID_PARAMS', msg: '参数无效' };
    }

    const cleanOptions = options.map(o => String(o).trim()).filter(o => o);
    if (cleanOptions.length === 0) {
      return { success: false, code: 'INVALID_PARAMS', msg: '至少需要一个选项' };
    }

    const existRes = await db.collection('sys_dicts').where({ dict_id }).get();
    if (is_new && existRes.data.length > 0) {
      return { success: false, code: 'DUP_ID', msg: '字典标识已存在' };
    }
    if (!is_new && existRes.data.length === 0) {
      return { success: false, code: 'NOT_FOUND', msg: '字典不存在' };
    }

    if (existRes.data.length > 0) {
      await db.collection('sys_dicts').doc(existRes.data[0]._id).update({
        data: { dict_name, options: cleanOptions, updated_at: db.serverDate() }
      });
      return { success: true, msg: '字典已更新' };
    }

    await db.collection('sys_dicts').add({
      data: { dict_id, dict_name, options: cleanOptions, created_at: db.serverDate() }
    });
    return { success: true, msg: '字典已创建' };
  } catch (err) {
    return { success: false, msg: '保存失败', error: err };
  }
};
