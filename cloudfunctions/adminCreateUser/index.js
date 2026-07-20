const cloud = require('wx-server-sdk');
const crypto = require('crypto');
cloud.init({ env: cloud.DYNAMIC_CURRENT_ENV });
const db = cloud.database();
const _ = db.command;

const common = require('./common');
const authenticate = common.makeAuth(db, _);

exports.main = async (event, context) => {
  event = common.unwrapHttpEvent(event);
  const { username, password, real_name, department, role_id, phone, workstation } = event;
  try {
    const auth = await authenticate(event);
    if (!auth.ok) return { success: false, code: auth.code, msg: auth.msg };
    if (auth.permissions.indexOf('user_manage') === -1) {
      return { success: false, code: 'FORBIDDEN', msg: '无权限：缺少 user_manage 权限' };
    }

    if (!username || !password || !role_id) {
      return { success: false, code: 'INVALID_PARAMS', msg: '账号、密码、角色为必填项' };
    }
    if (password.length < 6) {
      return { success: false, code: 'INVALID_PARAMS', msg: '密码长度至少 6 位' };
    }

    // 账号唯一性校验
    const exist = await db.collection('sys_users').where({ username }).get();
    if (exist.data.length > 0) {
      return { success: false, code: 'DUP_USERNAME', msg: '账号已存在' };
    }

    // 角色合法性
    const roleRes = await db.collection('sys_roles').where({ role_id }).get();
    if (roleRes.data.length === 0) {
      return { success: false, code: 'INVALID_ROLE', msg: '角色不存在' };
    }

    const salt = crypto.randomBytes(16).toString('hex');
    const hash = common.hashPassword(password, salt);

    const newUser = {
      username,
      password_salt: salt,
      password_hash: hash,
      role_id,
      real_name: real_name || '',
      department: department || '',
      phone: phone || '',
      workstation: Array.isArray(workstation) ? workstation.filter(s => s) : (workstation ? [workstation] : []),
      status: 'active',
      created_at: db.serverDate(),
      last_login: null
    };

    const addRes = await db.collection('sys_users').add({ data: newUser });
    return { success: true, msg: '用户创建成功', user_id: addRes._id };
  } catch (err) {
    return { success: false, msg: '创建失败', error: err };
  }
};
