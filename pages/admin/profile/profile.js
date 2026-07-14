const auth = require('../../../utils/auth');

Page({
  data: {
    user: null,
    roleName: '',
    roleId: '',
    permissions: [],
    createdText: '-',
    lastLoginText: '-'
  },

  onLoad() {
    this.initData();
  },

  onShow() {
    if (typeof this.getTabBar === 'function' && this.getTabBar()) {
      this.getTabBar().refresh();
    }
  },

  initData() {
    const session = auth.getSession() || {};
    const user = session.user || {};
    let createdText = '-';
    if (user.created_at) {
      const d = new Date(user.created_at);
      if (!isNaN(d.getTime())) createdText = d.getFullYear() + '-' + (d.getMonth() + 1) + '-' + d.getDate();
    }
    let lastLoginText = '-';
    if (user.last_login) {
      const d = new Date(user.last_login);
      if (!isNaN(d.getTime())) {
        const pad = (n) => (n < 10 ? '0' + n : '' + n);
        lastLoginText = d.getFullYear() + '-' + pad(d.getMonth() + 1) + '-' + pad(d.getDate()) + ' ' + pad(d.getHours()) + ':' + pad(d.getMinutes());
      }
    }
    this.setData({
      user,
      roleName: session.role || '',
      roleId: session.role_id || '',
      permissions: session.permissions || [],
      createdText,
      lastLoginText
    });
  },

  goScan() {
    wx.switchTab({ url: '/pages/scan/scan' });
  },

  goCards() {
    wx.switchTab({ url: '/pages/admin/cards/cards' });
  },

  goUsers() {
    wx.navigateTo({ url: '/pages/admin/users/users' });
  },

  goRoles() {
    wx.navigateTo({ url: '/pages/admin/roles/roles' });
  },

  goTemplates() {
    wx.navigateTo({ url: '/pages/admin/templates/templates' });
  },

  handleLogout() {
    wx.showModal({
      title: '退出登录',
      content: '将清除当前登录状态，确定退出？',
      success: (res) => {
        if (res.confirm) auth.logout();
      }
    });
  },

  clearCache() {
    wx.showModal({
      title: '清除缓存',
      content: '将清除本地存储并退出登录，不影响云端数据',
      success: (res) => {
        if (res.confirm) {
          wx.clearStorageSync();
          wx.showToast({ title: '已清除', icon: 'success' });
          setTimeout(() => auth.logout(), 600);
        }
      }
    });
  }
});
