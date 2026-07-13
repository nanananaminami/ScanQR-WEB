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
  const { card_no, card_id, form_data, step_name, user_name, cancelled } = event;
  try {
    const auth = await authenticate(event);
    if (!auth.ok) return { success: false, code: auth.code, msg: auth.msg };
    if (auth.permissions.indexOf('card_submit') === -1) {
      return { success: false, code: 'FORBIDDEN', msg: '无权限：缺少 card_submit 权限' };
    }

    const operator = user_name || auth.user.real_name || auth.user.username || '未知操作员';

    // 1. 写入操作日志
    await db.collection('process_logs').add({
      data: {
        card_no: card_no,
        card_id: card_id || '',
        operator_name: operator,
        operator_user_id: auth.user._id,
        operator_username: auth.user.username,
        step_name: step_name || '',
        form_data: form_data || {},
        cancelled: !!cancelled,
        submit_time: db.serverDate()
      }
    });

    // 2. 解锁流程卡 + 可选状态推进
    const updateData = {
      is_locked: false,
      locked_by: '',
      locked_by_user_id: '',
      lock_time: null,
      last_updated: db.serverDate()
    };

    if (!cancelled && form_data) {
      if (form_data.status) {
        updateData.status = form_data.status;
      }
    }

    const updateRes = await db.collection('process_cards').doc(card_id).update({
      data: updateData
    });

    return {
      success: true,
      updated: updateRes.stats.updated,
      log_written: true
    };
  } catch (err) {
    return { success: false, msg: '提交失败', error: err };
  }
};
