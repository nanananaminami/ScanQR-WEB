const cloud = require('wx-server-sdk');
cloud.init({ env: cloud.DYNAMIC_CURRENT_ENV });
const db = cloud.database();
const _ = db.command;
const common = require('./common');
const authenticate = common.makeAuth(db, _);

exports.main = async (event, context) => {
  event = common.unwrapHttpEvent(event);
  const { user_id, real_name, department, role_id, phone, status, workstation } = event;
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
    if (workstation !== undefined) {
      updateData.workstation = Array.isArray(workstation) ? workstation.filter(s => s) : (workstation ? [workstation] : []);
    }
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
    if (willLoseAdmin && await common.isAdminRole(db, target.role_id)) {
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
