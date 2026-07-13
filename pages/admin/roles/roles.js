const auth = require('../../../utils/auth');

// 权限分组（用于角色编辑器勾选）
const PERMISSION_GROUPS = [
  { module: 'dashboard', module_name: '看板', perms: [{ id: 'dashboard_view', name: '查看看板' }] },
  { module: 'card', module_name: '流程卡', perms: [
    { id: 'card_list', name: '查看在制卡片' },
    { id: 'card_submit', name: '扫码上锁/提交报工' },
    { id: 'card_unlock', name: '强制解锁流程卡' },
    { id: 'card_trace', name: '查看生命周期追溯' }
  ]},
  { module: 'log', module_name: '日志', perms: [
    { id: 'log_view', name: '查看操作日志' },
    { id: 'log_export', name: '导出日志' }
  ]},
  { module: 'user', module_name: '人员', perms: [{ id: 'user_manage', name: '人员管理' }] },
  { module: 'role', module_name: '角色', perms: [{ id: 'role_manage', name: '角色与权限管理' }] },
  { module: 'system', module_name: '系统', perms: [{ id: 'seed_init', name: '初始化测试数据' }] }
];

Page({
  data: {
    loading: true,
    roles: [],
    editing: false,
    isSystem: false,
    currentRole: null,
    editingId: '',
    editingName: '',
    selectedPerms: {},
    permissionGroups: PERMISSION_GROUPS,
    saving: false
  },

  onLoad() {
    if (!auth.requireLogin()) return;
    if (!auth.hasPerm('role_manage')) {
      wx.showToast({ title: '无权限', icon: 'none' });
      setTimeout(() => wx.navigateBack(), 800);
      return;
    }
    this.loadRoles();
  },

  loadRoles() {
    this.setData({ loading: true });
    auth.callWithAuth('getRoleList').then((res) => {
      const result = res.result || {};
      if (result.success) {
        this.setData({ roles: result.roles || [], loading: false });
      } else {
        this.setData({ loading: false });
        wx.showToast({ title: result.msg || '加载失败', icon: 'none' });
      }
    }).catch(() => {
      this.setData({ loading: false });
    });
  },

  selectRole(e) {
    const role = this.data.roles[e.currentTarget.dataset.index];
    if (!role) return;
    const selected = {};
    (role.permissions || []).forEach(p => { selected[p] = true; });
    this.setData({
      editing: true,
      currentRole: role,
      editingId: role.role_id,
      editingName: role.role_name,
      isSystem: !!role.is_system,
      selectedPerms: selected
    });
  },

  startCreate() {
    this.setData({
      editing: true,
      currentRole: null,
      editingId: '',
      editingName: '',
      isSystem: false,
      selectedPerms: {}
    });
  },

  cancelEdit() {
    this.setData({ editing: false });
  },

  onIdChange(e) {
    this.setData({ editingId: e.detail.value || '' });
  },

  onNameChange(e) {
    this.setData({ editingName: e.detail.value || '' });
  },

  togglePerm(e) {
    const perm = e.currentTarget.dataset.perm;
    const selected = Object.assign({}, this.data.selectedPerms);
    if (selected[perm]) {
      delete selected[perm];
    } else {
      selected[perm] = true;
    }
    this.setData({ selectedPerms: selected });
  },

  saveCurrent() {
    const { editingId, editingName, selectedPerms, currentRole, saving } = this.data;
    if (saving) return;
    if (!editingId || !editingName) {
      wx.showToast({ title: '请填写角色标识与名称', icon: 'none' });
      return;
    }
    const permissions = Object.keys(selectedPerms);
    this.setData({ saving: true });
    wx.showLoading({ title: '保存中...' });
    auth.callWithAuth('adminSaveRole', {
      role_id: editingId,
      role_name: editingName,
      permissions: permissions,
      is_new: !currentRole
    }).then((res) => {
      wx.hideLoading();
      this.setData({ saving: false });
      const result = res.result || {};
      if (result.success) {
        wx.showToast({ title: '已保存', icon: 'success' });
        this.setData({ editing: false });
        this.loadRoles();
      } else {
        wx.showModal({ title: '保存失败', content: result.msg || '请重试', showCancel: false });
      }
    }).catch(() => {
      wx.hideLoading();
      this.setData({ saving: false });
      wx.showToast({ title: '保存失败', icon: 'none' });
    });
  },

  onPullDownRefresh() {
    this.loadRoles();
    wx.stopPullDownRefresh();
  }
});
