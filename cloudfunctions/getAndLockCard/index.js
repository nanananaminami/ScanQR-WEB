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
  const { order_no, user_name } = event;
  try {
    const auth = await authenticate(event);
    if (!auth.ok) return { success: false, code: auth.code, msg: auth.msg };
    if (auth.permissions.indexOf('card_submit') === -1) {
      return { success: false, code: 'FORBIDDEN', msg: '无权限：缺少 card_submit 权限' };
    }

    if (!order_no) {
      return { success: false, code: 'NO_ORDER_NO', msg: '缺少工单号' };
    }

    const operator = user_name || auth.user.real_name || auth.user.username || '未知操作员';
    const operatorUserId = auth.user._id;
    const now = new Date();

    let lockRes = await db.collection('process_cards').where({
      order_no: order_no,
      is_locked: false
    }).update({
      data: {
        is_locked: true,
        locked_by: operator,
        locked_by_user_id: operatorUserId,
        lock_time: now
      }
    });

    if (lockRes.stats.updated === 0) {
      lockRes = await db.collection('process_cards').where({
        order_no: order_no,
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
      const existRes = await db.collection('process_cards').where({ order_no }).get();
      if (existRes.data.length === 0) {
        return { success: false, code: 'NOT_FOUND', msg: '未找到流转卡：' + order_no };
      }
      const holder = existRes.data[0].locked_by || '他人';
      return { success: false, code: 'LOCKED', msg: '该流转卡正由「' + holder + '」编辑中，请稍后再试' };
    }

    const cardRes = await db.collection('process_cards').where({ order_no }).get();
    const cardData = cardRes.data[0];

    let templateData = null;
    if (cardData.template_id) {
      try {
        const tplRes = await db.collection('process_templates').where({ template_id: cardData.template_id }).get();
        if (tplRes.data.length > 0) {
          templateData = tplRes.data[0];

          const allSelectFields = [
            ...(templateData.header_fields || []).filter(f => f.type === 'select' && f.dict_id),
            ...(templateData.detail_fields || []).filter(f => f.type === 'select' && f.dict_id)
          ];
          const dictIds = [...new Set(allSelectFields.map(f => f.dict_id))];
          if (dictIds.length > 0) {
            const dictRes = await db.collection('sys_dicts').where({ dict_id: _.in(dictIds) }).get();
            const dictMap = {};
            dictRes.data.forEach(d => { dictMap[d.dict_id] = d.options || []; });

            const resolveSelects = (fields) => fields.map(f => {
              if (f.type === 'select' && f.dict_id && dictMap[f.dict_id]) {
                return Object.assign({}, f, { options: dictMap[f.dict_id] });
              }
              return f;
            });

            templateData.header_fields = resolveSelects(templateData.header_fields || []);
            templateData.detail_fields = resolveSelects(templateData.detail_fields || []);
          }
        }
      } catch (e) {
        templateData = null;
      }
    }

    return {
      success: true,
      code: 'OK',
      cardData: cardData,
      templateData: templateData,
      operator: operator
    };
  } catch (err) {
    return { success: false, code: 'ERROR', msg: '系统异常', error: err };
  }
};
