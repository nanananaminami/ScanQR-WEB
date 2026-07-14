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

const VALID_STATUS = ['加工中', '已完工', '已作废'];

// 流程卡状态流转：完工 / 作废 / 恢复加工
exports.main = async (event, context) => {
  const { card_id, new_status } = event;
  try {
    const auth = await authenticate(event);
    if (!auth.ok) return { success: false, code: auth.code, msg: auth.msg };
    if (auth.permissions.indexOf('card_list') === -1) {
      return { success: false, code: 'FORBIDDEN', msg: '无权限：缺少 card_list 权限' };
    }

    if (!card_id || VALID_STATUS.indexOf(new_status) === -1) {
      return { success: false, code: 'INVALID_PARAMS', msg: '参数无效' };
    }

    const cardRes = await db.collection('process_cards').doc(card_id).get();
    const card = cardRes.data;
    if (!card) return { success: false, code: 'NOT_FOUND', msg: '流程卡不存在' };

    const updateData = {
      status: new_status,
      last_updated: db.serverDate(),
      updated_by: auth.user.username
    };

    // 离开「加工中」时释放可能存在的锁，避免孤立锁
    if (new_status !== '加工中' && card.is_locked) {
      updateData.is_locked = false;
      updateData.locked_by = '';
      updateData.locked_by_user_id = '';
      updateData.lock_time = null;
    }

    await db.collection('process_cards').doc(card_id).update({ data: updateData });

    return { success: true, msg: '状态已更新为：' + new_status };
  } catch (err) {
    return { success: false, msg: '更新失败', error: err };
  }
};
