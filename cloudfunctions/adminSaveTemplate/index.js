const cloud = require('wx-server-sdk');
cloud.init({ env: cloud.DYNAMIC_CURRENT_ENV });
const db = cloud.database();
const _ = db.command;
const common = require('./common');
const authenticate = common.makeAuth(db, _);

function cleanField(f) {
  const clean = {
    field_name: f.field_name,
    label: f.label,
    type: f.type || 'input',
    required: !!f.required,
    sort: f.sort || 0,
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
    clean.auto_now = f.auto_now !== undefined ? f.auto_now : true;
  }
  return clean;
}

function cleanDetailField(f) {
  const clean = {
    field_name: f.field_name,
    label: f.label,
    type: f.type || 'input',
    required: !!f.required,
    sort: f.sort || 0,
    width: f.width || 150,
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
    clean.auto_now = f.auto_now !== undefined ? f.auto_now : true;
  }
  return clean;
}

function validateFields(fields, isDetail) {
  const seenNames = {};
  for (let i = 0; i < fields.length; i++) {
    const f = fields[i];
    if (!f.field_name || !f.label || !f.type) {
      return '第' + (i + 1) + '个字段缺少变量名/标签/类型';
    }
    if (!/^[a-zA-Z_][a-zA-Z0-9_]*$/.test(f.field_name)) {
      return '变量名只能含字母数字下划线且不以数字开头：' + f.field_name;
    }
    if (seenNames[f.field_name]) {
      return '变量名重复：' + f.field_name;
    }
    seenNames[f.field_name] = true;
    if (!isDetail && f.type === 'select' && !f.dict_id && (!Array.isArray(f.options) || f.options.length === 0)) {
      return f.label + ' 需配置选项或绑定字典';
    }
    if (isDetail && f.type === 'select' && !f.dict_id && (!Array.isArray(f.options) || f.options.length === 0)) {
      return f.label + ' 需配置选项或绑定字典';
    }
  }
  return null;
}

exports.main = async (event, context) => {
  event = common.unwrapHttpEvent(event);
  const { template_id, template_name, header_fields, detail_fields, is_new } = event;
  try {
    const auth = await authenticate(event);
    if (!auth.ok) return { success: false, code: auth.code, msg: auth.msg };
    if (auth.permissions.indexOf('template_manage') === -1) {
      return { success: false, code: 'FORBIDDEN', msg: '无权限：缺少 template_manage 权限' };
    }

    if (!template_name || !Array.isArray(header_fields) || !Array.isArray(detail_fields)) {
      return { success: false, code: 'INVALID_PARAMS', msg: '模板名、表头字段、明细字段为必填' };
    }

    const headerErr = validateFields(header_fields, false);
    if (headerErr) return { success: false, code: 'INVALID_PARAMS', msg: '表头字段：' + headerErr };

    const detailErr = validateFields(detail_fields, true);
    if (detailErr) return { success: false, code: 'INVALID_PARAMS', msg: '明细字段：' + detailErr };

    const cleanHeader = header_fields.map(cleanField);
    const cleanDetail = detail_fields.map(cleanDetailField);

    const existRes = await db.collection('process_templates').where({ template_id }).get();

    if (is_new && existRes.data.length > 0) {
      return { success: false, code: 'DUP_ID', msg: '模板标识已存在' };
    }
    if (!is_new && existRes.data.length === 0) {
      return { success: false, code: 'NOT_FOUND', msg: '模板不存在' };
    }

    const docData = {
      template_id,
      template_name,
      header_fields: cleanHeader,
      detail_fields: cleanDetail,
      updated_at: db.serverDate()
    };

    if (existRes.data.length > 0) {
      await db.collection('process_templates').doc(existRes.data[0]._id).update({ data: docData });
      return { success: true, msg: '模板已更新' };
    }

    docData.created_at = db.serverDate();
    docData.created_by = auth.user.username;
    await db.collection('process_templates').add({ data: docData });
    return { success: true, msg: '模板已创建', template_id };
  } catch (err) {
    return { success: false, msg: '保存失败', error: err };
  }
};
