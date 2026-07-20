const cloud = require('wx-server-sdk');
cloud.init({ env: cloud.DYNAMIC_CURRENT_ENV });
const db = cloud.database();
const _ = db.command;
const common = require('./common');
const authenticate = common.makeAuth(db, _);

exports.main = async (event, context) => {
  event = common.unwrapHttpEvent(event);
  try {
    const auth = await authenticate(event);
    if (!auth.ok) return { success: false, code: auth.code, msg: auth.msg };

    const rolesRes = await db.collection('sys_roles').orderBy('created_at', 'asc').get();
    return { success: true, roles: rolesRes.data };
  } catch (err) {
    return { success: false, msg: '查询失败', error: err };
  }
};
