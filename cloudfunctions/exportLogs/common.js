const crypto = require('crypto');

function makeAuth(db, _) {
  return async function authenticate(event) {
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
  };
}

function hashPassword(password, salt) {
  return crypto.pbkdf2Sync(password, salt, 100000, 64, 'sha512').toString('hex');
}

function generateSalt() {
  return crypto.randomBytes(16).toString('hex');
}

function escapeRegex(str) {
  return String(str || '').replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function formatWaitTime(minutes) {
  if (minutes >= 1440) {
    const days = Math.floor(minutes / 1440);
    const hours = Math.floor((minutes % 1440) / 60);
    return hours > 0 ? days + '天' + hours + '小时' : days + '天';
  }
  if (minutes >= 60) {
    return Math.floor(minutes / 60) + '小时' + (minutes % 60) + '分钟';
  }
  return minutes + '分钟';
}

function calcSlaMinutes(prevCompletedAt) {
  if (!prevCompletedAt) return null;
  const prev = new Date(prevCompletedAt);
  if (isNaN(prev.getTime())) return null;
  return Math.floor((new Date().getTime() - prev.getTime()) / 60000);
}

async function isAdminRole(db, role_id) {
  const r = await db.collection('sys_roles').where({ role_id }).get();
  const role = r.data[0];
  if (!role || !role.permissions) return false;
  return role.permissions.indexOf('user_manage') !== -1 && role.permissions.indexOf('role_manage') !== -1;
}

// HTTP 访问时 event.body 是 JSON 字符串，需要解包
function unwrapHttpEvent(event) {
  if (event && typeof event.body === 'string') {
    try { return JSON.parse(event.body); } catch (_) {}
  }
  return event;
}

module.exports = { makeAuth, hashPassword, generateSalt, escapeRegex, formatWaitTime, calcSlaMinutes, isAdminRole, unwrapHttpEvent };
