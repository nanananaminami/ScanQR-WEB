const cloud = require('wx-server-sdk');
cloud.init({ env: cloud.DYNAMIC_CURRENT_ENV });
const db = cloud.database();
const _ = db.command;
const common = require('./common');
const authenticate = common.makeAuth(db, _);

exports.main = async (event, context) => {
  event = common.unwrapHttpEvent(event);
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
    if (new_role_id !== target.role_id && await common.isAdminRole(db, target.role_id)) {
      const adminCountRes = await db.collection('sys_users')
        .where({ role_id: target.role_id, status: 'active' }).count();
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
