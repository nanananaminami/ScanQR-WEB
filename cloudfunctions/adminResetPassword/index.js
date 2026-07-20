const cloud = require('wx-server-sdk');
const crypto = require('crypto');
cloud.init({ env: cloud.DYNAMIC_CURRENT_ENV });
const db = cloud.database();
const _ = db.command;

const common = require('./common');
const authenticate = common.makeAuth(db, _);

exports.main = async (event, context) => {
  event = common.unwrapHttpEvent(event);
  const { user_id, new_password } = event;
  try {
    const auth = await authenticate(event);
    if (!auth.ok) return { success: false, code: auth.code, msg: auth.msg };
    if (auth.permissions.indexOf('user_manage') === -1) {
      return { success: false, code: 'FORBIDDEN', msg: '无权限：缺少 user_manage 权限' };
    }
    if (!user_id || !new_password || new_password.length < 6) {
      return { success: false, code: 'INVALID_PARAMS', msg: '密码长度至少 6 位' };
    }

    const salt = crypto.randomBytes(16).toString('hex');
    const hash = common.hashPassword(new_password, salt);

    await db.collection('sys_users').doc(user_id).update({
      data: { password_salt: salt, password_hash: hash, updated_at: db.serverDate() }
    });

    // 重置密码后使该用户所有会话失效
    await db.collection('sys_sessions').where({ user_id }).remove();

    return { success: true, msg: '密码已重置' };
  } catch (err) {
    return { success: false, msg: '重置失败', error: err };
  }
};
