const cloud = require('wx-server-sdk');
cloud.init({ env: cloud.DYNAMIC_CURRENT_ENV });
const db = cloud.database();
const _ = db.command;
const common = require('./common');
const authenticate = common.makeAuth(db, _);

// 获取全部数据字典（下拉选项库）
exports.main = async (event, context) => {
  event = common.unwrapHttpEvent(event);
  try {
    const auth = await authenticate(event);
    if (!auth.ok) return { success: false, code: auth.code, msg: auth.msg };

    const res = await db.collection('sys_dicts').orderBy('created_at', 'asc').limit(100).get();
    return { success: true, dicts: res.data };
  } catch (err) {
    return { success: false, msg: '查询失败', error: err };
  }
};
