const cloud = require('wx-server-sdk');
cloud.init({ env: cloud.DYNAMIC_CURRENT_ENV });
const db = cloud.database();

const VALID_ROLES = ['admin', 'operator', 'disabled'];

exports.main = async (event, context) => {
  const { target_openid, new_role } = event;
  const wxContext = cloud.getWXContext();

  if (!target_openid || !VALID_ROLES.includes(new_role)) {
    return { success: false, code: 'INVALID_PARAMS', msg: '参数无效' };
  }

  try {
    // 权限校验：仅管理员
    const callerRes = await db.collection('sys_users').where({ openid: wxContext.OPENID }).get();
    if (callerRes.data.length === 0 || callerRes.data[0].role !== 'admin') {
      return { success: false, code: 'FORBIDDEN', msg: '无权限：仅管理员可修改角色' };
    }

    // 禁止降级自己（避免锁死）
    if (target_openid === wxContext.OPENID && new_role !== 'admin') {
      return { success: false, code: 'SELF_DEMOTE', msg: '不能降级自己的管理员权限' };
    }

    // 降级管理员时，确保至少保留一名管理员
    if (new_role !== 'admin') {
      const targetRes = await db.collection('sys_users').where({ openid: target_openid }).get();
      if (targetRes.data.length > 0 && targetRes.data[0].role === 'admin') {
        const adminCountRes = await db.collection('sys_users').where({ role: 'admin' }).count();
        if (adminCountRes.total <= 1) {
          return { success: false, code: 'LAST_ADMIN', msg: '系统至少需要保留一名管理员' };
        }
      }
    }

    await db.collection('sys_users').where({ openid: target_openid }).update({
      data: { role: new_role, updated_at: db.serverDate() }
    });

    return { success: true, msg: '角色已更新为：' + ({ admin: '管理员', operator: '操作员', disabled: '已禁用' }[new_role]) };
  } catch (err) {
    return { success: false, msg: '更新失败', error: err };
  }
};
