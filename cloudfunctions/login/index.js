const cloud = require('wx-server-sdk');
const crypto = require('crypto');
cloud.init({ env: cloud.DYNAMIC_CURRENT_ENV });
const db = cloud.database();

const SESSION_TTL_HOURS = 24 * 7; // 7 天

function hashPassword(password, salt) {
  return crypto.pbkdf2Sync(password, salt, 100000, 64, 'sha512').toString('hex');
}

function verifyPassword(password, salt, hash) {
  if (!salt || !hash) return false;
  return hashPassword(password, salt) === hash;
}

function genToken() {
  return crypto.randomBytes(32).toString('hex');
}

exports.main = async (event, context) => {
  const { username, password } = event;
  if (!username || !password) {
    return { success: false, code: 'INVALID_PARAMS', msg: '请输入账号和密码' };
  }

  try {
    const userRes = await db.collection('sys_users').where({ username }).get();
    if (userRes.data.length === 0) {
      return { success: false, code: 'USER_NOT_FOUND', msg: '账号或密码错误' };
    }
    const user = userRes.data[0];

    if (user.status === 'disabled') {
      return { success: false, code: 'DISABLED', msg: '账号已被禁用，请联系管理员' };
    }

    if (!verifyPassword(password, user.password_salt, user.password_hash)) {
      return { success: false, code: 'WRONG_PASSWORD', msg: '账号或密码错误' };
    }

    // 拉取角色与权限
    const roleRes = await db.collection('sys_roles').where({ role_id: user.role_id }).get();
    const role = roleRes.data[0] || null;
    const permissions = (role && role.permissions) || [];
    const roleName = (role && role.role_name) || user.role_id;

    // 创建会话
    const now = new Date();
    const expires = new Date(now.getTime() + SESSION_TTL_HOURS * 3600 * 1000);
    const token = genToken();

    // 限制单用户最多 5 个会话，超出则清理最早的
    const oldSessions = await db.collection('sys_sessions').where({ user_id: user._id }).orderBy('created_at', 'asc').get();
    if (oldSessions.data.length >= 5) {
      const toRemove = oldSessions.data.slice(0, oldSessions.data.length - 4);
      for (const s of toRemove) {
        await db.collection('sys_sessions').doc(s._id).remove();
      }
    }

    await db.collection('sys_sessions').add({
      data: {
        session_token: token,
        user_id: user._id,
        username: user.username,
        created_at: db.serverDate(),
        expires_at: expires,
        last_active: db.serverDate()
      }
    });

    // 更新最后登录时间
    await db.collection('sys_users').doc(user._id).update({
      data: { last_login: db.serverDate() }
    });

    const safeUser = {
      _id: user._id,
      username: user.username,
      real_name: user.real_name || '',
      department: user.department || '',
      phone: user.phone || '',
      role_id: user.role_id,
      status: user.status,
      created_at: user.created_at,
      last_login: user.last_login
    };

    return {
      success: true,
      session_token: token,
      user: safeUser,
      role: roleName,
      role_id: user.role_id,
      permissions: permissions,
      expires_at: expires
    };
  } catch (err) {
    return { success: false, code: 'ERROR', msg: '登录失败', error: err };
  }
};
