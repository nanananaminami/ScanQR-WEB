const app = getApp();

Page({
  data: {
    loading: true,
    users: [],
    filteredUsers: [],
    roleFilter: 'all'
  },

  onLoad() {
    this.waitRoleAndLoad();
  },

  waitRoleAndLoad() {
    if (app.globalData.roleReady) {
      this.checkRoleAndLoad();
    } else {
      app.globalData.roleCallbacks.push(() => this.checkRoleAndLoad());
    }
  },

  checkRoleAndLoad() {
    if (app.globalData.role !== 'admin') {
      wx.switchTab({ url: '/pages/scan/scan' });
      return;
    }
    this.loadUsers();
  },

  loadUsers() {
    this.setData({ loading: true });
    wx.cloud.callFunction({ name: 'getUserList' })
      .then((res) => {
        const result = res.result || {};
        if (result.success) {
          const users = (result.users || []).map((u) => this.formatUser(u));
          this.setData({ users, loading: false });
          this.updateFiltered();
        } else {
          this.setData({ loading: false });
          wx.showToast({ title: result.msg || '加载失败', icon: 'none' });
        }
      })
      .catch(() => {
        this.setData({ loading: false });
        wx.showToast({ title: '请部署 getUserList 云函数', icon: 'none' });
      });
  },

  formatUser(u) {
    const roleMap = {
      admin: { text: '管理员', theme: 'primary' },
      operator: { text: '操作员', theme: 'success' },
      disabled: { text: '已禁用', theme: 'danger' }
    };
    const roleInfo = roleMap[u.role] || roleMap.operator;
    const openid = u.openid || '';
    return {
      ...u,
      openidShort: openid ? openid.slice(0, 8) + '...' + openid.slice(-4) : '未知',
      roleText: roleInfo.text,
      roleTagTheme: roleInfo.theme,
      createdText: this.formatDate(u.created_at)
    };
  },

  formatDate(t) {
    if (!t) return '-';
    const d = new Date(t);
    if (isNaN(d.getTime())) return '-';
    return d.getFullYear() + '-' + (d.getMonth() + 1) + '-' + d.getDate();
  },

  updateFiltered() {
    const { users, roleFilter } = this.data;
    const filteredUsers = roleFilter === 'all' ? users : users.filter((u) => u.role === roleFilter);
    this.setData({ filteredUsers });
  },

  onRoleFilterChange(e) {
    this.setData({ roleFilter: e.currentTarget.dataset.role });
    this.updateFiltered();
  },

  changeRole(e) {
    const index = e.currentTarget.dataset.index;
    const user = this.data.filteredUsers[index];
    if (!user) return;

    const itemList = ['设为管理员', '设为操作员', '禁用账号'];
    if (user.role === 'admin') itemList[0] += '（当前）';
    if (user.role === 'operator') itemList[1] += '（当前）';
    if (user.role === 'disabled') itemList[2] += '（当前）';

    wx.showActionSheet({
      itemList: itemList,
      success: (res) => {
        const roles = ['admin', 'operator', 'disabled'];
        const newRole = roles[res.tapIndex];
        if (user.role === newRole) return;
        this.updateRole(user, newRole);
      }
    });
  },

  updateRole(user, newRole) {
    wx.showLoading({ title: '更新中...' });
    wx.cloud.callFunction({
      name: 'adminUpdateUserRole',
      data: { target_openid: user.openid, new_role: newRole }
    }).then((res) => {
      wx.hideLoading();
      const result = res.result || {};
      if (result.success) {
        wx.showToast({ title: '已更新', icon: 'success' });
        this.loadUsers();
      } else {
        wx.showModal({ title: '更新失败', content: result.msg || '请重试', showCancel: false });
      }
    }).catch(() => {
      wx.hideLoading();
      wx.showModal({ title: '更新失败', content: '请检查 adminUpdateUserRole 云函数是否已部署', showCancel: false });
    });
  },

  onPullDownRefresh() {
    this.loadUsers();
    wx.stopPullDownRefresh();
  }
});
