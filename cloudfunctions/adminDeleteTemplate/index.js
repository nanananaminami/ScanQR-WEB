const cloud = require('wx-server-sdk');
cloud.init({ env: cloud.DYNAMIC_CURRENT_ENV });
const db = cloud.database();
const _ = db.command;
const common = require('./common');
const authenticate = common.makeAuth(db, _);

exports.main = async (event, context) => {
  event = common.unwrapHttpEvent(event);
  const { template_id } = event;
  try {
    const auth = await authenticate(event);
    if (!auth.ok) return { success: false, code: auth.code, msg: auth.msg };
    if (auth.permissions.indexOf('template_manage') === -1) {
      return { success: false, code: 'FORBIDDEN', msg: '无权限：缺少 template_manage 权限' };
    }
    if (!template_id) return { success: false, code: 'INVALID_PARAMS', msg: '缺少模板标识' };

    // 有流程卡引用时禁止删除
    const cardRes = await db.collection('process_cards').where({ template_id }).limit(1).get();
    if (cardRes.data.length > 0) {
      return { success: false, code: 'IN_USE', msg: '有流程卡正在使用该模板，无法删除' };
    }

    await db.collection('process_templates').where({ template_id }).remove();
    return { success: true, msg: '已删除' };
  } catch (err) {
    return { success: false, msg: '删除失败', error: err };
  }
};
