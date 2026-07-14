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

// 从模板直接生成流程卡（建卡）
exports.main = async (event, context) => {
  const { card_no, prod_name, template_id } = event;
  try {
    const auth = await authenticate(event);
    if (!auth.ok) return { success: false, code: auth.code, msg: auth.msg };
    if (auth.permissions.indexOf('card_list') === -1) {
      return { success: false, code: 'FORBIDDEN', msg: '无权限：缺少 card_list 权限' };
    }

    if (!card_no || !prod_name || !template_id) {
      return { success: false, code: 'INVALID_PARAMS', msg: '卡号、产品名、模板为必填' };
    }

    // 卡号唯一性校验
    const exist = await db.collection('process_cards').where({ card_no }).get();
    if (exist.data.length > 0) {
      return { success: false, code: 'DUP_CARD_NO', msg: '卡号已存在：' + card_no };
    }

    // 模板合法性 + 取工段名作为初始 current_step
    const tplRes = await db.collection('process_templates').where({ template_id }).get();
    if (tplRes.data.length === 0) {
      return { success: false, code: 'NOT_FOUND', msg: '模板不存在' };
    }
    const step_name = tplRes.data[0].step_name || '';

    const addRes = await db.collection('process_cards').add({
      data: {
        card_no,
        prod_name,
        current_step: step_name,
        template_id,
        status: '加工中',
        is_locked: false,
        locked_by: '',
        locked_by_user_id: '',
        lock_time: null,
        created_at: db.serverDate(),
        created_by: auth.user.username
      }
    });

    return {
      success: true,
      msg: '流程卡已创建',
      card_id: addRes._id,
      card_no,
      step_name
    };
  } catch (err) {
    return { success: false, msg: '创建失败', error: err };
  }
};
