const app = getApp();

Page({
  data: {
    user: null,
    role: '',
    openidShort: '',
    createdText: ''
  },

  onLoad() {
    this.waitRole();
  },

  onShow() {
    if (typeof this.getTabBar === 'function' && this.getTabBar()) {
      this.getTabBar().refresh();
    }
  },

  waitRole() {
    if (app.globalData.roleReady) {
      this.initData();
    } else {
      app.globalData.roleCallbacks.push(() => this.initData());
    }
  },

  initData() {
    const user = app.globalData.user || {};
    const openid = user.openid || '';
    const openidShort = openid ? openid.slice(0, 8) + '...' + openid.slice(-4) : '未获取';
    let createdText = '-';
    if (user.created_at) {
      const d = new Date(user.created_at);
      createdText = d.getFullYear() + '-' + (d.getMonth() + 1) + '-' + d.getDate();
    }
    this.setData({
      user,
      role: app.globalData.role || 'operator',
      openidShort,
      createdText
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

  clearCache() {
    wx.showModal({
      title: '清除缓存',
      content: '将清除本地存储的操作员信息等，不影响云端数据',
      success: (res) => {
        if (res.confirm) {
          wx.clearStorageSync();
          wx.showToast({ title: '已清除', icon: 'success' });
        }
      }
    });
  }
});
