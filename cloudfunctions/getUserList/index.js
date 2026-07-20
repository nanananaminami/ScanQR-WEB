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
    if (auth.permissions.indexOf('user_manage') === -1) {
      return { success: false, code: 'FORBIDDEN', msg: '无权限：缺少 user_manage 权限' };
    }

    const [usersRes, rolesRes] = await Promise.all([
      db.collection('sys_users').orderBy('created_at', 'desc').limit(100).get(),
      db.collection('sys_roles').get()
    ]);
    const roleMap = {};
    rolesRes.data.forEach(r => { roleMap[r.role_id] = r; });

    const users = usersRes.data.map(u => ({
      _id: u._id,
      username: u.username,
      real_name: u.real_name || '',
      department: u.department || '',
      phone: u.phone || '',
      role_id: u.role_id,
      role_name: (roleMap[u.role_id] && roleMap[u.role_id].role_name) || u.role_id,
      workstation: u.workstation || [],
      status: u.status,
      created_at: u.created_at,
      last_login: u.last_login
    }));

    return { success: true, users: users };
  } catch (err) {
    return { success: false, msg: '查询失败', error: err };
  }
};
