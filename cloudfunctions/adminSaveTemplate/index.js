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

// 清洗字段配置：去除与类型无关的冗余属性
function cleanField(f) {
  const clean = {
    field_name: f.field_name,
    label: f.label,
    type: f.type,
    required: !!f.required,
    unit: f.unit || '',
    placeholder: f.placeholder || '',
    default: f.default || ''
  };
  if (f.type === 'select') {
    if (f.dict_id) {
      clean.dict_id = f.dict_id;
      clean.options = [];
    } else {
      clean.options = Array.isArray(f.options) ? f.options.filter(o => o) : [];
      clean.dict_id = '';
    }
  }
  if (f.type === 'datetime') {
    clean.auto_now = true;
  }
  return clean;
}

// 新建或更新流程卡模板（低代码配置保存）
exports.main = async (event, context) => {
  const { template_id, template_name, step_name, fields, is_new } = event;
  try {
    const auth = await authenticate(event);
    if (!auth.ok) return { success: false, code: auth.code, msg: auth.msg };
    if (auth.permissions.indexOf('template_manage') === -1) {
      return { success: false, code: 'FORBIDDEN', msg: '无权限：缺少 template_manage 权限' };
    }

    if (!template_name || !step_name || !Array.isArray(fields)) {
      return { success: false, code: 'INVALID_PARAMS', msg: '模板名、工段、字段列表为必填' };
    }

    // 字段合法性校验
    const seenNames = {};
    for (let i = 0; i < fields.length; i++) {
      const f = fields[i];
      if (!f.field_name || !f.label || !f.type) {
        return { success: false, code: 'INVALID_PARAMS', msg: '第' + (i + 1) + '个字段缺少变量名/标签/类型' };
      }
      if (!/^[a-zA-Z_][a-zA-Z0-9_]*$/.test(f.field_name)) {
        return { success: false, code: 'INVALID_PARAMS', msg: '变量名只能含字母数字下划线且不以数字开头：' + f.field_name };
      }
      if (seenNames[f.field_name]) {
        return { success: false, code: 'INVALID_PARAMS', msg: '变量名重复：' + f.field_name };
      }
      seenNames[f.field_name] = true;
      if (f.type === 'select' && !f.dict_id && (!Array.isArray(f.options) || f.options.length === 0)) {
        return { success: false, code: 'INVALID_PARAMS', msg: f.label + ' 需配置选项或绑定字典' };
      }
    }

    const cleanFields = fields.map(cleanField);
    const existRes = await db.collection('process_templates').where({ template_id }).get();

    if (is_new && existRes.data.length > 0) {
      return { success: false, code: 'DUP_ID', msg: '模板标识已存在' };
    }
    if (!is_new && existRes.data.length === 0) {
      return { success: false, code: 'NOT_FOUND', msg: '模板不存在' };
    }

    if (existRes.data.length > 0) {
      await db.collection('process_templates').doc(existRes.data[0]._id).update({
        data: {
          template_name,
          step_name,
          fields: cleanFields,
          updated_at: db.serverDate()
        }
      });
      return { success: true, msg: '模板已更新' };
    }

    await db.collection('process_templates').add({
      data: {
        template_id,
        template_name,
        step_name,
        fields: cleanFields,
        created_at: db.serverDate(),
        updated_at: db.serverDate(),
        created_by: auth.user.username
      }
    });
    return { success: true, msg: '模板已创建', template_id: template_id };
  } catch (err) {
    return { success: false, msg: '保存失败', error: err };
  }
};
