// 前端统一鉴权工具：会话缓存、权限判断、带 token 的云函数调用封装
const SESSION_KEY = 'auth_session';

function getSession() {
  return wx.getStorageSync(SESSION_KEY) || null;
}

function getToken() {
  const s = getSession();
  return s ? s.session_token : '';
}

function setSession(session) {
  wx.setStorageSync(SESSION_KEY, session);
  const app = getApp();
  if (app) {
    app.globalData.user = session.user;
    app.globalData.role = session.role;
    app.globalData.roleId = session.role_id;
    app.globalData.permissions = session.permissions || [];
    app.globalData.roleReady = true;
  }
}

function clearSession() {
  wx.removeStorageSync(SESSION_KEY);
  const app = getApp();
  if (app) {
    app.globalData.user = null;
    app.globalData.role = null;
    app.globalData.roleId = null;
    app.globalData.permissions = [];
    app.globalData.roleReady = true;
  }
}

function hasPerm(perm) {
  const app = getApp();
  const perms = (app && app.globalData.permissions) || [];
  return perms.indexOf(perm) !== -1;
}

function requireLogin() {
  if (!getToken()) {
    wx.reLaunch({ url: '/pages/login/login' });
    return false;
  }
  return true;
}

// 封装 callFunction：自动注入 session_token，会话失效时自动跳登录
function callWithAuth(name, data) {
  const token = getToken();
  const payload = Object.assign({}, data || {}, { session_token: token });
  return wx.cloud.callFunction({ name, data: payload }).then((res) => {
    const result = res.result || {};
    if (result.code === 'NO_TOKEN' || result.code === 'SESSION_EXPIRED' || result.code === 'DISABLED' || result.code === 'USER_NOT_FOUND') {
      clearSession();
      wx.reLaunch({ url: '/pages/login/login' });
      throw new Error(result.msg || '登录已失效');
    }
    return res;
  });
}

function logout() {
  const token = getToken();
  if (token) {
    wx.cloud.callFunction({ name: 'logout', data: { session_token: token } }).catch(() => {});
  }
  clearSession();
  wx.reLaunch({ url: '/pages/login/login' });
}

module.exports = {
  SESSION_KEY,
  getSession,
  getToken,
  setSession,
  clearSession,
  hasPerm,
  requireLogin,
  callWithAuth,
  logout
};
