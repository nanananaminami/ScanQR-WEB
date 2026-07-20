const cloud = require('wx-server-sdk');
cloud.init({ env: cloud.DYNAMIC_CURRENT_ENV });
const db = cloud.database();
const _ = db.command;
const common = require('./common');
const authenticate = common.makeAuth(db, _);

exports.main = async (event, context) => {
  event = common.unwrapHttpEvent(event);
  const { dict_id } = event;
  try {
    const auth = await authenticate(event);
    if (!auth.ok) return { success: false, code: auth.code, msg: auth.msg };
    if (auth.permissions.indexOf('template_manage') === -1) {
      return { success: false, code: 'FORBIDDEN', msg: '无权限：缺少 template_manage 权限' };
    }
    if (!dict_id) return { success: false, code: 'INVALID_PARAMS', msg: '缺少字典标识' };

    await db.collection('sys_dicts').where({ dict_id }).remove();
    return { success: true, msg: '已删除' };
  } catch (err) {
    return { success: false, msg: '删除失败', error: err };
  }
};
