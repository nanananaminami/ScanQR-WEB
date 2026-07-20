const cloud = require('wx-server-sdk');
cloud.init({ env: cloud.DYNAMIC_CURRENT_ENV });
const db = cloud.database();
const _ = db.command;
const common = require('./common');
const authenticate = common.makeAuth(db, _);

// 新建或更新数据字典
exports.main = async (event, context) => {
  event = common.unwrapHttpEvent(event);
  const { dict_id, dict_name, options, is_new } = event;
  try {
    const auth = await authenticate(event);
    if (!auth.ok) return { success: false, code: auth.code, msg: auth.msg };
    if (auth.permissions.indexOf('template_manage') === -1) {
      return { success: false, code: 'FORBIDDEN', msg: '无权限：缺少 template_manage 权限' };
    }

    if (!dict_id || !dict_name || !Array.isArray(options)) {
      return { success: false, code: 'INVALID_PARAMS', msg: '参数无效' };
    }

    const cleanOptions = options.map(o => String(o).trim()).filter(o => o);
    if (cleanOptions.length === 0) {
      return { success: false, code: 'INVALID_PARAMS', msg: '至少需要一个选项' };
    }

    const existRes = await db.collection('sys_dicts').where({ dict_id }).get();
    if (is_new && existRes.data.length > 0) {
      return { success: false, code: 'DUP_ID', msg: '字典标识已存在' };
    }
    if (!is_new && existRes.data.length === 0) {
      return { success: false, code: 'NOT_FOUND', msg: '字典不存在' };
    }

    if (existRes.data.length > 0) {
      await db.collection('sys_dicts').doc(existRes.data[0]._id).update({
        data: { dict_name, options: cleanOptions, updated_at: db.serverDate() }
      });
      return { success: true, msg: '字典已更新' };
    }

    await db.collection('sys_dicts').add({
      data: { dict_id, dict_name, options: cleanOptions, created_at: db.serverDate() }
    });
    return { success: true, msg: '字典已创建' };
  } catch (err) {
    return { success: false, msg: '保存失败', error: err };
  }
};
