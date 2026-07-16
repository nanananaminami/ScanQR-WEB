const auth = require('../../../utils/auth');

Page({
  data: {
    loading: true,
    users: [],
    roles: [],
    roleFilter: 'all',
    departmentList: [],
    processList: [],
    showCreate: false,
    form: {
      username: '',
      password: '',
      real_name: '',
      department: '',
      role_id: '',
      phone: '',
      workstation: []
    },
    creating: false,
    showWsPicker: false,
    wsSearchKeyword: '',
    wsFilteredOptions: [],
    wsSelected: [],
    wsChecked: {}
  },

  onLoad() {
    if (!auth.requireLogin()) return;
    if (!auth.hasPerm('user_manage')) {
      wx.showToast({ title: '无权限', icon: 'none' });
      setTimeout(() => wx.navigateBack(), 800);
      return;
    }
    this.loadAll();
  },

  loadAll() {
    this.setData({ loading: true });
    Promise.all([
      auth.callWithAuth('getUserList'),
      auth.callWithAuth('getRoleList'),
      auth.callWithAuth('getDictList')
    ]).then(([uRes, rRes, dRes]) => {
      const u = uRes.result || {};
      const r = rRes.result || {};
      const d = dRes.result || {};
      if (u.success && r.success) {
        const dicts = d.dicts || [];
        const deptDict = dicts.find(x => x.dict_id === 'department_list');
        const procDict = dicts.find(x => x.dict_id === 'process_list');
        this.setData({
          users: (u.users || []).map(x => this.formatUser(x)),
          roles: r.roles || [],
          departmentList: deptDict ? (deptDict.options || []) : [],
          processList: procDict ? (procDict.options || []) : [],
          loading: false
        });
      } else {
        this.setData({ loading: false });
        wx.showToast({ title: u.msg || r.msg || '加载失败', icon: 'none' });
      }
    }).catch(() => {
      this.setData({ loading: false });
      wx.showToast({ title: '加载失败', icon: 'none' });
    });
  },

  formatUser(u) {
    const ws = u.workstation || [];
    const wsText = Array.isArray(ws) ? ws.join('、') : ws;
    return Object.assign({}, u, {
      createdText: this.formatDate(u.created_at),
      lastLoginText: this.formatDate(u.last_login),
      statusText: u.status === 'disabled' ? '已禁用' : '正常',
      statusTheme: u.status === 'disabled' ? 'danger' : 'success',
      workstationText: wsText || '-'
    });
  },

  formatDate(t) {
    if (!t) return '-';
    const d = new Date(t);
    if (isNaN(d.getTime())) return '-';
    const pad = (n) => (n < 10 ? '0' + n : '' + n);
    return d.getFullYear() + '-' + pad(d.getMonth() + 1) + '-' + pad(d.getDate());
  },

  onFilterChange(e) {
    this.setData({ roleFilter: e.currentTarget.dataset.role });
  },

  openCreate() {
    const defaultRoleId = this.data.roles.length > 0 ? this.data.roles[0].role_id : '';
    this.setData({
      showCreate: true,
      form: {
        username: '',
        password: '',
        real_name: '',
        department: '',
        role_id: defaultRoleId,
        phone: '',
        workstation: []
      }
    });
  },

  closeCreate() {
    this.setData({ showCreate: false });
  },

  onFormChange(e) {
    const field = e.currentTarget.dataset.field;
    this.setData({ ['form.' + field]: e.detail.value || '' });
  },

  pickRole() {
    const roles = this.data.roles;
    if (roles.length === 0) return;
    wx.showActionSheet({
      itemList: roles.map(r => r.role_name + '（' + r.role_id + '）'),
      success: (res) => {
        const role = roles[res.tapIndex];
        if (role) this.setData({ 'form.role_id': role.role_id });
      }
    });
  },

  pickDepartment() {
    const list = this.data.departmentList;
    if (list.length === 0) {
      wx.showToast({ title: '暂无部门数据', icon: 'none' });
      return;
    }
    wx.showActionSheet({
      itemList: list,
      success: (res) => {
        this.setData({ 'form.department': list[res.tapIndex] });
      }
    });
  },

  openWsPicker(e) {
    const mode = e.currentTarget.dataset.mode;
    const selected = mode === 'edit' ? (e.currentTarget.dataset.selected || []) : this.data.form.workstation;
    const wsArr = Array.isArray(selected) ? selected.slice() : (selected ? [selected] : []);
    const checked = {};
    const list = this.data.processList.slice();
    list.forEach(name => { checked[name] = wsArr.indexOf(name) !== -1; });
    this.setData({
      showWsPicker: true,
      wsPickerMode: mode || 'create',
      wsPickerUserId: mode === 'edit' ? (e.currentTarget.dataset.userid || '') : '',
      wsSearchKeyword: '',
      wsFilteredOptions: list,
      wsSelected: wsArr,
      wsChecked: checked
    });
  },

  closeWsPicker() {
    this.setData({ showWsPicker: false });
  },

  onWsSearchChange(e) {
    const keyword = (e.detail.value || '').toLowerCase().trim();
    const list = this.data.processList;
    const filtered = keyword
      ? list.filter(s => s.toLowerCase().indexOf(keyword) !== -1)
      : list.slice();
    this.setData({ wsSearchKeyword: keyword, wsFilteredOptions: filtered });
  },

  clearWsSearch() {
    this.setData({ wsSearchKeyword: '', wsFilteredOptions: this.data.processList.slice() });
  },

  toggleWsOption(e) {
    const val = e.currentTarget.dataset.value;
    const selected = this.data.wsSelected.slice();
    const checked = Object.assign({}, this.data.wsChecked);
    const idx = selected.indexOf(val);
    if (idx !== -1) {
      selected.splice(idx, 1);
      checked[val] = false;
    } else {
      selected.push(val);
      checked[val] = true;
    }
    this.setData({ wsSelected: selected, wsChecked: checked });
  },

  confirmWsPicker() {
    const { wsSelected, wsPickerMode, wsPickerUserId } = this.data;
    if (wsPickerMode === 'edit') {
      wx.showLoading({ title: '更新中...' });
      auth.callWithAuth('adminUpdateUser', {
        user_id: wsPickerUserId,
        workstation: wsSelected
      }).then((r) => {
        wx.hideLoading();
        const result = r.result || {};
        if (result.success) {
          wx.showToast({ title: '已更新', icon: 'success' });
          this.loadAll();
        } else {
          wx.showModal({ title: '更新失败', content: result.msg || '请重试', showCancel: false });
        }
      }).catch(() => {
        wx.hideLoading();
        wx.showToast({ title: '更新失败', icon: 'none' });
      });
    } else {
      this.setData({ 'form.workstation': wsSelected });
    }
    this.setData({ showWsPicker: false });
  },

  submitCreate() {
    const { form, creating } = this.data;
    if (creating) return;
    if (!form.username || !form.password || !form.role_id) {
      wx.showToast({ title: '账号、密码、角色为必填', icon: 'none' });
      return;
    }
    if (form.password.length < 6) {
      wx.showToast({ title: '密码至少 6 位', icon: 'none' });
      return;
    }
    this.setData({ creating: true });
    wx.showLoading({ title: '创建中...' });
    auth.callWithAuth('adminCreateUser', form).then((res) => {
      wx.hideLoading();
      this.setData({ creating: false });
      const result = res.result || {};
      if (result.success) {
        wx.showToast({ title: '已创建', icon: 'success' });
        this.setData({ showCreate: false });
        this.loadAll();
      } else {
        wx.showModal({ title: '创建失败', content: result.msg || '请重试', showCancel: false });
      }
    }).catch(() => {
      wx.hideLoading();
      this.setData({ creating: false });
      wx.showToast({ title: '创建失败', icon: 'none' });
    });
  },

  tapUser(e) {
    const index = e.currentTarget.dataset.index;
    const user = this.data.users[index];
    if (!user) return;
    const itemList = ['修改角色', '修改部门', '修改工段', '重置密码', user.status === 'disabled' ? '启用账号' : '禁用账号'];
    wx.showActionSheet({
      itemList,
      success: (res) => {
        if (res.tapIndex === 0) this.changeRole(user);
        else if (res.tapIndex === 1) this.changeDepartment(user);
        else if (res.tapIndex === 2) this.openWsPicker({ currentTarget: { dataset: { mode: 'edit', selected: user.workstation || [], userid: user._id } } });
        else if (res.tapIndex === 3) this.resetPassword(user);
        else if (res.tapIndex === 4) this.toggleStatus(user);
      }
    });
  },

  changeDepartment(user) {
    const list = this.data.departmentList;
    if (list.length === 0) {
      wx.showToast({ title: '暂无部门数据', icon: 'none' });
      return;
    }
    wx.showActionSheet({
      itemList: list,
      success: (res) => {
        const dept = list[res.tapIndex];
        wx.showLoading({ title: '更新中...' });
        auth.callWithAuth('adminUpdateUser', {
          user_id: user._id,
          department: dept
        }).then((r) => {
          wx.hideLoading();
          const result = r.result || {};
          if (result.success) {
            wx.showToast({ title: '已更新', icon: 'success' });
            this.loadAll();
          } else {
            wx.showModal({ title: '更新失败', content: result.msg || '请重试', showCancel: false });
          }
        }).catch(() => {
          wx.hideLoading();
          wx.showToast({ title: '更新失败', icon: 'none' });
        });
      }
    });
  },

  changeRole(user) {
    const roles = this.data.roles;
    const itemList = roles.map(r => r.role_name + (r.role_id === user.role_id ? '（当前）' : ''));
    wx.showActionSheet({
      itemList,
      success: (res) => {
        const role = roles[res.tapIndex];
        if (!role || role.role_id === user.role_id) return;
        wx.showLoading({ title: '更新中...' });
        auth.callWithAuth('adminUpdateUser', {
          user_id: user._id,
          role_id: role.role_id
        }).then((r) => {
          wx.hideLoading();
          const result = r.result || {};
          if (result.success) {
            wx.showToast({ title: '已更新', icon: 'success' });
            this.loadAll();
          } else {
            wx.showModal({ title: '更新失败', content: result.msg || '请重试', showCancel: false });
          }
        }).catch(() => {
          wx.hideLoading();
          wx.showToast({ title: '更新失败', icon: 'none' });
        });
      }
    });
  },

  resetPassword(user) {
    wx.showModal({
      title: '重置密码',
      editable: true,
      placeholderText: '请输入新密码（至少 6 位）',
      success: (res) => {
        if (!res.confirm || !res.content) return;
        const pwd = res.content.trim();
        if (pwd.length < 6) {
          wx.showToast({ title: '密码至少 6 位', icon: 'none' });
          return;
        }
        wx.showLoading({ title: '重置中...' });
        auth.callWithAuth('adminResetPassword', {
          user_id: user._id,
          new_password: pwd
        }).then((r) => {
          wx.hideLoading();
          const result = r.result || {};
          if (result.success) {
            wx.showModal({ title: '已重置', content: user.username + ' 的新密码已设置，其所有会话已失效', showCancel: false });
            this.loadAll();
          } else {
            wx.showModal({ title: '重置失败', content: result.msg || '请重试', showCancel: false });
          }
        }).catch(() => {
          wx.hideLoading();
          wx.showToast({ title: '重置失败', icon: 'none' });
        });
      }
    });
  },

  toggleStatus(user) {
    const newStatus = user.status === 'disabled' ? 'active' : 'disabled';
    const action = newStatus === 'disabled' ? '禁用' : '启用';
    wx.showModal({
      title: action + '账号',
      content: '确定' + action + '账号「' + (user.real_name || user.username) + '」？',
      success: (res) => {
        if (!res.confirm) return;
        wx.showLoading({ title: '处理中...' });
        auth.callWithAuth('adminUpdateUser', {
          user_id: user._id,
          status: newStatus
        }).then((r) => {
          wx.hideLoading();
          const result = r.result || {};
          if (result.success) {
            wx.showToast({ title: '已' + action, icon: 'success' });
            this.loadAll();
          } else {
            wx.showModal({ title: '操作失败', content: result.msg || '请重试', showCancel: false });
          }
        }).catch(() => {
          wx.hideLoading();
          wx.showToast({ title: '操作失败', icon: 'none' });
        });
      }
    });
  },

  onPullDownRefresh() {
    this.loadAll();
    wx.stopPullDownRefresh();
  }
});
