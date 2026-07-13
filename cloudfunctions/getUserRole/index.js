const cloud = require('wx-server-sdk');
cloud.init({ env: cloud.DYNAMIC_CURRENT_ENV });
const db = cloud.database();

exports.main = async (event, context) => {
  const wxContext = cloud.getWXContext();
  const openid = wxContext.OPENID;

  if (!openid) {
    return { success: false, code: 'NO_OPENID', msg: '无法获取用户身份' };
  }

  try {
    // 查询用户是否已存在
    const userRes = await db.collection('sys_users').where({ openid }).get();

    if (userRes.data.length > 0) {
      const user = userRes.data[0];
      if (user.role === 'disabled') {
        return { success: false, code: 'DISABLED', msg: '账号已被禁用，请联系管理员' };
      }
      // 更新最后登录时间
      await db.collection('sys_users').doc(user._id).update({
        data: { last_login: db.serverDate() }
      });
      return { success: true, role: user.role, user: user };
    }

    // 新用户：自动注册。首任用户自动成为管理员（bootstrap 机制）
    const countRes = await db.collection('sys_users').count();
    const isFirstUser = countRes.total === 0;

    const newUser = {
      openid: openid,
      name: isFirstUser ? '系统管理员' : '新员工' + openid.slice(-4),
      role: isFirstUser ? 'admin' : 'operator',
      phone: '',
      status: 'active',
      created_at: db.serverDate(),
      last_login: db.serverDate()
    };

    const addRes = await db.collection('sys_users').add({ data: newUser });
    newUser._id = addRes._id;

    return {
      success: true,
      role: newUser.role,
      user: newUser,
      is_new_user: true,
      is_first_admin: isFirstUser
    };
  } catch (err) {
    return { success: false, code: 'ERROR', msg: '获取用户信息失败', error: err };
  }
};
