const auth = require('../../utils/auth');

const CLOUD_BASE = 'https://cloud1-d3gtr9e3m940ddbfb-1453011694.ap-shanghai.app.tcloudbase.com/api';

function callCloud(name, data, noAuth) {
  return new Promise((resolve, reject) => {
    wx.request({
      url: CLOUD_BASE + '/' + name,
      method: 'POST',
      header: { 'Content-Type': 'application/json' },
      data: data || {},
      success: (res) => {
        resolve({ result: res.data || {} });
      },
      fail: reject
    });
  });
}

Page({
  data: {
    username: '',
    password: '',
    loading: false,
    showSeedHint: false
  },

  onLoad() {
    const session = auth.getSession();
    if (session && session.session_token) {
      this.tryRestoreSession(session);
    } else {
      this.setData({ showSeedHint: true });
    }
  },

  tryRestoreSession(session) {
    wx.showLoading({ title: '登录中...', mask: true });
    callCloud('getUserRole', { session_token: session.session_token })
      .then((res) => {
        wx.hideLoading();
        const result = res.result || {};
        if (result.success) {
          auth.setSession(Object.assign({}, session, {
            user: result.user,
            role: result.role,
            role_id: result.role_id,
            permissions: result.permissions
          }));
          this.redirectAfterLogin();
        } else {
          auth.clearSession();
          this.setData({ showSeedHint: true });
        }
      }).catch(() => {
        wx.hideLoading();
        auth.clearSession();
        this.setData({ showSeedHint: true });
      });
  },

  onUsernameChange(e) {
    this.setData({ username: e.detail.value || '' });
  },

  onPasswordChange(e) {
    this.setData({ password: e.detail.value || '' });
  },

  doLogin() {
    const { username, password, loading } = this.data;
    if (loading) return;
    if (!username || !password) {
      wx.showToast({ title: '请输入账号和密码', icon: 'none' });
      return;
    }
    this.setData({ loading: true });
    wx.showLoading({ title: '登录中...', mask: true });
    callCloud('login', { username: username.trim(), password: password })
      .then((res) => {
        wx.hideLoading();
        this.setData({ loading: false });
        const result = res.result || {};
        if (result.success) {
          auth.setSession({
            session_token: result.session_token,
            user: result.user,
            role: result.role,
            role_id: result.role_id,
            permissions: result.permissions
          });
          wx.showToast({ title: '登录成功', icon: 'success' });
          setTimeout(() => this.redirectAfterLogin(), 400);
        } else {
          wx.showModal({ title: '登录失败', content: result.msg || '请重试', showCancel: false });
        }
      }).catch(() => {
        wx.hideLoading();
        this.setData({ loading: false });
        wx.showModal({ title: '登录失败', content: '请检查 login 云函数是否已部署', showCancel: false });
      });
  },

  redirectAfterLogin() {
    const session = auth.getSession();
    if (session && session.permissions && session.permissions.indexOf('dashboard_view') !== -1) {
      wx.reLaunch({ url: '/pages/admin/dashboard/dashboard' });
    } else {
      wx.reLaunch({ url: '/pages/scan/scan' });
    }
  },

  handleSeedData() {
    wx.showModal({
      title: '初始化系统',
      content: '将创建默认管理员账号（admin / admin123）、内置角色与权限、测试流程卡。是否继续？',
      success: (res) => {
        if (!res.confirm) return;
        wx.showLoading({ title: '初始化中...', mask: true });
        callCloud('initSeedData')
          .then((r) => {
            wx.hideLoading();
            const result = r.result || {};
            wx.showModal({
              title: result.success ? '初始化完成' : '初始化失败',
              content: result.msg || JSON.stringify(result),
              showCancel: false
            });
            if (result.success) {
              this.setData({ username: 'admin', password: 'admin123', showSeedHint: false });
            }
          })
          .catch(() => {
            wx.hideLoading();
            wx.showModal({ title: '初始化失败', content: '请先部署 initSeedData 云函数', showCancel: false });
          });
      }
    });
  }
});
