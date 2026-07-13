const cloud = require('wx-server-sdk');
cloud.init({ env: cloud.DYNAMIC_CURRENT_ENV });
const db = cloud.database();

exports.main = async (event, context) => {
  const wxContext = cloud.getWXContext();

  try {
    // 权限校验：仅管理员
    const userRes = await db.collection('sys_users').where({ openid: wxContext.OPENID }).get();
    if (userRes.data.length === 0 || userRes.data[0].role !== 'admin') {
      return { success: false, code: 'FORBIDDEN', msg: '无权限：仅管理员可管理用户' };
    }

    const dataRes = await db.collection('sys_users')
      .orderBy('created_at', 'desc')
      .limit(100)
      .get();

    return { success: true, users: dataRes.data };
  } catch (err) {
    return { success: false, msg: '查询失败', error: err };
  }
};
