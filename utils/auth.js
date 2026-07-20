// 前端统一鉴权工具：会话缓存、权限判断、带 token 的云函数 HTTP 调用封装
const SESSION_KEY = 'auth_session';
const CLOUD_BASE = 'https://cloud1-d3gtr9e3m940ddbfb-1453011694.ap-shanghai.app.tcloudbase.com/api';

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

// HTTP 直调云函数：自动注入 session_token，会话失效时自动跳登录
function callCloud(name, data) {
  const token = getToken();
  const payload = Object.assign({}, data || {}, { session_token: token });
  return new Promise((resolve, reject) => {
    wx.request({
      url: CLOUD_BASE + '/' + name,
      method: 'POST',
      header: { 'Content-Type': 'application/json' },
      data: payload,
      success: (res) => {
        const result = res.data || {};
        if (result.code === 'NO_TOKEN' || result.code === 'SESSION_EXPIRED' || result.code === 'DISABLED' || result.code === 'USER_NOT_FOUND') {
          clearSession();
          wx.reLaunch({ url: '/pages/login/login' });
          reject(new Error(result.msg || '登录已失效'));
          return;
        }
        // 兼容旧格式：调用方使用 res.result 取值
        resolve({ result: result });
      },
      fail: (err) => {
        reject(err);
      }
    });
  });
}

function logout() {
  const token = getToken();
  if (token) {
    wx.request({
      url: CLOUD_BASE + '/logout',
      method: 'POST',
      header: { 'Content-Type': 'application/json' },
      data: { session_token: token }
    }).catch(() => {});
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
  callWithAuth: callCloud,
  logout
};
