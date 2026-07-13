const cloud = require('wx-server-sdk');
cloud.init({ env: cloud.DYNAMIC_CURRENT_ENV });
const db = cloud.database();
const _ = db.command;

const LOCK_TIMEOUT_MS = 30 * 60 * 1000;

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
  const { card_no, user_name } = event;
  try {
    const auth = await authenticate(event);
    if (!auth.ok) return { success: false, code: auth.code, msg: auth.msg };
    if (auth.permissions.indexOf('card_submit') === -1) {
      return { success: false, code: 'FORBIDDEN', msg: '无权限：缺少 card_submit 权限' };
    }

    if (!card_no) {
      return { success: false, code: 'NO_CARD_NO', msg: '缺少流程卡号' };
    }

    const operator = user_name || auth.user.real_name || auth.user.username || '未知操作员';
    const operatorUserId = auth.user._id;
    const now = new Date();

    // 第一步：原子上锁
    let lockRes = await db.collection('process_cards').where({
      card_no: card_no,
      is_locked: false
    }).update({
      data: {
        is_locked: true,
        locked_by: operator,
        locked_by_user_id: operatorUserId,
        lock_time: now
      }
    });

    // 第二步：抢占超时锁
    if (lockRes.stats.updated === 0) {
      lockRes = await db.collection('process_cards').where({
        card_no: card_no,
        is_locked: true,
        lock_time: _.lt(new Date(now.getTime() - LOCK_TIMEOUT_MS))
      }).update({
        data: {
          is_locked: true,
          locked_by: operator,
          locked_by_user_id: operatorUserId,
          lock_time: now
        }
      });
    }

    if (lockRes.stats.updated === 0) {
      const existRes = await db.collection('process_cards').where({ card_no }).get();
      if (existRes.data.length === 0) {
        return { success: false, code: 'NOT_FOUND', msg: '未找到流程卡：' + card_no };
      }
      const holder = existRes.data[0].locked_by || '他人';
      return { success: false, code: 'LOCKED', msg: '该流程卡正由「' + holder + '」编辑中，请稍后再试' };
    }

    const cardRes = await db.collection('process_cards').where({ card_no }).get();
    const targetCard = cardRes.data[0];

    let templateData = null;
    if (targetCard.template_id) {
      try {
        const tplRes = await db.collection('process_templates').doc(targetCard.template_id).get();
        templateData = tplRes.data;
      } catch (e) {
        templateData = null;
      }
    }

    return {
      success: true,
      code: 'OK',
      cardData: targetCard,
      templateData: templateData,
      operator: operator
    };
  } catch (err) {
    return { success: false, code: 'ERROR', msg: '系统异常', error: err };
  }
};
