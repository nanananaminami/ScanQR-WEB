const cloud = require('wx-server-sdk');
const crypto = require('crypto');
cloud.init({ env: cloud.DYNAMIC_CURRENT_ENV });
const db = cloud.database();
const _ = db.command;

function hashPassword(password, salt) {
  return crypto.pbkdf2Sync(password, salt, 100000, 64, 'sha512').toString('hex');
}

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
  const { username, password, real_name, department, role_id, phone } = event;
  try {
    const auth = await authenticate(event);
    if (!auth.ok) return { success: false, code: auth.code, msg: auth.msg };
    if (auth.permissions.indexOf('user_manage') === -1) {
      return { success: false, code: 'FORBIDDEN', msg: '无权限：缺少 user_manage 权限' };
    }

    if (!username || !password || !role_id) {
      return { success: false, code: 'INVALID_PARAMS', msg: '账号、密码、角色为必填项' };
    }
    if (password.length < 6) {
      return { success: false, code: 'INVALID_PARAMS', msg: '密码长度至少 6 位' };
    }

    // 账号唯一性校验
    const exist = await db.collection('sys_users').where({ username }).get();
    if (exist.data.length > 0) {
      return { success: false, code: 'DUP_USERNAME', msg: '账号已存在' };
    }

    // 角色合法性
    const roleRes = await db.collection('sys_roles').where({ role_id }).get();
    if (roleRes.data.length === 0) {
      return { success: false, code: 'INVALID_ROLE', msg: '角色不存在' };
    }

    const salt = crypto.randomBytes(16).toString('hex');
    const hash = hashPassword(password, salt);

    const newUser = {
      username,
      password_salt: salt,
      password_hash: hash,
      role_id,
      real_name: real_name || '',
      department: department || '',
      phone: phone || '',
      status: 'active',
      created_at: db.serverDate(),
      last_login: null
    };

    const addRes = await db.collection('sys_users').add({ data: newUser });
    return { success: true, msg: '用户创建成功', user_id: addRes._id };
  } catch (err) {
    return { success: false, msg: '创建失败', error: err };
  }
};
