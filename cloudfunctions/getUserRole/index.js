const cloud = require('wx-server-sdk');
cloud.init({ env: cloud.DYNAMIC_CURRENT_ENV });
const db = cloud.database();
const _ = db.command;
const common = require('./common');
const authenticate = common.makeAuth(db, _);

// 根据会话令牌返回当前登录用户信息（角色 + 权限）
exports.main = async (event, context) => {
  event = common.unwrapHttpEvent(event);
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
      workstation: auth.user.workstation || [],
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
