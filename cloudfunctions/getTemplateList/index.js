const cloud = require('wx-server-sdk');
cloud.init({ env: cloud.DYNAMIC_CURRENT_ENV });
const db = cloud.database();
const _ = db.command;
const common = require('./common');
const authenticate = common.makeAuth(db, _);

// 获取全部流程卡模板列表
exports.main = async (event, context) => {
  event = common.unwrapHttpEvent(event);
  try {
    const auth = await authenticate(event);
    if (!auth.ok) return { success: false, code: auth.code, msg: auth.msg };

    const res = await db.collection('process_templates').orderBy('created_at', 'desc').limit(100).get();
    return { success: true, templates: res.data };
  } catch (err) {
    return { success: false, msg: '查询失败', error: err };
  }
};
